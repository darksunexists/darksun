/* eslint-disable no-unreachable */
import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { composeContext, Content, elizaLogger, generateMessageResponse, generateText, getEnvVariable, MemoryManager, ModelClass, State, UUID } from "@elizaos/core";
import { AgentRuntime } from "@elizaos/core";
import {
	Memory,
	Client,
	IAgentRuntime,
} from "@elizaos/core";
import { stringToUuid } from "@elizaos/core";
import type { BackroomEntry, ConversationMessage, PostgresDatabaseAdapter } from "@elizaos/adapter-postgres";

import { postInvestigationTweetTask } from "@elizaos/service-trigger";

import { Scraper } from "agent-twitter-client"

import { createApiRouter } from "./api.ts";
import { IQ } from "./IQ.ts";

export interface InvestigationEntry {
	conversationId: UUID;
	respondedToTweetUrl: string;
	twitterUser: string;
	backroomId: UUID;
	scrappedArticleContent: ScrapedArticle | null;
	sources: string[];
}

import { ArticleAnalyzer } from "./services/ArticleAnalyzer.ts";
import { ArticleGenerationRequest, SubtopicCluster } from "./types/article-generation.ts";
import { ContentAnalyzer } from "./services/ContentAnalyzer.ts";

import type { 
	InvestigateClientOptions, 
	ScrapedArticle,
	InvestigateParams,
	InvestigateUpdate,
	TopicAnalysisUpdate,
	BackroomAnalysisUpdate,
	FullCluster,
	InvestigationTriggerResponse,
} from "./types/index.ts"; 

// import { ContentFeatures } from "./types/article-generation.ts";

import { 
	backroomCompleteTemplate, 
	darksunBackroomCompleteTemplate, 
	darksunBackroomMessageTemplate, 
	darksunMetadataTemplate, 
	holmesBackroomMessageTemplate, 
	investigateInitialQuestionTemplate 
} from "./templates.ts";

interface InvestigateBackroomOptions {
	maxQuestions: number;
	forceCompleteAt: number;
	darksunInitialQuestionRes: {
		text: string;
	};
	roomId: string;
}

interface TweetStateData {
	otherAgentName: string;
	otherAgentBio: string | string[];
	otherAgentLore: string[];
	currentPost: string;
	formattedConversation: string;
	userId: string;
	roomId: string;
	articleTitle?: string;
	articleDescription?: string;
	articleContent?: string;
}

export interface InvestigateBackroomRequest {
	originalMessage: Memory;
	tweetStateData: TweetStateData;
	messages: ConversationMessage[];
	opts: InvestigateBackroomOptions;
}

export class InvestigateClient {
	public app: express.Application;
	private agents: Map<string, AgentRuntime>;
	private server: any; // Store server instance
	private iq: IQ;
	private scraper: Scraper | null = null;
	private articleAnalyzer: ArticleAnalyzer;
	private contentAnalyzer: ContentAnalyzer;

	constructor(opts: InvestigateClientOptions) {
		elizaLogger.info("InvestigateClient constructor");

		const rpcUrl = getEnvVariable("IQ_RPC_URL", undefined);
		const defaultRpcUrl = getEnvVariable("RPC_URL", undefined);

		this.iq = new IQ(opts.useIqRPC ? rpcUrl : defaultRpcUrl);

		this.app = express();
		this.app.use(cors());

		this.app.use((req, res, next) => {
			req.setTimeout(900000);
			res.setTimeout(900000);
			next();
		});

		this.agents = new Map();

		this.app.use(bodyParser.json({ limit: "50mb" }));
		this.app.use(bodyParser.urlencoded({ extended: true, limit: "50mb" }));

		// Set higher timeout values
		// this.app.set("timeout", 300000); // 5 minutes

		const apiRouter = createApiRouter(this.agents);
		this.app.use(apiRouter);

		if (opts.withTwitter) {
			this.scraper = new Scraper();
			this.loginToTwitter().then((loggedIn) => {
				elizaLogger.info("Logged in to Twitter: ", loggedIn);
			}).catch((error) => {
				elizaLogger.error("Error logging in to Twitter: ", error);
				throw error;
			});
		}

		/**
		 * POST /:otherAgentName/investigate
		 * When darksun decides to investigate a tweet, this endpoint is called.
		 * This endpoint will start a backroom conversation with the other agent (Holmes). It will take the tweet, tweet thread, and, potentially, an article as context.
		 *
		 * @param {Object} req.body - The request body
		 * @param {InvestigateParams} req.body.investigateParams - The parameters for the investigation
		 * @param {String} req.body.investigateParams.runtime - The runtime of the agent
		 * @param {String} req.body.investigateParams.roomId - The room ID to use for the conversation
		 * @param {String} req.body.investigateParams.agentName - The name of the agent
		 * @param {String} req.body.investigateParams.currentPost - The current post to investigate
		 * @param {String} req.body.investigateParams.formattedConversation - The formatted conversation to investigate
		 * @param {String} req.body.investigateParams.originalMessage - The original message to investigate
		 * @param {Article} [req.body.investigateParams.article=null] - The article to analyze, may not be provided
		 * @param {boolean} [req.body.withIq=false] - Whether to include conversation in IQ
		 * @returns {Object} Initial response
		 * @returns {boolean} response.success - Whether the conversation started successfully
		 * @returns {string} response.message - Status message
		 * @returns {string} response.conversationId - The ID of the conversation
		 *  - this id will be included in the tweet it reponds with so that the users can go to the conversation on the website
		 *
		 * The conversation flow:
		 * 1. Darksun generates initial question about the tweet
		 * 2. Holmes researches and responds
		 * 3. Darksun processes response and asks follow-up question
		 * 4. Repeat until completion criteria met
		 * 5. Generate title and store conversation in database
		 */
		this.app.post(
			"/:otherAgentName/investigate", 
			async (req: express.Request, res: express.Response) => {
				// Set up SSE headers
				res.setHeader('Content-Type', 'text/event-stream');
				res.setHeader('Cache-Control', 'no-cache');
				res.setHeader('Connection', 'keep-alive');

				const sendUpdate = (update: InvestigateUpdate) => {
					res.write(`data: ${JSON.stringify(update)}\n\n`);
				};

				elizaLogger.info("req.body: ", req.body);
				const { twitterAgentId, roomId, article, currentPost, formattedConversation, originalMessage, tweet, withIq } = req.body as InvestigateParams;

				elizaLogger.debug("article: ", article);

				const messages: ConversationMessage[] = [];
				const citations: string[] = [];

				if (article?.url) citations.push(article.url);

				const runtimes = await this.ensureRequiredRuntimes([
					"darksun-investigator",
					"holmes-iv",
					"metadata-analyzer"
				]);

				const { darksunInvestigator: darksunRuntime, holmesIv: otherAgentRuntime, metadataAnalyzer: metadataAgent } = runtimes;

				sendUpdate({
					type: 'RUNTIMES_READY',
					data: {
						agents: [
							darksunRuntime.character.name,
							otherAgentRuntime.character.name,
							metadataAgent.character.name
						]
					}
				});

				await otherAgentRuntime.ensureConnection(
					otherAgentRuntime.agentId,
					roomId,
					req.body.agentUserName,
					req.body.agentName,
					"investigate"
				);

				await darksunRuntime.ensureConnection(
					darksunRuntime.agentId,
					roomId,
					req.body.agentUserName,
					req.body.agentName,
					"investigate"
				);

				await metadataAgent.ensureConnection(
					metadataAgent.agentId,
					roomId,
					req.body.agentUserName,
					req.body.agentName,
					"investigate"
				);

				const darksunInvestigationMemoryManager = darksunRuntime.getMemoryManager('investigations');

				if (!darksunInvestigationMemoryManager) {
					elizaLogger.error("Investigation memory manager not found");
					res.status(500).send("Investigation memory manager not found");
					return;
				}

				const darksunBackroomMemoryManager = darksunRuntime.getMemoryManager('backroom');

				if (!darksunBackroomMemoryManager) {
					elizaLogger.error("Backroom memory manager not found");
					res.status(500).send("Backroom memory manager not found");
					return;
				}

				const otherAgentBackroomMemoryManager = otherAgentRuntime.getMemoryManager('backroom');

				if (!otherAgentBackroomMemoryManager) {
					elizaLogger.error(otherAgentRuntime.character.name + " backroom memory manager not found");
					res.status(500).send(otherAgentRuntime.character.name + " backroom memory manager not found");
					return;
				}

				if (!this.articleAnalyzer) {
					elizaLogger.info("Creating new ArticleAnalyzer");
					this.articleAnalyzer = new ArticleAnalyzer(darksunRuntime, metadataAgent);
				}

				const metadataDb = metadataAgent.databaseAdapter as PostgresDatabaseAdapter;
				elizaLogger.debug("Got database adapter");

				if (!this.contentAnalyzer) {
					elizaLogger.info("Creating new ContentAnalyzer");
					this.contentAnalyzer = new ContentAnalyzer(metadataDb, this.articleAnalyzer);
				}

				elizaLogger.info("Composing state for tweet");
				// Remove or update this line since it's causing the error
				// elizaLogger.info("userId: ", tweet.userId);  // This line is causing the error

				const tweetState = await darksunRuntime.composeState(originalMessage, {
					otherAgentName: otherAgentRuntime.character.name,
					otherAgentBio: otherAgentRuntime.character.bio,
					otherAgentLore: otherAgentRuntime.character.lore,
					currentPost: currentPost,
					formattedConversation: formattedConversation,
					articleTitle: article?.title,
					articleDescription: article?.description,
					articleContent: article?.content,
					userId: tweet.userId, // This is correct as the userId is directly on the tweet object
					roomId: roomId,
				});

				const investigateId = stringToUuid(originalMessage.id + "-investigate");

				const tweetMemory = {
					id: investigateId,
					agentId: darksunRuntime.agentId,
					content: {
						text: tweet.text,
						url: tweet.permanentUrl,
						inReplyTo: tweet.inReplyToStatusId
							? stringToUuid(
								tweet.inReplyToStatusId +
									"-" +
									twitterAgentId
						)
						: undefined,
						article: {
							title: article?.title,
							description: article?.description,
							content: article?.content,
						},
						currentPost: currentPost,
						formattedConversation: formattedConversation,
					},
					userId: stringToUuid(tweet.userId as string),
					roomId,
					createdAt: tweet.timestamp * 1000,
				};

				elizaLogger.info("Creating tweet memory: ", tweetMemory);
				await darksunInvestigationMemoryManager.createMemory(tweetMemory, true);

				const darksunInitialQuestionRes =
					await this.generateInvestigateInitialQuestion(darksunRuntime, darksunBackroomMemoryManager, {
						roomId: roomId,
						state: tweetState,
						otherAgentId: otherAgentRuntime.agentId,
					});

				sendUpdate({
					type: 'INITIAL_QUESTION',
					data: {
						question: darksunInitialQuestionRes.text
					}
				});

				const darksunInitialQuestionId = stringToUuid(roomId + "-" + darksunRuntime.agentId + "-investigate-initial-question");

				messages.push({
					id: darksunInitialQuestionId,
					agent: darksunRuntime.character.name,
					message: darksunInitialQuestionRes.text,
					timestamp: new Date().toISOString(),
				});

				sendUpdate({
					type: 'CONVERSATION_START',
					data: { timestamp: new Date().toISOString() }
				});

				await this.handleInvestigateBackroomConversation(
					darksunRuntime,
					otherAgentRuntime,
					tweetState,
					messages,
					citations,
					currentPost,
					{
						maxQuestions: 2,
						forceCompleteAt: 2,
						darksunInitialQuestionRes,
						roomId,
						onUpdate: (messages, citations) => {
							sendUpdate({
								type: 'CONVERSATION_UPDATE',
								data: { messages, citations }
							});
						}
					}
				);

				sendUpdate({
					type: 'CONVERSATION_COMPLETE',
					data: { messages, citations }
				});

				elizaLogger.info("-----RIGHT AFTER handleBackroomConversation-----")
				elizaLogger.info("messages: ", messages);
				elizaLogger.info("citations: ", citations);

				elizaLogger.info("Conversation complete, storing conversation in database");

				const db = darksunRuntime.databaseAdapter as PostgresDatabaseAdapter;

				const cleanedConversationHistory = messages 
					.map((message) => `[${message.agent}]: ${message.message}`)
					.join("\n\n");

				const conversationMemory: Memory = {
					id: roomId,
					agentId: darksunRuntime.agentId,
					content: {
						text: cleanedConversationHistory,
					},
					userId: otherAgentRuntime.agentId,
					roomId,
					createdAt: Date.now(),
				};

				await darksunBackroomMemoryManager.createMemory(conversationMemory, true);
				await otherAgentBackroomMemoryManager.createMemory(conversationMemory, true);

				const allTopics = await db.getTopics();

				elizaLogger.info("allTopics: ", allTopics);

				const metadataState = await darksunRuntime.composeState(conversationMemory, {
					agentName: darksunRuntime.character.name,
					conversationHistory: cleanedConversationHistory,
					backroomTopics: allTopics,
				});

				const metadata = await this.createTitleAndTopic(darksunRuntime, metadataState);

				elizaLogger.info("metadata: ", metadata);

				let backroomTitle: string | null = null
				let backroomTopic: string | null = null

				if (metadata.title) {
					backroomTitle = metadata.title as unknown as string;
				}

				if (metadata.topic) {
					backroomTopic = metadata.topic as unknown as string;
				}

				sendUpdate({
					type: 'METADATA_READY',
					data: {
						title: backroomTitle ? backroomTitle : "Untitled",
						topic: backroomTopic ? backroomTopic : "Untitled"
					}
				});

				elizaLogger.info("backroomTitle: ", backroomTitle);
				elizaLogger.info("backroomTopic: ", backroomTopic);

				const cleanedMessages = messages
					.map((message) => `[${message.agent}]: ${message.message}`)
					.join("\n\n");
				const messagesWithTitle = `--- ${backroomTitle} ---\n\n${cleanedMessages}`;

				let txHash: string | null = null;
				if (withIq) {
					elizaLogger.info("Processing IQ");
					try {
						const result = await this.iq.processText(
							messagesWithTitle,
							"backroom-conversation"
						);
						if (result) {
							txHash = result;
							elizaLogger.info("IQ txHash: ", txHash);
							sendUpdate({
								type: 'IQ_RESULT',
								data: { txHash: result }
							});
						} else {
							elizaLogger.warn("IQ transaction failed, proceeding without IQ");
							sendUpdate({
								type: 'IQ_RESULT',
								data: { error: 'IQ transaction failed' }
							});
						}
					} catch (error) {
						elizaLogger.error("Error processing IQ: ", error);
						elizaLogger.warn("Proceeding without IQ");
						sendUpdate({
							type: 'IQ_RESULT',
							data: { error: error.message }
						});
					}
				}

				sendUpdate({
					type: "EXTRACTING_FEATURES",
					data: {
						message: "Extracting features"
					}
				})

				const features = await this.articleAnalyzer.extractFeatures(cleanedMessages, roomId);

				elizaLogger.info("features: ", {
					technicalTerms: features.technicalTerms,
					entities: features.entities,
					claims: features.claims
				});

				const backroomEntry: Omit<BackroomEntry, 'created_at' > = {
					id: roomId,
					topic: backroomTopic,
					title: backroomTitle,
					question: darksunInitialQuestionRes.text,
					content: {
						participants: [
							darksunRuntime.character.name,
							otherAgentRuntime.character.name,
						],
						messages,
					},
					iqTxHash: null,
					citations,
					tweetUrl: tweet.permanentUrl,
					metadata: {
						technicalTerms: features.technicalTerms,
						entities: features.entities,
						claims: features.claims,
					},
					upvotes: 0,
				}

				elizaLogger.info("Creating backroom entry");

				const backroomId = await db.createBackroomEntry(backroomEntry);

				sendUpdate({
					type: 'BACKROOM_ENTRY_CREATED',
					data: { backroomId, backroomEntry }
				});

				elizaLogger.info("Created backroom entry - ID: ", backroomId);

				const investigationEntry: InvestigationEntry = {
					conversationId: roomId,
					respondedToTweetUrl: tweet.permanentUrl,
					twitterUser: tweet.userId,
					backroomId,
					scrappedArticleContent: article ? {
						url: article.url,
						title: article.title,
						description: article.description,
						content: article.content,
					} : null,
					sources: citations
				}

				elizaLogger.info("Creating investigation entry ");

				const investigationId = await db.createInvestigationEntry(investigationEntry);

				sendUpdate({
					type: 'INVESTIGATION_ENTRY_CREATED',
					data: { investigationId, investigationEntry }
				});

				elizaLogger.info("Created investigation entry: ", investigationId);

				sendUpdate({
					type: 'COMPLETE',
					data: {
						success: true,
						message: "Investigation complete",
						data: {
							backroomEntry,
							backroomId,
							investigationId
						}
					} as InvestigationTriggerResponse
				});

				elizaLogger.info("Responding to initial tweet");

				const updateTweetState: State = {
					...tweetState,
					backroomConversation: cleanedConversationHistory,
				}

				const tweetResponse = await this.generateTweetResponse(darksunRuntime, updateTweetState);

				sendUpdate({
					type: 'GENERATED_TWEET_RESPONSE',
					data: {
						tweet: tweetResponse
					}
				});

				elizaLogger.info("Tweet response: ", tweetResponse);

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const cookies = process.env.TWITTER_COOKIES! as unknown as any[];

				elizaLogger.info("Cookies: ", cookies);

				sendUpdate({
					type: 'SEND_TWEET_TRIGGERED',
					data: {
						success: true,
						message: "Tweet Triggered",
					}
				});

				// Call the tweet posting trigger
				const tweetResult = await postInvestigationTweetTask.trigger({
					investigateResponse: {
						text: tweetResponse
					},
					investigationId,
					backroomId,
					tweet: {
						id: tweet.id,
						username: tweet.username,
						text: tweet.text,
						tweetUrl: tweet.permanentUrl
					},
					twitterConfig: {
						MAX_INVESTIGATE_TWEET_LENGTH: parseInt(
							process.env.MAX_INVESTIGATE_TWEET_LENGTH || "280"
						)
					}
				});

				sendUpdate({
					type: 'SEND_TWEET_TRIGGERED',
					data: {
						success: true,
						message: "Tweet Triggered",
						triggerId: tweetResult.id
					}
				});

				res.end();
			}
		);

		this.app.post(
			"/generate-metadata",
			async (req: express.Request, res: express.Response) => {
				try {
					const { topic, backroomIds }: ArticleGenerationRequest = req.body;
					
					const metadataAnalyzerRuntime = Array.from(this.agents.values())
						.find(a => a.character.name.toLowerCase() === "metadata-analyzer");

					if (!metadataAnalyzerRuntime) {
						throw new Error("Metadata Analyzer agent not found");
					}

					const darksunRuntime = Array.from(this.agents.values())
						.find(a => a.character.name.toLowerCase() === "darksun");

					if (!darksunRuntime) {
						throw new Error("Darksun agent not found");
					}

					if (!this.articleAnalyzer) {
						this.articleAnalyzer = new ArticleAnalyzer(darksunRuntime, metadataAnalyzerRuntime);
					}

					const db = metadataAnalyzerRuntime.databaseAdapter as PostgresDatabaseAdapter;

					if (!this.contentAnalyzer) {
						this.contentAnalyzer = new ContentAnalyzer(db, this.articleAnalyzer);
					}


					// Fetch backroom entries
					const backroomsData = backroomIds 
						? await Promise.all(backroomIds.map(id => db.getBackroomEntry(id)))
						: await db.getBackroomEntriesByTopic(topic);

					elizaLogger.info("Backrooms data", {
						backroomsData: backroomsData.map(b => b.id)
					});

					elizaLogger.info("Backrooms metadata", {
						backroomsMetadata: backroomsData.map(b => b.metadata)
					});

					const backrooomDataWithNoMetadata = backroomsData.filter(b => {
						return !b.metadata || (b.metadata?.claims.length === 0 
							&& b.metadata?.entities.length === 0 
							&& b.metadata?.technicalTerms.length === 0);
					});

					elizaLogger.info("Backrooms with no metadata: ", backrooomDataWithNoMetadata.map(b => b.id));

					for (const backroom of backrooomDataWithNoMetadata) {
						const content = backroom.content.messages.map(m => `${m.agent}: ${m.message}`).join("\n");
						const features = await this.articleAnalyzer.extractFeatures(content, backroom.id as UUID);

						await db.updateBackroomEntry(backroom.id, {
							metadata: {
								technicalTerms: features.technicalTerms,
								entities: features.entities,
								claims: features.claims
							}
						});

						elizaLogger.info("Features: ", features);
					}

					res.json({
						success: true,
						message: "Metadata extracted and updated for backrooms"
					});

				} catch (error) {
					elizaLogger.error('Error in article generation:', error.message);
					res.status(500).json({
						success: false,
						error: error.message
					});
				}
			}
		);

		this.app.post(
			"/generate-all",
			async (req: express.Request, res: express.Response) => {
				try {
					// Array of already processed topics (excluding last 3)
					const processedTopics = [];

					elizaLogger.info("Starting generate-all process");
					
					const metadataAnalyzerRuntime = Array.from(this.agents.values())
						.find(a => a.character.name.toLowerCase() === "metadata-analyzer");

					if (!metadataAnalyzerRuntime) {
						throw new Error("Metadata Analyzer agent not found");
					}

					const db = metadataAnalyzerRuntime.databaseAdapter as PostgresDatabaseAdapter;
					
					// Get all topics
					const topics = await db.getTopics();
					const unprocessedTopics = topics.filter(topic => !processedTopics.includes(topic));
					elizaLogger.info(`Found ${unprocessedTopics.length} topics to process`);

					// Set response headers to keep connection alive
					res.setHeader('Content-Type', 'text/plain');
					res.setHeader('Transfer-Encoding', 'chunked');
					res.write('Starting generate-all process...\n');
					res.write(`Skipping ${processedTopics.length} already processed topics\n`);

					// Process each topic sequentially
					for (const topic of unprocessedTopics) {
						try {
							elizaLogger.info(`Processing topic: ${topic}`);
							res.write(`\nProcessing topic: ${topic}\n`);

							// Generate metadata first
							elizaLogger.info(`Generating metadata for topic: ${topic}`);
							res.write(`Generating metadata...\n`);
							
							const metadataResponse = await fetch(`http://localhost:${process.env.BACKROOM_SERVER_PORT}/generate-metadata`, {
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
								},
								body: JSON.stringify({
									topic,
									backroomIds: null
								})
							});

							// Wait for metadata generation to complete and check response
							if (!metadataResponse.ok) {
								const errorText = await metadataResponse.text();
								elizaLogger.error(`Metadata generation failed for topic ${topic}:`, {
									status: metadataResponse.status,
									error: errorText
								});
								throw new Error(`Metadata generation failed: ${errorText}`);
							}

							const metadataResult = await metadataResponse.json();
							if (!metadataResult.success) {
								throw new Error(`Metadata generation failed for topic ${topic}`);
							}

							// Add a longer delay to ensure database operations are complete
							elizaLogger.info(`Waiting for metadata operations to settle for topic: ${topic}`);
							await new Promise(resolve => setTimeout(resolve, 10000));

							// Generate articles
							elizaLogger.info(`Generating articles for topic: ${topic}`);
							res.write(`Generating articles...\n`);
							
							const articlesResponse = await fetch(`http://localhost:${process.env.BACKROOM_SERVER_PORT}/generate-articles-v2`, {
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
								},
								body: JSON.stringify({
									topic,
									backroomIds: null,
									withIq: true
								})
							});

							// Check response and log any errors
							if (!articlesResponse.ok) {
								const errorText = await articlesResponse.text();
								elizaLogger.error(`Article generation failed for topic ${topic}:`, {
									status: articlesResponse.status,
									error: errorText
								});
								throw new Error(`Article generation failed: ${errorText}`);
							}

							const articleResults = await articlesResponse.json();
							if (!articleResults.success) {
								throw new Error(`Article generation failed for topic ${topic}: ${articleResults.error || 'Unknown error'}`);
							}

							// Add a longer delay before moving to next topic
							elizaLogger.info(`Waiting for article operations to settle for topic: ${topic}`);
							await new Promise(resolve => setTimeout(resolve, 10000));
							
							res.write(`Completed topic: ${topic}\n`);
							res.write(`- New articles: ${articleResults.articles.length}\n`);
							res.write(`- Updated articles: ${articleResults.updatedArticles.length}\n`);
							res.write(`- Related articles: ${articleResults.relatedArticles.length}\n`);
							res.write(`- Stored for later: ${articleResults.storedForLater.length}\n`);

						} catch (error) {
							const errorMessage = `Error processing topic ${topic}: ${error.message}\n`;
							elizaLogger.error(`Failed processing for topic ${topic}:`, {
								error: error.message,
								stack: error.stack
							});
							res.write(errorMessage);
							
							// Add a longer delay after error before continuing
							await new Promise(resolve => setTimeout(resolve, 5000));
						}
					}

					res.write('\nAll topics processed successfully!\n');
					res.end();

				} catch (error) {
					elizaLogger.error('Error in generate-all:', error);
					if (!res.headersSent) {
						res.status(500).json({
							success: false,
							error: error.message
						});
					} else {
						res.write(`\nFatal error: ${error.message}\n`);
						res.end();
					}
				}
			}
		);

		this.app.post(
			"/analyze-topic/:topicName", 
			async (req: express.Request, res: express.Response) => {
				// Set up SSE headers
				res.setHeader('Content-Type', 'text/event-stream');
				res.setHeader('Cache-Control', 'no-cache');
				res.setHeader('Connection', 'keep-alive');

				const sendUpdate = (update: TopicAnalysisUpdate) => {
					res.write(`data: ${JSON.stringify(update)}\n\n`);
				};

				try {
					const topicName = req.params.topicName;
					const withIq = req.body.withIq || false;
					
					elizaLogger.info(`Starting topic analysis for: ${topicName}`);

					// Get required runtimes
					const metadataAnalyzerRuntime = Array.from(this.agents.values())
						.find(a => a.character.name.toLowerCase() === "metadata-analyzer");
					const darksunArticlesRuntime = Array.from(this.agents.values())
						.find(a => a.character.name.toLowerCase() === "darksun-articles");

					if (!metadataAnalyzerRuntime || !darksunArticlesRuntime) {
						throw new Error("Required agents not found");
					}

					sendUpdate({
						type: 'AGENTS_READY',
						data: {
							agents: [
								metadataAnalyzerRuntime.character.name,
								darksunArticlesRuntime.character.name
							]
						}
					});

					// Initialize analyzers if needed
					if (!this.articleAnalyzer) {
						elizaLogger.debug("Creating new ArticleAnalyzer");
						this.articleAnalyzer = new ArticleAnalyzer(darksunArticlesRuntime, metadataAnalyzerRuntime);
					}

					const db = metadataAnalyzerRuntime.databaseAdapter as PostgresDatabaseAdapter;
					
					if (!this.contentAnalyzer) {
						elizaLogger.debug("Creating new ContentAnalyzer");
						this.contentAnalyzer = new ContentAnalyzer(db, this.articleAnalyzer);
					}

					sendUpdate({
						type: 'ANALYZERS_READY',
						data: { timestamp: new Date().toISOString() }
					});

					// Fetch existing articles and clusters for the topic
					const existingArticles = await db.getArticlesByTopic(topicName);
					const existingClusters: FullCluster[] = await Promise.all(
						existingArticles.map(async article => {
							const cluster = await db.getClusterByArticleId(article.id);
							if (!cluster) return null;
							
							return {
								...cluster,
								article  // Combine the cluster with its article to form a FullCluster
							};
						})
					).then(clusters => clusters.filter((c): c is FullCluster => c !== null));

					// Fetch all backroom entries for the topic
					const backroomsData = await db.getBackroomEntriesByTopic(topicName);

					sendUpdate({
						type: 'EXISTING_DATA_FETCHED',
						data: { 
							articleCount: existingArticles.length,
							clusterCount: existingClusters.length,
							backroomCount: backroomsData.length
						}
					});

					// Get all backroom IDs that are already in clusters
					const processedBackroomIds = new Set(
						existingClusters.flatMap(cluster => 
							cluster.backrooms.map(backroom => backroom.id)
						)
					);

					sendUpdate({
						type: 'INFO',
						data: {
							message: "Backrooms processed",
							backroomIds: Array.from(processedBackroomIds).map(id => id.toString())
						}
					});

					// Get all backroom IDs that were marked as unclusterable
					const unclusterableBackrooms = await db.getUnclusterableBackrooms(topicName);
					const unclusterableIds = new Set(unclusterableBackrooms.map(b => b.id));

					// Filter out backrooms that are either in clusters or marked unclusterable
					const unprocessedBackrooms = backroomsData.filter(backroom => 
						!processedBackroomIds.has(backroom.id) && 
						!unclusterableIds.has(backroom.id)
					);

					sendUpdate({
						type: 'INFO',
						data: {
							message: "Unprocessed backrooms",
							backroomIds: Array.from(unprocessedBackrooms).map(id => id.toString())
						}
					});

					// Early return if all backrooms have been processed
					if (unprocessedBackrooms.length === 0) {
						elizaLogger.info('No new backrooms to analyze', {
							topic: topicName,
							totalBackrooms: backroomsData.length,
							inClusters: processedBackroomIds.size,
							unclusterable: unclusterableIds.size
						});
						
						sendUpdate({
							type: 'COMPLETE',
							data: {
								success: true,
								newClusters: 0,
								updatedClusters: 0,
								unclusterableBackrooms: unclusterableIds.size,
								processedBackrooms: Array.from(processedBackroomIds)
							}
						});
						
						res.end();
						return;
					}

					sendUpdate({
						type: 'INFO',
						data: {
							message: "Calling formTopicClusters with " + unprocessedBackrooms.length + " backrooms",
							backroomIds: unprocessedBackrooms.map(b => b.id)
						}
					});

					// Form new clusters from unprocessed backrooms
					const newClusters = await this.contentAnalyzer.formTopicClusters(unprocessedBackrooms, sendUpdate);
					let newClusterCount = 0;
					let updatedClusterCount = 0;

					sendUpdate({
						type: 'INFO',
						data: {
							message: `Formed ${newClusters.length} clusters`,
							clusterIds: newClusters.map(c => c.id)
						}
					});

					// Process each cluster
					for (const cluster of newClusters) {
						sendUpdate({
							type: 'BACKROOM_ANALYSIS_START',
							data: { 
								clusterId: cluster.id,
								backroomCount: cluster.relatedBackrooms.length 
							}
						});

						try {
							const decision = await this.contentAnalyzer.analyzeClusterForArticle(cluster);
							
							if (decision.articlesToUpdate?.length > 0) {
								// Update existing articles with new backroom content
								for (const updateInfo of decision.articlesToUpdate) {
									const article = await db.getArticleById(updateInfo.articleId);
									if (!article) continue;

									const updatedArticle = await this.articleAnalyzer.updateExistingArticle(
										article,
										cluster,
										article.roomId
									);

									let iqTxHash = null;
									if (withIq) {
										const cleanArticle = `--- ${updatedArticle.title} --- \n\n${updatedArticle.content}`;
										const result = await this.iq.processText(cleanArticle, "Update Article");
										if (result) {
											iqTxHash = result;
											sendUpdate({
												type: 'IQ_RESULT',
												data: { txHash: result }
											});
										}
									}

									await db.createNewArticleVersion(updateInfo.articleId, {
										article: updatedArticle.content,
										title: updatedArticle.title,
										backroomIds: [...updateInfo.missingBackroomIds, ...cluster.relatedBackrooms.map(b => b.id)],
										iqTxHash: iqTxHash
									});

									await db.createCluster({
										topic: cluster.topic,
										articleId: updateInfo.articleId,
										backrooms: cluster.relatedBackrooms
									});

									updatedClusterCount++;

									sendUpdate({
										type: 'CLUSTER_UPDATED',
										data: {
											articleId: updateInfo.articleId.toString(),
											title: updatedArticle.title,
											backroomCount: cluster.relatedBackrooms.length
										}
									});
								}
							} else if (decision.shouldCreate) {
								// Create new cluster with new article
								const roomId = await db.createRoom();
								const article = await this.articleAnalyzer.generateArticleFromCluster(
									cluster,
									roomId
								);

								let txHash = null;
								if (withIq) {
									const cleanArticle = `--- ${article.title} --- \n\n${article.content}`;
									const result = await this.iq.processText(cleanArticle, "New Article");
									if (result) {
										txHash = result;
										sendUpdate({
											type: 'IQ_RESULT',
											data: { txHash: result }
										});
									}
								}

								const articleId = await db.createArticle({
									article: article.content,
									title: article.title,
									topic: cluster.topic,
									iqTxHash: txHash,
									roomId: roomId,
									relatedArticles: decision.relatedArticles,
									sourceBackroomIds: cluster.relatedBackrooms.map(b => b.id),
								});

								await db.createCluster({
									topic: cluster.topic,
									articleId,
									backrooms: cluster.relatedBackrooms
								});

								newClusterCount++;

								sendUpdate({
									type: 'NEW_CLUSTER_CREATED',
									data: {
										articleId: articleId.toString(),
										title: article.title,
										backroomCount: cluster.relatedBackrooms.length
									}
								});
							} else {
								// Mark backrooms as unclusterable
								await Promise.all(cluster.relatedBackrooms.map(backroom =>
									db.markBackroomAsUnclusterable({
										backroomId: backroom.id,
										topic: topicName,
										reason: decision.reason || 'Insufficient content for clustering'
									})
								));

								sendUpdate({
									type: 'BACKROOM_STORED',
									data: {
										backroomIds: cluster.relatedBackrooms.map(b => b.id),
										reason: decision.reason || 'Insufficient content for clustering'
									}
								});
							}
						} catch (error) {
							elizaLogger.error(`Error processing cluster ${cluster.id}:`, error.message);
							sendUpdate({
								type: 'ERROR',
								data: {
									error: `Error processing cluster ${cluster.id}: ${error.message}`
								}
							});
						}
					}

					sendUpdate({
						type: 'COMPLETE',
						data: {
							success: true,
							newClusters: newClusterCount,
							updatedClusters: updatedClusterCount,
							unclusterableBackrooms: unclusterableIds.size,
							processedBackrooms: Array.from(processedBackroomIds)
						}
					});

					res.end();

				} catch (error) {
					elizaLogger.error('Error in topic analysis:', {
						error: error.message,
						stack: error.stack
					});
					res.status(500).json({
						success: false,
						error: error.message
					});
				}
		
			}
		);

		this.app.post("/analyze-new-backroom/:id", async (req: express.Request, res: express.Response) => {
			// Set up SSE headers
			res.setHeader('Content-Type', 'text/event-stream');
			res.setHeader('Cache-Control', 'no-cache');
			res.setHeader('Connection', 'keep-alive');

			const sendUpdate = (update: BackroomAnalysisUpdate) => {
				res.write(`data: ${JSON.stringify(update)}\n\n`);
			};

			try {
				const backroomId = req.params.id;

				if (!backroomId) {
					sendUpdate({
						type: 'ERROR',
						data: {
							error: "Backroom ID is required"
						}
					});
					res.end();
					return;
				}

				const { withIq = false } = req.body as { withIq: boolean };

				const  { metadataAnalyzer: metadataAnalyzerRuntime, darksunArticles: darksunArticlesRuntime }  = await this.ensureRequiredRuntimes([
					"metadata-analyzer",
					"darksun-articles"
				]);


				sendUpdate({
					type: 'AGENTS_READY',
					data: {
						agents: [
							metadataAnalyzerRuntime.character.name,
							darksunArticlesRuntime.character.name
						]
					}
				});

				// Initialize analyzers if needed
				if (!this.articleAnalyzer) {
					this.articleAnalyzer = new ArticleAnalyzer(darksunArticlesRuntime, metadataAnalyzerRuntime);
				}

				const db = metadataAnalyzerRuntime.databaseAdapter as PostgresDatabaseAdapter;


				const backroomEntry = await db.getBackroomEntry(backroomId as UUID);

				if (!backroomEntry) {
					sendUpdate({
						type: 'ERROR',
						data: {
							error: "BackroomEntry not found for id: " + backroomId
						}
					});
					res.end();
					return;
				}

				const topic = backroomEntry.topic;

				elizaLogger.info(`Starting analysis for new backroom under topic: ${topic}`);

				if (!this.contentAnalyzer) {
					this.contentAnalyzer = new ContentAnalyzer(db, this.articleAnalyzer);
				}

				sendUpdate({
					type: 'ANALYZERS_READY',
					data: { timestamp: new Date().toISOString() }
				});

				// Get unclusterable backrooms for comparison if needed
				const unclusterableBackrooms = await db.getUnclusterableBackrooms(topic);

				elizaLogger.info(`Found ${unclusterableBackrooms.length} unclusterable backrooms for topic ${topic}`);

				if (unclusterableBackrooms.some(b => b.id === backroomEntry.id)) {
					elizaLogger.info(`Backroom ${backroomEntry.id} is already marked as unclusterable`);
					sendUpdate({
						type: 'COMPLETE',
						data: {
							success: true,
							action: 'MARKED_UNCLUSTERABLE',
							reason: 'Backroom already marked as unclusterable'
						}
					});
					res.end();
					return;
				}

				sendUpdate({
					type: 'SIMILARITY_ANALYSIS_START',
					data: { backroomId: backroomEntry.id }
				});

				if (unclusterableBackrooms.length > 0) {

					sendUpdate({
						type: 'UNCLUSTERABLE_COMPARISON_START',
						data: { unclusterableCount: unclusterableBackrooms.length }
					});

					// No existing clusters, compare with unclusterable backrooms
					await this.handleUnclusterableComparison(
						backroomEntry, 
						unclusterableBackrooms,
						db, 
						withIq, 
						sendUpdate
					);
				}

				res.end();

			} catch (error) {
				elizaLogger.error('Error in backroom analysis:', {
					error: error.message,
					stack: error.stack
				});
				res.status(500).json({
					success: false,
					error: error.message
				});
			}
		
		});
	}

	private async handleUnclusterableComparison(
		backroomEntry: BackroomEntry,
		unclusterableBackrooms: BackroomEntry[],
		db: PostgresDatabaseAdapter,
		withIq: boolean,
		sendUpdate: (update: BackroomAnalysisUpdate) => void
	) {
		const similarityAnalysis = await this.contentAnalyzer.analyzeSimilarBackrooms(
			backroomEntry,
			unclusterableBackrooms
		);

		sendUpdate({
			type: 'SIMILARITY_ANALYSIS_COMPLETE',
			data: {
				similarityAnalysis: similarityAnalysis
			}
		});

		if (similarityAnalysis.shouldCreateCluster) {
			// Create new cluster with similar backrooms
			const roomId = await db.createRoom();
			const newCluster: SubtopicCluster = {
				topic: backroomEntry.topic,
				relatedBackrooms: [backroomEntry, ...similarityAnalysis.similarBackrooms],
				id: stringToUuid(Date.now().toString()),
				name: `Cluster-${Date.now().toString()}`,
				features: backroomEntry.metadata
			};

			const article = await this.articleAnalyzer.generateArticleFromCluster(
				newCluster,
				roomId
			);

			let txHash = null;
			if (withIq) {
				const cleanArticle = `--- ${article.title} --- \n\n${article.content}`;
				const result = await this.iq.processText(cleanArticle, "New Article");
				if (result) {
					txHash = result;
					sendUpdate({
						type: 'IQ_RESULT',
						data: { txHash: result }
					});
				}
			}

			const articleId = await db.createArticle({
				article: article.content,
				title: article.title,
				topic: backroomEntry.topic,
				iqTxHash: txHash,
				roomId: roomId,
				sourceBackroomIds: [backroomEntry.id, ...similarityAnalysis.similarBackrooms.map(b => b.id)]
			});

			const clusterId = await db.createCluster({
				topic: backroomEntry.topic,
				articleId,
				backrooms: [backroomEntry, ...similarityAnalysis.similarBackrooms]
			});

			sendUpdate({
				type: 'NEW_CLUSTER_CREATED',
				data: {
					articleId: articleId.toString(),
					title: article.title,
					backroomCount: similarityAnalysis.similarBackrooms.length + 1
				}
			});

			sendUpdate({
				type: 'COMPLETE',
				data: {
					success: true,
					action: 'CREATED_CLUSTER',
					clusterId,
					articleId: articleId.toString()
				}
			});
		} else {
			// Mark as unclusterable
			await db.markBackroomAsUnclusterable({
				backroomId: backroomEntry.id,
				topic: backroomEntry.topic,
				reason: similarityAnalysis.reason || 'Insufficient similarity with existing content'
			});

			sendUpdate({
				type: 'MARKED_UNCLUSTERABLE',
				data: {
					backroomId: backroomEntry.id,
					reason: similarityAnalysis.reason
				}
			});

			sendUpdate({
				type: 'COMPLETE',
				data: {
					success: true,
					action: 'MARKED_UNCLUSTERABLE',
					reason: similarityAnalysis.reason
				}
			});
		}
	}

	private async ensureRequiredRuntimes(requiredAgents: string[]) {
		const runtimes: { [key: string]: AgentRuntime } = {};
		
		for (const agentName of requiredAgents) {
			const runtime = Array.from(this.agents.values()).find(
				(a) => a.character.name.toLowerCase() === agentName.toLowerCase()
			);

			if (!runtime) {
				throw new Error(`Required agent "${agentName}" not found`);
			}

			// Convert agent name to camelCase for object key
			const key = agentName.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
			runtimes[key] = runtime;
		}

		return runtimes;
	}

	private async handleInvestigateBackroomConversation(
		darksunRuntime: AgentRuntime, 
		otherAgentRuntime: AgentRuntime, 
		state: State, 
		messages: ConversationMessage[],
		citations: string[],
		investigationPost: string,
		opts: {
			maxQuestions: number;
			forceCompleteAt: number;
			darksunInitialQuestionRes: Content;
			roomId: UUID;
			onUpdate?: (messages: ConversationMessage[], citations: string[]) => void;
		}
	) {
		const { maxQuestions, darksunInitialQuestionRes, roomId } = opts;

		const darksunBackroomMemoryManager = darksunRuntime.getMemoryManager('backroom');
		const holmesBackroomMemoryManager = otherAgentRuntime.getMemoryManager('backroom');

		const darksunId = darksunRuntime.agentId;

		let conversationComplete = false;
		let questionCount = 0;

		let currentQuestion = darksunInitialQuestionRes.text;

		const lastMessageId = darksunInitialQuestionRes.inReplyTo;

		while (!conversationComplete && questionCount <= maxQuestions) {
			try {
				// Holmes researches and responds
				const holmesContent: Content = {
					text: currentQuestion,
					attachments: [],
					inReplyTo: lastMessageId,
					userId: darksunRuntime.agentId,
					roomId: roomId,
					agentId: otherAgentRuntime.agentId,
				};

				const holmesMessage = {
					content: holmesContent,
					userId: darksunRuntime.agentId,
					roomId: roomId,
					agentId: otherAgentRuntime.agentId,
				};

				const messageId = stringToUuid(Date.now().toString());

				const holmesMemory: Memory = {
					id: stringToUuid(
						messageId + "-" + otherAgentRuntime.agentId
					),
					agentId: otherAgentRuntime.agentId,
					userId: darksunRuntime.agentId,
					roomId: roomId,
					content: holmesContent,
					createdAt: Date.now(),
				};

				await holmesBackroomMemoryManager.createMemory(holmesMemory, true);

				// await otherAgentRuntime.messageManager.addEmbeddingToMemory(
				//     holmesMemory
				// );
				// await otherAgentRuntime.messageManager.createMemory(
				//     holmesMemory
				// );

				let cleanedConversationHistory = messages
					.map((msg) => `[${msg.agent}]: ${msg.message}`)
					.join("\n\n");

				let holmesState = await otherAgentRuntime.composeState(
					holmesMessage,
					{
						darksunName: darksunRuntime.character.name,
						darksunBio: darksunRuntime.character.bio,
						darksunLore: darksunRuntime.character.lore,
						question: currentQuestion,
						conversationHistory: cleanedConversationHistory,
						initialQuestion: darksunInitialQuestionRes.text,
					}
				);

				const holmesContext = composeContext({
					state: holmesState,
					template: holmesBackroomMessageTemplate,
				});

				// elizaLogger.info("HolmesContext: ", holmesContext);

				let holmesResponse: Content | null = null;

				holmesResponse = await generateMessageResponse({
					runtime: otherAgentRuntime,
					context: holmesContext,
					modelClass: ModelClass.LARGE,
				});

				elizaLogger.info("HolmesResponse: ", holmesResponse);

				// save response to memory
				const holmesResponseMessage = {
					id: stringToUuid(
						messageId + "-" + otherAgentRuntime.agentId
					),
					...holmesContent,
					userId: otherAgentRuntime.agentId,
					content: holmesResponse,
					agentId: otherAgentRuntime.agentId,
					roomId: roomId,
					createdAt: Date.now(),
				};

				await holmesBackroomMemoryManager.createMemory(holmesResponseMessage, true);

				// await otherAgentRuntime.messageManager.createMemory(
				//     holmesResponseMessage
				// );

				holmesState =
					await otherAgentRuntime.updateRecentMessageState(
						holmesState
					);

				await otherAgentRuntime.processActions(
					holmesMemory,
					[holmesResponseMessage],
					holmesState,
					async (newMessages) => {
						holmesResponse = newMessages;

						elizaLogger.info("-----Holmes Action Ran -----")

						const content: Content = {
							text: holmesResponse.text,
							attachments: [],
							inReplyTo: lastMessageId,
						};

						const newMemory: Memory = {
							...holmesMemory,
							content: content,
						};

						return [newMemory];
					}
				);

				elizaLogger.info("-----RIGHT AFTER processActions-----")


				if (holmesResponse) {
					elizaLogger.info("HolmesTempMessage: ", holmesResponse);

					const metadata = holmesResponse.metadata as {
						citations: string[];
					};

					if (metadata && metadata.citations) {
						elizaLogger.log("metadata: ", metadata);
						citations.push(...metadata.citations);
						elizaLogger.info("Citations: ", citations);
					} else {
						elizaLogger.info("No citations found");
					}
				} else {
					elizaLogger.info("HolmesTempMessage is null");
				}

				messages.push({
					id: holmesMemory.id,
					agent: otherAgentRuntime.character.name,
					message: holmesResponse.text,
					citations: citations,
					timestamp: new Date().toISOString(),
				});

				// Send update after Holmes' response
				if (opts.onUpdate) {
					opts.onUpdate(messages, citations);
				}

				elizaLogger.info(`Holmes final response: ${holmesResponse.text}`);


				// Force research completion if we've reached the limit
				if (questionCount >= maxQuestions) {
					const concludingThoughts =
						await this.generateConcludingThoughts(
							darksunRuntime,
							{
								conversationHistory: messages,
								roomId: roomId,
								darksunId: darksunId,
								otherAgentName:
									otherAgentRuntime.character.name,
							},
							state,
							darksunBackroomMemoryManager
						);

					messages.push({
						id: `msg_${new Date().getTime()}_${messages.length}`,
						agent: darksunRuntime.character.name,
						message: concludingThoughts.text,
						timestamp: new Date().toISOString(),
					});

					elizaLogger.info(
						"Research completion marker detected - ending conversation"
					);

					// Send final update with concluding thoughts
					if (opts.onUpdate) {
						opts.onUpdate(messages, citations);
					}

					break;
				}

				// Darksun processes the response and formulates next question
				const darksunContent: Content = {
					text: holmesResponse.text,
					attachments: [],
					inReplyTo: holmesMemory.id,
				};

				const darksunMessage = {
					content: darksunContent,
					userId: otherAgentRuntime.agentId,
					roomId: roomId,
					agentId: darksunRuntime.agentId,
				};

				const darksunMemory: Memory = {
					agentId: darksunRuntime.agentId,
					userId: otherAgentRuntime.agentId,
					roomId: roomId,
					content: darksunContent,
					createdAt: Date.now(),
				};

				await darksunRuntime.messageManager.createMemory(
					darksunMemory
				);

				cleanedConversationHistory = messages
					.map((msg) => `[${msg.agent}]: ${msg.message}`)
					.join("\n\n");

				const darksunState = await darksunRuntime.composeState(
					darksunMessage,
					{
						agentName: darksunRuntime.character.name,
						otherAgentName:
							otherAgentRuntime.character.name,
						otherAgentBio: otherAgentRuntime.character.bio,
						otherAgentLore:
							otherAgentRuntime.character.lore,
						previousMessage: holmesResponse.text,
						conversationHistory: cleanedConversationHistory,
						initialQuestion: darksunInitialQuestionRes.text,
						investigationPost: investigationPost,
					}
				);

				const darksunContext = composeContext({
					state: darksunState,
					template: darksunBackroomMessageTemplate,
				});

				// elizaLogger.info("DarksunContext: ", darksunContext);

				const darksunResponse = await generateMessageResponse({
					runtime: darksunRuntime,
					context: darksunContext,
					modelClass: ModelClass.LARGE,
				});

				if (!darksunResponse) {
					throw new Error("Invalid response from Darksun");
				}

				messages.push({
					id: darksunMemory.id,
					agent: darksunRuntime.character.name,
					message: darksunResponse.text,
					timestamp: new Date().toISOString(),
				});

				// Send update after Darksun's response
				if (opts.onUpdate) {
					opts.onUpdate(messages, citations);
				}

				// console.log("\n[DARKSUN]:", darksunResponse.text, "\n");

				// Check if Darksun has indicated research completion
				if (
					darksunResponse.text.includes("[RESEARCH COMPLETE]")
				) {
					conversationComplete = true;
					elizaLogger.info(
						"Research completion marker detected - ending conversation"
					);
				} else {
					currentQuestion = darksunResponse.text;
					questionCount++;
					elizaLogger.debug(
						`Question count: ${questionCount}`
					);
				}
			} catch (error) {
				if (error instanceof Error) {
					elizaLogger.error(
						"Error during conversation round:",
						error.message
					);
					console.error("Error: ", error);
					console.error("Detailed error:", error);
				} else {
					elizaLogger.error(
						"Unknown error during conversation round:",
						error
					);
				}
				throw error;
			}
		}

		return {
			messages: messages,
			citations: citations,
		};

	}

	private async generateInvestigateInitialQuestion(
		runtime: AgentRuntime,
		memoryManager: MemoryManager,
		params: {
			roomId: UUID;
			state: State;
			otherAgentId: UUID;
		}
	) {
		const { roomId, state, otherAgentId } = params;

		// Generate a unique message ID
		const messageId = stringToUuid(Date.now().toString());

		// Create the system message content
		const content: Content = {
			text: "Initial Investigate Question generation request", // Use the template here
			attachments: [],
			inReplyTo: undefined,
		};

		// Create the memory object
		const memory: Memory = {
			id: messageId,
			agentId: runtime.agentId,
			userId: otherAgentId,
			roomId,
			content,
			createdAt: Date.now(),
		};

		// Save the memory
		// await runtime.messageManager.createMemory(memory, true);
		await memoryManager.createMemory(memory, true);

		// Compose the context using the state and the final template
		const context = composeContext({
			state,
			template: investigateInitialQuestionTemplate,
		});

		elizaLogger.info("Investigate Initial Question Context: ", context);

		const response = await generateMessageResponse({
			runtime: runtime,
			context,
			modelClass: ModelClass.LARGE,
		});

		if (!response) {
			throw new Error("No response from generateMessageResponse");
		}

		return response;
	}

	private async generateConcludingThoughts(
		runtime: AgentRuntime,
		params: {
			conversationHistory: ConversationMessage[];
			roomId: UUID;
			darksunId: UUID;
			otherAgentName: string;
		},
		state?: State,
		memoryManager?: MemoryManager,
	) {
		const { conversationHistory, roomId, darksunId, otherAgentName } =
			params;

		const content: Content = {
			text: "Concluding Thoughts generation request",
			attachments: [],
			inReplyTo: undefined,
		};

		const systemMessage = {
			content,
			userId: stringToUuid("system-backroomConcludingThoughts"),
			roomId,
			agentId: runtime.agentId,
		};

		const memory: Memory = {
			id: stringToUuid(Date.now().toString()),
			agentId: runtime.agentId,
			userId: darksunId,
			roomId,
			content,
			createdAt: Date.now(),
		};

		const cleanedConversationHistory = conversationHistory
			.map((message) => `[${message.agent}]: ${message.message}`)
			.join("\n\n");

		if (!state) {
			state = await runtime.composeState(systemMessage, {
				conversationHistory: cleanedConversationHistory,
				otherAgentName: otherAgentName,
			});
		} else {
			state = {
				...state,
				conversationHistory: cleanedConversationHistory,
				otherAgentName: otherAgentName,
			}
		}

		// Compose the context using the state and the final template
		const context = composeContext({
			state,
			template: darksunBackroomCompleteTemplate, // Use the final template here
		});

		elizaLogger.info("Concluding Thoughts Context: ", context);

		const response = await generateMessageResponse({
			runtime: runtime,
			context,
			modelClass: ModelClass.LARGE,
		});

		if (memoryManager) {
			await memoryManager.createMemory(memory, true);
		} else {
			await runtime.messageManager.createMemory(memory);
		}

		elizaLogger.info("Concluding Thoughts Response: ", response);

		return response;
	}
	
    private async loginToTwitter(): Promise<boolean> {
        if (!this.scraper) {
            elizaLogger.error("Twitter scraper not initialized");
            return false;
        }

        elizaLogger.info("Logging in to Twitter");

        const username = process.env.TWITTER_USERNAME;
        const password = process.env.TWITTER_PASSWORD;
        const email = process.env.TWITTER_EMAIL;
        const twitter2faSecret = process.env.TWITTER_2FA_SECRET;

        elizaLogger.info("Username: ", username);
        elizaLogger.info("Password: ", password);
        elizaLogger.info("Email: ", email);
        elizaLogger.info("2FA Secret: ", twitter2faSecret);

        let retries = 3;

        if (!username || !password) {
            elizaLogger.error(
                "Twitter credentials not configured in environment"
            );
            return false;
        }

        while (retries > 0) {   
            try {

                if (await this.scraper.isLoggedIn()) {
                    elizaLogger.info("Successfully logged in.");
                    break;
                } else {
                    await this.scraper.login(username, password, email, twitter2faSecret);
                    if (await this.scraper.isLoggedIn()) {
                        elizaLogger.info("Successfully logged in.");
                        break;
                    }
                }
            } catch (error) {
                elizaLogger.error("Failed to login to Twitter: ", error.message);
            }

            retries--;
            elizaLogger.error(
                `Failed to login to Twitter. Retrying... (${retries} attempts left)`
            );

            if (retries === 0) {
                elizaLogger.error("Max retries reached. Exiting login process.");
                throw new Error("Twitter login failed after maximum retries.");
            }

            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

	private async generateTweetResponse(runtime: IAgentRuntime, state: State): Promise<string> {

		const context = composeContext({
			state: {
				...state,
			},
			template: backroomCompleteTemplate,
		});

		elizaLogger.info("Backroom Complete Context: ", context);

		const response = await generateText({
			runtime: runtime,
			context: context,
			modelClass: ModelClass.LARGE,
		});

		elizaLogger.info("Created Tweet Response: ", response);

		return response;
	}

	public registerAgent(runtime: AgentRuntime) {
		this.agents.set(runtime.agentId, runtime);
	}

	public unregisterAgent(runtime: AgentRuntime) {
		this.agents.delete(runtime.agentId);
	}

	public start(port: number) {
		this.server = this.app.listen(port, () => {
			elizaLogger.info(`Server running at http://localhost:${port}/`);
		});

		this.server.timeout = 1500000; // 25 minutes
		this.server.keepAliveTimeout = 1500000;
		this.server.headersTimeout = 1500001; // slightly higher than keepAliveTimeout

		// Handle graceful shutdown
		const gracefulShutdown = () => {
			elizaLogger.log("Received shutdown signal, closing server...");
			this.server.close(() => {
				elizaLogger.success("Server closed successfully");
				process.exit(0);
			});

			// Force close after 5 seconds if server hasn't closed
			setTimeout(() => {
				elizaLogger.error(
					"Could not close connections in time, forcefully shutting down"
				);
				process.exit(1);
			}, 5000);
		};

		// Handle different shutdown signals
		process.on("SIGTERM", gracefulShutdown);
		process.on("SIGINT", gracefulShutdown);
	}

	public stop() {
		if (this.server) {
			this.server.close(() => {
				elizaLogger.success("Server stopped");
			});
		}
	}

	private async createTitleAndTopic(
		runtime: AgentRuntime,
		state: State
	): Promise<Content> {
		const context = composeContext({
			state: state,
			template: darksunMetadataTemplate,
		});

		const response = await generateMessageResponse({
			runtime,
			context,
			modelClass: ModelClass.LARGE,
		});

        if (response.text.includes(",")) {
            const [title, topic] = response.text.split(",");
            response.title = title.trim();
            response.topic = topic.trim();

        }

        elizaLogger.info("Response: ", response);

        return response;
	}

}

export const InvestigateClientInterface: Client = {
	start: async (_runtime: IAgentRuntime, serverIp: string = "localhost", opts: InvestigateClientOptions = { withTwitter: false, useIqRPC: false }) => {
		elizaLogger.info("InvestigateClientInterface start");
		const client = new InvestigateClient(opts);
		const serverPort = parseInt(
			getEnvVariable("INVESTIGATE_CLIENT_PORT", "3010")
		);
		elizaLogger.info(`Server running at http://${serverIp}:${serverPort}/`);
		client.start(serverPort);
		return client;
	},
	stop: async (_runtime: IAgentRuntime, client?: any) => {
		if (client instanceof InvestigateClient) {
			client.stop();
		}
	},
};

export default InvestigateClientInterface;
