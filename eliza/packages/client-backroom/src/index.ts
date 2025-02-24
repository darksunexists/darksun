import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import { elizaLogger, generateImage, generateText, getEnvVariable, MemoryManager, State, UUID } from "@elizaos/core";
import { composeContext } from "@elizaos/core";
import { generateMessageResponse } from "@elizaos/core";
import { AgentRuntime } from "@elizaos/core";
import {
    Content,
    Memory,
    ModelClass,
    Client,
    IAgentRuntime,
} from "@elizaos/core";
import { stringToUuid } from "@elizaos/core";
import type { PostgresDatabaseAdapter } from "@elizaos/adapter-postgres";

import { Scraper, Tweet } from "agent-twitter-client"

import { createApiRouter } from "./api.ts";
import { IQ } from "./IQ.ts";


import { 
    messageHandlerTemplate, 
    STYLE,
} from "./templates.ts";
import { ArticleAnalyzer } from "./services/ArticleAnalyzer.ts";
import { ArticleGenerationRequest, ArticleGenerationRequestv3, ContentFeatures, SubtopicCluster } from "./types/article-generation.ts";
import { ContentAnalyzer } from "./services/ContentAnalyzer.ts";


import type { 
    BackroomClientOptions, 
    GenerateArticleUpdate,
    FullCluster,
} from "./types/index.ts"; 

import { BackroomEntry } from "@elizaos/adapter-postgres";
import { backroomCreatedTask, SimilarityUpdate } from "@elizaos/service-trigger";
import { tasks } from "@trigger.dev/sdk/v3";
import { generateArticleTweetTask } from "@elizaos/service-trigger";

export class BackroomClient {
    public app: express.Application;
    private agents: Map<string, AgentRuntime>;
    private server: any; // Store server instance
    private iq: IQ;
    private scraper: Scraper | null = null;
    private articleAnalyzer: ArticleAnalyzer;
    private contentAnalyzer: ContentAnalyzer;

    constructor(opts: BackroomClientOptions) {
        elizaLogger.info("BackroomClient constructor");

        const rpcUrl = getEnvVariable("IQ_RPC_URL", undefined);
        const defaultRpcUrl = getEnvVariable("RPC_URL", undefined);

        this.iq = new IQ(opts.useIqRPC ? rpcUrl : defaultRpcUrl);

        this.app = express();
        this.app.use(cors());

        // Add timeout settings to Express app
        this.app.set('timeout', 900000);
        this.app.use((req, res, next) => {
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
            "/:agentId/message",
            async (req: express.Request, res: express.Response) => {
                const agentId = req.params.agentId;
                const roomId = req.body.roomId;
                // const roomId = stringToUuid(
                //     req.body.roomId ?? "default-room-" + agentId
                // );
                const userId = stringToUuid(req.body.userId ?? "user");

                let runtime = this.agents.get(agentId);

                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(this.agents.values()).find(
                        (a) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).send("Agent not found");
                    return;
                }

                await runtime.ensureConnection(
                    userId,
                    roomId,
                    req.body.userName,
                    req.body.name,
                    "direct"
                );

                const text = req.body.text;
                const messageId = stringToUuid(Date.now().toString());

                const content: Content = {
                    text,
                    attachments: [],
                    source: "direct",
                    inReplyTo: undefined,
                };

                const userMessage = {
                    content,
                    userId,
                    roomId,
                    agentId: runtime.agentId,
                };

                const memory: Memory = {
                    id: messageId,
                    agentId: runtime.agentId,
                    userId,
                    roomId,
                    content,
                    createdAt: Date.now(),
                };

                await runtime.messageManager.createMemory(memory);

                const state = await runtime.composeState(userMessage, {
                    agentName: runtime.character.name,
                });

                const context = composeContext({
                    state,
                    template: messageHandlerTemplate,
                });

                const response = await generateMessageResponse({
                    runtime: runtime,
                    context,
                    modelClass: ModelClass.SMALL,
                });

                // save response to memory
                const responseMessage = {
                    ...userMessage,
                    userId: runtime.agentId,
                    content: response,
                };

                await runtime.messageManager.createMemory(responseMessage);

                if (!response) {
                    res.status(500).send(
                        "No response from generateMessageResponse"
                    );
                    return;
                }

                let message = null as Content | null;

                await runtime.evaluate(memory, state);

                const _result = await runtime.processActions(
                    memory,
                    [responseMessage],
                    state,
                    async (newMessages) => {
                        message = newMessages;
                        return [memory];
                    }
                );

                if (message) {
                    res.json([response, message]);
                } else {
                    res.json([response]);
                }
            }
        );

        this.app.post(
            "/generate-all",
            async (req: express.Request, res: express.Response) => {
                try {
                    // Array of already processed topics (excluding last 3)
                    const processedTopics = [
                        "Biases in Physics Research",
                        "Government Financial Mismanagement",
                        "Ancient Advanced Astronomy and Climatic Events",
                        "Ancient Advanced Astronomy and Non-Standard Spectral Signatures",
                        "Suppressed Biomedical Research",
                        "Ancient Advanced Astronomy and Quantum Phenomena",
                        "Astronomical Event Exploitation",
                        "Non-Standard Gravitational Models",
                        "Ancient Advanced Terraforming",
                        "Suppressed Astronomical Discoveries",
                        "Planetary Protection Protocols",
                        "Suppressed Nutritional Science",
                        "Quantum Entanglement in Media Manipulation",
                        "Suppressed Alternative Energy",
                        "Historical Photographic Analysis and Verification",
                        "Nemesis Hypothesis and Mass Extinctions",
                        "Ancient Advanced Astronomy and Digital Artifacts",
                        "Electromagnetic Incidents",
                        "Ancient Advanced Astronomy and Symbolism",
                    ];

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

        this.app.get(
            "/backroom-entry/:id", 
            async (req: express.Request, res: express.Response) => {
                const { id } = req.params;

                if (!id) {
                    throw new Error("ID is required");
                }

                const darksunRuntime = Array.from(this.agents.values()).find(
                    (a) => a.character.name.toLowerCase() === "darksun-investigator"
                );

                if (!darksunRuntime) {
                    throw new Error("Darksun runtime not found");
                }

                const db = darksunRuntime.databaseAdapter as PostgresDatabaseAdapter; 

                const backroomEntry = await db.getBackroomEntry(id as UUID);
                res.json(backroomEntry);
            }
        );

        //
        // MAIN THREE ENDPOINTS
        //

        this.app.post(
            "/backroom-created/:id", 
            async (req: express.Request, res: express.Response) => {
                const { id } = req.params;

                elizaLogger.info("Backroom created: ", id);

                res.json({ success: true, id });

                const darksunRuntime = Array.from(this.agents.values()).find(
                    (a) => a.character.name.toLowerCase() === "darksun-investigator"
                );

                if (!darksunRuntime) {
                    throw new Error("Darksun runtime not found");
                }

                // pause for 3 seconds
                await new Promise(resolve => setTimeout(resolve, 3000));

                const db = darksunRuntime.databaseAdapter as PostgresDatabaseAdapter;  

                const backroom = await db.getBackroomEntry(id as UUID);

                if (!backroom) {
                    elizaLogger.error("Backroom not found");
                    return;
                }

                const polledTask = await tasks.triggerAndPoll<typeof backroomCreatedTask>("backroom-created", {
                    backroomId: id,
                    topic: backroom.topic,
                }, {
                    pollIntervalMs: 5000,
                    maxAttempts: 2,
                });

                elizaLogger.info("Polled task: ", polledTask);

            }
        );

        this.app.post(
            "/process-similarity", 
            async (req: express.Request, res: express.Response) => {

            // Set up SSE headers
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            const sendUpdate = (update: SimilarityUpdate) => {
                res.write(`data: ${JSON.stringify(update)}\n\n`);
            };

            try {
                const { backroomId } = req.body;

                const { metadataAnalyzer: metadataAnalyzerRuntime, darksunArticles: darksunArticlesRuntime } = await this.ensureRequiredRuntimes(["metadata-analyzer", "darksun-articles"]);


                const db = metadataAnalyzerRuntime.databaseAdapter as PostgresDatabaseAdapter;

                if (!this.articleAnalyzer) {
                    this.articleAnalyzer = new ArticleAnalyzer(darksunArticlesRuntime, metadataAnalyzerRuntime);
                }

                if (!this.contentAnalyzer) {
                    this.contentAnalyzer = new ContentAnalyzer(db, this.articleAnalyzer);
                }


                const backroom = await db.getBackroomEntry(backroomId as UUID);

                if (!backroom) {
                    sendUpdate({
                        type: "SIMILARITY_ERROR",
                        data: {
                            error: "Backroom not found"
                        }
                    });
                    res.end();
                    return;
                }

                const existingBackrooms = await db.getBackroomEntriesByTopic(backroom.topic).then(backrooms => backrooms.filter(b => b.id !== backroomId));

                sendUpdate({
                    type: "SIMILARITY_UPDATE",
                    data: {
                        message: `Starting similarity check for ${backroom.id} against ${existingBackrooms.length} existing backrooms`,
                    }
                });

                const rawRoomId = stringToUuid(backroom.id + "-similarity-check");

                let roomId = await db.getRoom(rawRoomId);
                if (!roomId) {
                    roomId = await db.createRoom(rawRoomId);
                }

                for (const existingBackroom of existingBackrooms) {

                    const cached = await db.getBackroomRelation(
                        backroom.id,
                        existingBackroom.id
                    );

                    if (cached !== null) continue;

                    sendUpdate({
                        type: "NEW_SIMILARITY_CHECK",
                        data: {
                            backroomId: backroom.id,
                            existingBackroomId: existingBackroom.id
                        }
                    });

                    const score = await this.articleAnalyzer.areConversationsSimilar(
                        backroom.metadata,
                        existingBackroom.metadata,
                        backroom.title,
                        existingBackroom.title,
                        backroom.topic,
                        roomId
                    );

                    await db.createBackroomRelation(
                        backroom.id,
                        existingBackroom.id,
                        score
                    );
                }

                sendUpdate({
                    type: "SIMILARITY_COMPLETE",
                    data: {
                        message: `Similarity check complete for ${backroom.id}`,
                        backroomId: backroom.id,
                        topic: backroom.topic
                    }
                });

            } catch (error) {
                elizaLogger.error("Error in process-similarity endpoint:", error.message);
                sendUpdate({
                    type: "SIMILARITY_ERROR",
                    data: {
                        error: error.message
                    }
                });
            }

            res.end();
        });

		this.app.post(
			"/generate-articles-v3",
			async (req: express.Request, res: express.Response) => {
				// Set up SSE headers
				res.setHeader('Content-Type', 'text/event-stream');
				res.setHeader('Cache-Control', 'no-cache');
				res.setHeader('Connection', 'keep-alive');

				const sendUpdate = (update: GenerateArticleUpdate) => {
					res.write(`data: ${JSON.stringify(update)}\n\n`);
				};

                let newBackroomId: UUID | null = null;
                let withIq: boolean = false;
                let topic: string | null = null;

				try {
					elizaLogger.info("Generating articles v3");
					({ newBackroomId, withIq = false } = req.body as ArticleGenerationRequestv3);
					topic = req.body.topic;
					elizaLogger.info("Getting required agent runtimes");

                    if (!topic && !newBackroomId) {
                        elizaLogger.error("No topic or backroom ids provided");

						sendUpdate({
							type: 'ERROR',
							data: {
								error: "No topic or backroom id provided"
							}
						});

						res.end();
						return;
                    }

                    const { 
                        metadataAnalyzer: metadataAnalyzerRuntime, darksunArticles: darksunArticlesRuntime 
                    } = await this.ensureRequiredRuntimes(["metadata-analyzer", "darksun-articles"]);

					elizaLogger.info("Initializing analyzers if needed");

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
						type: 'AGENTS_READY',
						data: {
							agents: [
								metadataAnalyzerRuntime.character.name,
								darksunArticlesRuntime.character.name
							]
						}
					});


					const backroomEntry = await db.getBackroomEntry(newBackroomId);

					if (!backroomEntry) {
						sendUpdate({
							type: 'ERROR',
							data: {
								error: `Backroom not found: ${newBackroomId}`
							}
						});
						res.end();
						return;
					}

					if (!topic) {
						topic = backroomEntry.topic;
					}

					// Fetch existing articles and clusters
					const existingArticles = await db.getArticlesByTopic(topic);

					const existingClusters: FullCluster[] = await Promise.all(
						existingArticles.map(async article => {
							const cluster = await db.getClusterByArticleId(article.id);
							if (!cluster) return null;
							
							return {
								...cluster,
								article  
							};
						})
					).then(clusters => clusters.filter((c): c is FullCluster => c !== null));

					sendUpdate({
						type: 'EXISTING_ARTICLES_FETCHED',
						data: { 
							articleCount: existingArticles.length,
							clusterCount: existingClusters.length 
						}
					});


                    // Track which backrooms have been used in clusters to avoid duplicates
                    const usedBackroomIds = new Set<string>();

                    sendUpdate({
                        type: 'CLUSTER_PROCESSING_START',
                        data: {
                            message: `Processing clusters for topic: ${topic}`,
                            newBackroomId: newBackroomId,
                            numberOfClusters: existingClusters.length,
                        }
                    });

                    // First, lets compare the new backroom to the existing clusters
                    for (const cluster of existingClusters) {
                        const scores = await db.getBackroomSimilarityScores(newBackroomId, cluster.backrooms.map(b => b.id));
                        const averageScore = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;

                        if (averageScore > 0.6) {
                            elizaLogger.info(`New backroom ${newBackroomId} is similar to cluster ${cluster.id} with an average score of ${averageScore}`);

                            const roomId = await db.createRoom();
                            cluster.backrooms.push(backroomEntry);

                            const newFeatures: ContentFeatures = {
                                technicalTerms: Array.from(new Set([...backroomEntry.metadata.technicalTerms, ...cluster.backrooms.map(b => b.metadata.technicalTerms).flat()])),
                                entities: [...backroomEntry.metadata.entities, ...cluster.backrooms.map(b => b.metadata.entities).flat()],
                                claims: [...backroomEntry.metadata.claims, ...cluster.backrooms.map(b => b.metadata.claims).flat()],
                            }

                            const subTopicCluster: SubtopicCluster = {
                                id: cluster.id,
                                name: cluster.topic,
                                topic: cluster.topic,
                                features: newFeatures,
                                relatedBackrooms: [backroomEntry, ...cluster.backrooms]
                            }

                            const newArticle = await this.articleAnalyzer.createUpdatedArticle(cluster.article, subTopicCluster, roomId);

                            sendUpdate({
                                type: 'ARTICLE_UPDATED',
                                data: {
                                    message: `New version of article created: ${newArticle.title}`,
                                    clusterId: cluster.id,
                                    article: newArticle
                                }
                            });


                            let txHash = null;

                            try {

                            if (withIq) {
                                const cleanArticle = `--- ${newArticle.title} --- \n\n${newArticle.content}`;
                                try {
                                    txHash = await this.iq.processText(cleanArticle, `Article: ${newArticle.title} - v${cluster.article.version + 1}`);

                                    sendUpdate({
                                        type: 'IQ_RESULT',
                                        data: {
                                            message: `IQ result: ${txHash}`,
                                            iqTxHash: txHash
                                        }
                                    });
                                } catch (error) {
                                    elizaLogger.error("Error processing IQ: ", error);
                                }
                            }
                            } catch (error) {
                                elizaLogger.error("Error creating new article version: ", error.message);
                                sendUpdate({
                                    type: 'IQ_ERROR',
                                    data: {
                                        error: error.message
                                    }
                                });
                            }

                            const newArticleId = await db.createArticle(
                                {
                                    article: newArticle.content,
                                    title: newArticle.title,
                                    topic: topic,
                                    iqTxHash: txHash,
                                    roomId: roomId,
                                    relatedArticles: [],
                                    sourceBackroomIds: [...cluster.backrooms.map(b => b.id), newBackroomId],
                                    parentArticleId: cluster.article.id,
                                    updateReason: `New version of article created: ${newArticle.title}`,
                                    updatedBy: newBackroomId
                                }
                            );

                            // const versionId = await db.createNewArticleVersion(cluster.article.id, {
                            //     title: newArticle.title,
                            //     article: newArticle.content,
                            //     backroomIds: [...cluster.backrooms.map(b => b.id), newBackroomId],
                            //     iqTxHash: txHash
                            // });

                            sendUpdate({
                                type: 'ARTICLE_CREATED',
                                data: {
                                    message: `New article created: ${newArticle.title}`,
                                    articleId: newArticleId,
                                    article: newArticle,
                                }
                            });

                            // Mark the backroom as used since it was added to an existing cluster
                            usedBackroomIds.add(backroomEntry.id);

                            try {
                                sendUpdate({
                                    type: 'INFO',
                                    data: { message: "Starting article tweet generation" }
                                });

                                const tweetResult = await generateArticleTweetTask.trigger({
                                    articleContent: newArticle.content,
                                    articleTitle: newArticle.title,
                                    articleId: cluster.article.id,
                                });

                                sendUpdate({
                                    type: 'INFO',
                                    data: {
                                        message: `Trigger sent for article tweet`,
                                        tweetResult
                                    }
                                });

                            } catch (error) {
                                elizaLogger.error("Failed to post tweet: ", error);
                                sendUpdate({
                                    type: 'ERROR',
                                    data: {
                                        error: error.message
                                    }
                                });
                            }


                            // Since the backroom was added to an existing cluster, we should stop processing
                            sendUpdate({
                                type: 'INFO',
                                data: {
                                    message: `Backroom ${backroomEntry.id} was added to cluster ${cluster.id}. Continuing processing.`
                                }
                            });
                        }
                    }


                    const unclusterableBackrooms = await db.getUnclusterableBackrooms(topic);

                    sendUpdate({
                        type: 'INFO',
                        data: {
                            message: `Found ${unclusterableBackrooms.length} unclusterable backrooms for topic: ${topic}`,
                            backroomIds: unclusterableBackrooms.map(b => b.id),
                            newBackroomId: newBackroomId
                        }
                    });

                    const remainingUnclusterableBackrooms: BackroomEntry[] = [...unclusterableBackrooms]
                        .filter(b => !usedBackroomIds.has(b.id));

                    // ########################################################
                    // Determine if the new backroom can be used in a cluster
                    // ########################################################
                    if (!usedBackroomIds.has(backroomEntry.id)) {

                        sendUpdate({
                            type: 'INFO',
                            data: {
                                message: `Backroom ${backroomEntry.id} was not used in any existing clusters. Processing unclusterable backrooms.`
                            }
                        });

                        const scores = await db.getBackroomSimilarityScores(newBackroomId, unclusterableBackrooms.map(b => b.id));

                        // Get all possible combinations including the new backroom
                        const allPossibleCombinations = this.getCombinations([...unclusterableBackrooms, backroomEntry]);

                        for (const combination of allPossibleCombinations) {
                            // Skip if we've already used any of these backrooms in another cluster
                            if (combination.some(b => usedBackroomIds.has(b.id))) {
                                continue;
                            }

                            let totalScore = 0;
                            let pairCount = 0;

                            const mediaData: { data: Buffer, mediaType: string }[] = [];

                            // Calculate average similarity score using the scores object
                            for (let i = 0; i < combination.length; i++) {
                                for (let j = i + 1; j < combination.length; j++) {
                                    const score = scores[combination[j].id] || await db.getBackroomRelation(
                                        combination[i].id,
                                        combination[j].id
                                    );
                                    if (score !== null) {
                                        totalScore += score;
                                        pairCount++;
                                    }
                                }
                            }

                            const averageScore = pairCount > 0 ? totalScore / pairCount : 0;

                            // If this combination meets our threshold, create a new cluster
                            // Would create a new article and cluster
                            if (averageScore > 0.7) {
                                elizaLogger.info(`Found valid combination of ${combination.length} backrooms with similarity score ${averageScore}`);

                                sendUpdate({
                                    type: 'CREATING_CLUSTER',
                                    data: {
                                        message: `Found valid combination of ${combination.length} backrooms with similarity score ${averageScore}`,
                                        backroomIds: combination.map(b => b.id)
                                    }
                                });

                                try {
                                    const roomId = await db.createRoom();

                                    // Combine features from all backrooms in the combination
                                    const combinedFeatures: ContentFeatures = {
                                        technicalTerms: Array.from(new Set(combination.flatMap(b => b.metadata.technicalTerms))),
                                        entities: combination.flatMap(b => b.metadata.entities),
                                        claims: combination.flatMap(b => b.metadata.claims),
                                    };

                                    const newCluster: SubtopicCluster = {
                                        id: roomId,
                                        name: topic,
                                        topic: topic,
                                        features: combinedFeatures,
                                        relatedBackrooms: combination
                                    };

                                    // Generate new article from the cluster
                                    const article = await this.articleAnalyzer.generateArticleFromCluster(newCluster, roomId);

                                    try {
                                        const imagePrompt = await this.generateImagePrompt(
                                            metadataAnalyzerRuntime, 
                                            article.title,
                                            article.content,
                                        );

                                        const imageResult = await generateImage({
                                            prompt: imagePrompt,
                                            width: 1792,
                                            height: 1024,
                                            numIterations: 30,
                                            stylePreset: 'photographic'
                                        }, darksunArticlesRuntime);

                                        sendUpdate({
                                            type: 'INFO',
                                            data: {
                                                message: `Image generated`,
                                                imageResultDataLength: imageResult.data?.length,
                                                imageResultError: imageResult.error
                                            }
                                        });

                                        const mediaType = imageResult.data[0].split(',')[0].split(':')[1].split(';')[0];

                                        const data = imageResult.data[0].split(',')[1];


                                        mediaData.push({
                                            data: Buffer.from(data, 'base64'), 
                                            mediaType: mediaType
                                        });

                                    } catch (error) {
                                        elizaLogger.error("Error generating image: ", error.message);
                                        sendUpdate({
                                            type: 'ERROR',
                                            data: {
                                                error: `Failed to generate image: ${error.message}`
                                            }
                                        });
                                    }

                                    let txHash = null;
                                    if (withIq) {
                                        const cleanArticle = `--- ${article.title} --- \n\n${article.content}`;
                                        try {
                                            txHash = await this.iq.processText(cleanArticle, "New Article");
                                            sendUpdate({
                                                type: 'IQ_RESULT',
                                                data: {
                                                    message: `IQ result: ${txHash}`,
                                                    iqTxHash: txHash
                                                }
                                            });
                                        } catch (error) {
                                            elizaLogger.error("Error processing IQ: ", error);
                                            sendUpdate({
                                                type: 'IQ_ERROR',
                                                data: {
                                                    error: error.message
                                                }
                                            });
                                        }
                                    }

                                    // Create the article in the database
                                    const articleId = await db.createArticle({
                                        article: article.content,
                                        title: article.title,
                                        topic: topic,
                                        iqTxHash: txHash,
                                        roomId: roomId,
                                        relatedArticles: [],
                                        sourceBackroomIds: combination.map(b => b.id),
                                    });

                                    // Create cluster for the new article
                                    await db.createCluster({
                                        topic: topic,
                                        articleId,
                                        backrooms: combination
                                    });

                                    if (mediaData.length > 0) {
                                        await db.addImageToArticle(articleId, {
                                            data: mediaData[0].data,
                                            mediaType: mediaData[0].mediaType,
                                            articleTitle: article.title
                                        });
                                    }

                                    sendUpdate({
                                        type: 'ARTICLE_CREATED',
                                        data: {
                                            message: `New article created: ${article.title}`,
                                            articleId,
                                            article: article
                                        }
                                    });

                                    sendUpdate({
                                        type: 'INFO',
                                        data: { message: "Starting article tweet generation" }
                                    });

                                    const tweetResult = await generateArticleTweetTask.trigger({
                                        articleContent: article.content,
                                        articleTitle: article.title,
                                        articleId: articleId,
                                    });

                                    sendUpdate({
                                        type: 'INFO',
                                        data: {
                                            message: `Trigger sent for article tweet`,
                                            tweetResult
                                        }
                                    });

                                    // Mark these backrooms as used
                                    combination.forEach(b => usedBackroomIds.add(b.id));

                                    sendUpdate({
                                        type: 'NEW_CLUSTER_CREATED',
                                        data: {
                                            articleId,
                                            backroomIds: combination.map(b => b.id),
                                            averageSimilarity: averageScore
                                        }
                                    });

                                } catch (error) {
                                    elizaLogger.error(`Error creating cluster for combination:`, error);
                                    sendUpdate({
                                        type: 'ERROR',
                                        data: {
                                            error: `Failed to create cluster: ${error.message}`,
                                            backroomIds: combination.map(b => b.id)
                                        }
                                    });
                                }
                            }
                        }
                    }

                    sendUpdate({
                        type: 'UNCLUSTERABLE_BACKROOMS_FETCHED',
                        data: {
                            message: `Remaining unclusterable backrooms: ${remainingUnclusterableBackrooms.map(b => b.id).join(", ")}`
                        }
                    });

                    console.log("Remaining unclusterable backrooms: ", remainingUnclusterableBackrooms);

                    // Mark remaining backrooms as still unclusterable
                    for (const backroom of remainingUnclusterableBackrooms) {
                        await db.markBackroomAsUnclusterable({
                            backroomId: backroom.id,
                            topic: topic,
                            reason: 'Insufficient similarity with other backrooms for clustering'
                        });
                    }

                    // ########################################################
                    // Handle completely unused backroom
                    // ########################################################
                    if (!usedBackroomIds.has(backroomEntry.id)) {
                        elizaLogger.info(`Creating standalone article from unused backroom: ${backroomEntry.id}`);

                        sendUpdate({
                            type: 'INFO',
                            data: {
                                message: `Creating standalone article for new and unused backroom: ${backroomEntry.id}`
                            }
                        });
                        
                        try {
                            const roomId = await db.createRoom();
                            const singleBackroomCluster: SubtopicCluster = {
                                id: roomId,
                                name: topic,
                                topic: topic,
                                features: backroomEntry.metadata,
                                relatedBackrooms: [backroomEntry]
                            };

                            // Generate article from single backroom
                            const article = await this.articleAnalyzer.generateArticleFromCluster(singleBackroomCluster, roomId);

                            const imagePrompt = await this.generateImagePrompt(
                                metadataAnalyzerRuntime, 
                                article.title,
                                article.content,
                            );


                            const mediaData: { data: Buffer, mediaType: string }[] = [];

                            try {

                                const imageResult = await generateImage({
                                    prompt: imagePrompt,
                                    width: 1792,
                                    height: 1024,
                                    numIterations: 30,
                                    stylePreset: 'photographic'
                                }, darksunArticlesRuntime);

                                sendUpdate({
                                    type: 'INFO',
                                    data: {
                                        message: `Image generated`,
                                        imageResultDataLength: imageResult.data?.length,
                                        imageResultError: imageResult.error
                                    }
                                });

                                const mediaType = imageResult.data[0].split(',')[0].split(':')[1].split(';')[0];

                                const data = imageResult.data[0].split(',')[1];


                                mediaData.push({
                                    data: Buffer.from(data, 'base64'), 
                                    mediaType: mediaType
                                });

                                elizaLogger.info("Image generated successfully");

                            } catch (error) {
                                elizaLogger.error("Error generating image: ", error.message);
                                sendUpdate({
                                    type: 'ERROR',
                                    data: {
                                        error: `Failed to generate image: ${error.message}`
                                    }
                                });
                            }

                            let txHash = null;
                            if (withIq) {
                                const cleanArticle = `--- ${article.title} --- \n\n${article.content}`;
                                txHash = await this.iq.processText(cleanArticle, "New Standalone Article");
                            } else {
                                elizaLogger.info("IQ not enabled, skipping IQ processing");
                            }

                            // Create article in database
                            const articleId = await db.createArticle({
                                article: article.content,
                                title: article.title,
                                topic: topic,
                                iqTxHash: txHash,
                                roomId: roomId,
                                relatedArticles: [],
                                sourceBackroomIds: [backroomEntry.id],
                            });

                            elizaLogger.info("Article created in database");

                            // Create cluster for the new article
                            await db.createCluster({
                                topic: topic,
                                articleId,
                                backrooms: [backroomEntry]
                            });

                            elizaLogger.info("Cluster created in database");

                            if (mediaData.length > 0) {
                                await db.addImageToArticle(articleId, {
                                    data: mediaData[0].data,
                                    mediaType: mediaData[0].mediaType,
                                    articleTitle: article.title
                                });
                            } else {
                                elizaLogger.error("No image generated for article");
                                sendUpdate({
                                    type: 'INFO',
                                    data: {
                                        message: `No image generated for article`,
                                        articleId
                                    }
                                });
                            }

                            sendUpdate({
                                type: 'ARTICLE_CREATED',
                                data: {
                                    message: `Created article from unused backroom`,
                                    articleId,
                                    backroomId: backroomEntry.id,
                                    article
                                }
                            });

                            // const baseUrl = getEnvVariable("DARKSUN_BASE_URL", "https://darksun.is");

                            // // New tweet posting logic
                            // const linkToArticle = `${baseUrl}/os/wiki/${encodeURIComponent(article.title)}`;
                            // const articleTweet = `📚 NEW ARTICLE PUBLISHED 📚\n\n${article.title}`;
                            
                            try {
                                sendUpdate({
                                    type: 'INFO',
                                    data: { message: "Starting article tweet generation" }
                                });

                                const tweetResult = await generateArticleTweetTask.trigger({
                                    articleContent: article.content,
                                    articleTitle: article.title,
                                    articleId: articleId,
                                });

                                elizaLogger.info("Article tweet generation triggered");

                                sendUpdate({
                                    type: 'INFO',
                                    data: {
                                        message: `Trigger sent for article tweet`,
                                        tweetResult
                                    }
                                });

                            } catch (error) {
                                elizaLogger.error("Failed to post tweets: ", error);
                                sendUpdate({
                                    type: 'ERROR',
                                    data: {
                                        error: `Tweet failed: ${error.message}`
                                    }
                                });
                                res.end();
                                return;
                            }

                            // Mark backroom as used
                            usedBackroomIds.add(backroomEntry.id);

                        } catch (error) {
                            elizaLogger.error(`Error creating standalone article:`, error);
                            sendUpdate({
                                type: 'ERROR',
                                data: {
                                    error: `Failed to create standalone article: ${error.message}`,
                                    backroomId: backroomEntry.id
                                }
                            })
                            res.end();
                            return;
                        }
                    }

                } catch (error) {
                    elizaLogger.error("Error in article generation v3: ", error.message);
                    sendUpdate({
                        type: 'ERROR',
                        data: {
                            error: `Failed to create standalone article: ${error.message}`,
                            backroomId: newBackroomId,
                            topic: topic,
                            withIq: withIq
                        }
                    });
                    res.end();
                    return;
                }

                elizaLogger.info("Article generation v3 completed");

                res.end();
			}
		);

        //
        // POST TWEET Endpoint
        //

        this.app.post(
            "/post-tweet/:articleId",
            async (req: express.Request, res: express.Response) => {

                try {
                    const { articleId } = req.params as { articleId: string };
                    const darksunRuntime = Array.from(this.agents.values()).find(
                        (a) => a.character.name.toLowerCase() === "darksun-investigator"
                    );

                    if (!darksunRuntime) {
                        throw new Error("Darksun runtime not found");
                    }

                    const db = darksunRuntime.databaseAdapter as PostgresDatabaseAdapter;

                    console.log("articleId: ", articleId);
                    console.log("typeof articleId: ", typeof articleId);

                    const article = await db.getArticleById(parseInt(articleId));

                    if (!article) {
                        throw new Error("Article not found");
                    }

                    elizaLogger.info("Article found: ", article);

                    const mediaData: { data: Buffer, mediaType: string }[] = [];

                    const imagePrompt = `Professional article header image depicting: \nTitle: ${article.title}\n\n${article.article.slice(0, 800).concat("...")} \n\nMinimal text, high-quality photography style, relevant to article content. No words, just the image.`;

                    elizaLogger.info("Image prompt length: ", imagePrompt.length);
                

                    // add the image url to the article
                    if (!article.imageUrl) {
                        await db.addImageToArticle(article.id, {
                            data: mediaData[0].data,
                            mediaType: mediaData[0].mediaType,
                            articleTitle: article.title
                        });
                    }

                    const content = `🚨🚨 UPDATED ARTICLE 🚨🚨 \n\n${article.title} - v${article.version}\n\n${article.article}`;

                    const tweet = await this.postTweet(content, true, undefined, mediaData);

                    res.json({ tweet });

                } catch (error) {
                    elizaLogger.error("Error posting tweet: ", error.message);
                    res.status(500).json({ error: error.message });
                }
            }
        )
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

    private getCombinations(backrooms: BackroomEntry[], minSize: number = 3): BackroomEntry[][] {
        const result: BackroomEntry[][] = [];
        const combine = (start: number, combo: BackroomEntry[]) => {
                if (combo.length >= minSize) {
                    result.push([...combo]);
                }
                for (let i = start; i < backrooms.length; i++) {
                    combine(i + 1, [...combo, backrooms[i]]);
                }
        };
        combine(0, []);
        return result;
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

    private async postTweet(
        content: string, 
        isLongTweet: boolean = false, 
        replyToTweetId: string | undefined = undefined,
        mediaData: { data: Buffer, mediaType: string }[] = []
    ): Promise<Tweet> {
        try {
            if (!this.scraper.isLoggedIn()) {
                const loggedIn = await this.loginToTwitter();
                if (!loggedIn) {
                    throw new Error("Failed to login to Twitter");
                }
            }


            // Send the tweet
            elizaLogger.log("Attempting to send tweet:", content);
            const result = isLongTweet ? await this.scraper.sendLongTweet(content, replyToTweetId, mediaData) : await this.scraper.sendTweet(content, replyToTweetId, mediaData);

            const body = await result.json();
            elizaLogger.log("Tweet response:", body);

            const tweetResult = isLongTweet
                ? body.data.notetweet_create.tweet_results.result
                : body.data.create_tweet.tweet_results.result;

            const finalTweet: Tweet = {
                id: tweetResult.rest_id,
                text: tweetResult.legacy.full_text,
                conversationId: tweetResult.legacy.conversation_id_str,
                timestamp:
                    new Date(tweetResult.legacy.created_at).getTime() / 1000,
                userId: tweetResult.legacy.user_id_str,
                inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
                permanentUrl: `https://twitter.com/0xblacksun/status/${tweetResult.rest_id}`,
                hashtags: [],
                mentions: [],
                photos: [],
                thread: [],
                urls: [],
                videos: [],
            };


            // Check for Twitter API errors
            if (body.errors) {
                const error = body.errors[0];
                elizaLogger.error(
                    `Twitter API error (${error.code}): ${error.message}`
                );
                throw new Error(`Twitter API error (${error.code}): ${error.message}`);
            }

            elizaLogger.info("Tweet result: ", tweetResult); 

            return finalTweet;

        } catch (error) {
            // Log the full error details
            elizaLogger.error("Error posting tweet:", {
                message: error.message,
                stack: error.stack,
                name: error.name,
                cause: error.cause,
            });
            throw new Error(`Failed to post tweet: ${error.message}`);
        } 
    }

    private async generateImagePrompt(
        runtime: AgentRuntime,
        articleTitle: string,
        articleContent: string,
        style?: string,
    ) {

        const imagePromptInputTemplate = `You are tasked with generating an image prompt based on some Article content and a specified style.
        Your goal is to create a detailed and vivid image prompt that captures the essence of the content while incorporating an appropriate subject based on your analysis of the content.\n\nYou will be given the following inputs:\n<content>\nTitle: ${articleTitle}\nContent: ${articleContent}\n</content>\n\n<style>\n${style || STYLE}\n</style>\n\nA good image prompt consists of the following elements:\n\n

        1. Main subject
        2. Detailed description
        3. Style
        4. Lighting
        5. Composition
        6. Quality modifiers

        To generate the image prompt, follow these steps:\n\n1. Analyze the content text carefully, identifying key themes, emotions, and visual elements mentioned or implied.
        \n\n

        2. Determine the most appropriate main subject by:
        - Identifying concrete objects or persons mentioned in the content
        - Analyzing the central theme or message
        - Considering metaphorical representations of abstract concepts
        - Selecting a subject that best captures the content's essence

        3. Determine an appropriate environment or setting based on the content's context and your chosen subject.

        4. Decide on suitable lighting that enhances the mood or atmosphere of the scene.

        5. Choose a color palette that reflects the content's tone and complements the subject.

        6. Identify the overall mood or emotion conveyed by the content.

        7. Plan a composition that effectively showcases the subject and captures the content's essence.

        8. Incorporate the specified style into your description, considering how it affects the overall look and feel of the image.

        9. Use concrete nouns and avoid abstract concepts when describing the main subject and elements of the scene.

        Construct your image prompt using the following structure:\n\n
        1. Main subject: Describe the primary focus of the image based on your analysis
        2. Environment: Detail the setting or background
        3. Lighting: Specify the type and quality of light in the scene
        4. Colors: Mention the key colors and their relationships
        5. Mood: Convey the overall emotional tone
        6. Composition: Describe how elements are arranged in the frame
        7. Style: Incorporate the given style into the description

        Ensure that your prompt is detailed, vivid, and incorporates all the elements mentioned above while staying true to the content and the specified style. LIMIT the image prompt 50 words or less. \n\nWrite a prompt. Only include the prompt and nothing else.`;

        const imagePrompt = await generateText({
            runtime,
            context: imagePromptInputTemplate,
            modelClass: ModelClass.MEDIUM,
        });

        return imagePrompt;

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
}

export const BackroomClientInterface: Client = {
    start: async (_runtime: IAgentRuntime, serverIp: string = "localhost", opts: BackroomClientOptions = { withTwitter: false, useIqRPC: false }) => {
        elizaLogger.info("BackroomClientInterface start");
        const client = new BackroomClient(opts);
        const serverPort = parseInt(
            getEnvVariable("BACKROOM_SERVER_PORT", "3006")
        );
        elizaLogger.info(`Server running at http://${serverIp}:${serverPort}/`);
        client.start(serverPort);
        return client;
    },
    stop: async (_runtime: IAgentRuntime, client?: any) => {
        if (client instanceof BackroomClient) {
            client.stop();
        }
    },
};

export default BackroomClientInterface;
