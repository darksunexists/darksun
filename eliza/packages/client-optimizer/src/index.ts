import bodyParser from "body-parser";
import cors from "cors";
import express from "express";
import multer from "multer";
import { elizaLogger, generateCaption, generateImage } from "@elizaos/core";
import { composeContext } from "@elizaos/core";
import { generateMessageResponse } from "@elizaos/core";
import { messageCompletionFooter } from "@elizaos/core";
import { AgentRuntime } from "@elizaos/core";
import {
    Content,
    Memory,
    ModelClass,
    Client,
    IAgentRuntime,
} from "@elizaos/core";
import { stringToUuid } from "@elizaos/core";
import { settings } from "@elizaos/core";
import { createApiRouter } from "./api.ts";
import * as fs from "fs";
import * as path from "path";
const upload = multer({ storage: multer.memoryStorage() });

export const messageHandlerTemplate =
    // {{goals}}
    `# Action Examples
{{actionExamples}}
(Action examples are for reference only. Do not use the information from them in your response.)

# Knowledge
{{knowledge}}

# Task: Generate dialog and actions for the character {{agentName}}.
About {{agentName}}:
{{bio}}
{{lore}}

{{providers}}

{{attachments}}

# Capabilities
Note that {{agentName}} is capable of reading/seeing/hearing various forms of media, including images, videos, audio, plaintext and PDFs. Recent attachments have been included above under the "Attachments" section.

{{messageDirections}}

{{recentMessages}}

{{actions}}

# Instructions: Write the next message for {{agentName}}.
` + messageCompletionFooter;

// Move interfaces to module level
interface Engagement {
    followers: number;
    following: number;
    tweets: number;
    likes: number;
    retweets: number;
}

interface TwitterProfile {
    id: string;
    username: string;
    screenName: string;
    bio: string;
    nicknames: string[];
}

interface OptimizeOptions {
    opts: {
        dryRun: boolean;
        verbose: boolean;
        maxIterations: number;
    }
}

interface Optimization {
    success: boolean;
    valuesUpdated: CharacterValues;
}

interface CharacterValues {
    [key: string]: string;
}

export class XOptimizerClient {
    public app: express.Application;
    private agents: Map<string, AgentRuntime>; // container management
    private server: any; // Store server instance
    public startAgent: Function; // Store startAgent functor

    constructor() {
        elizaLogger.log("DirectClient constructor");
        this.app = express();
        this.app.use(cors());
        this.agents = new Map();

        this.app.use(bodyParser.json());
        this.app.use(bodyParser.urlencoded({ extended: true }));

        const apiRouter = createApiRouter(this.agents, this);
        this.app.use(apiRouter);

        this.app.post(
            "/:agentId/whisper",
            upload.single("file"),
            async (req: express.Request, res: express.Response) => {
                const audioFile = req.file; // Access the uploaded file using req.file
                const agentId = req.params.agentId;

                if (!audioFile) {
                    res.status(400).send("No audio file provided");
                    return;
                }

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

                const formData = new FormData();
                const audioBlob = new Blob([audioFile.buffer], {
                    type: audioFile.mimetype,
                });
                formData.append("file", audioBlob, audioFile.originalname);
                formData.append("model", "whisper-1");

                const response = await fetch(
                    "https://api.openai.com/v1/audio/transcriptions",
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${runtime.token}`,
                        },
                        body: formData,
                    }
                );

                const data = await response.json();
                res.json(data);
            }
        );

    /**
     * Optimize the agent's behavior
     * 
     * @param agentId - The ID of the agent to optimize
     * @param twitterProfile - The Twitter profile of the agent
     * @param engagement - The engagement of the agent
     * @param opts - The optimization options
     */
        this.app.get("/agents/:agentId/optimize", 
            async (req: express.Request, res: express.Response) => {

                const { agentId, twitterProfile, engagement, opts } = req.body;

                const agent = this.agents.get(agentId);


                if (!agent) {
                    res.status(404).json({ error: "Agent not found" });
                    return;
                }

                const optimizedTweets = await this.optimize(agent, twitterProfile, engagement, opts);

                await this.updateDatabase(agent, [optimizedTweets]);

                res.json({ optimized: optimizedTweets });
            }
        );

        this.app.post("/:agentId/message",
            async (req: express.Request, res: express.Response) => {
                const agentId = req.params.agentId;
                const roomId = stringToUuid(
                    req.body.roomId ?? "default-room-" + agentId
                );
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
                    modelClass: ModelClass.LARGE,
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

        this.app.post("/:agentId/image",
            async (req: express.Request, res: express.Response) => {
                const agentId = req.params.agentId;
                const agent = this.agents.get(agentId);
                if (!agent) {
                    res.status(404).send("Agent not found");
                    return;
                }

                const images = await generateImage({ ...req.body }, agent);
                const imagesRes: { image: string; caption: string }[] = [];
                if (images.data && images.data.length > 0) {
                    for (let i = 0; i < images.data.length; i++) {
                        const caption = await generateCaption(
                            { imageUrl: images.data[i] },
                            agent
                        );
                        imagesRes.push({
                            image: images.data[i],
                            caption: caption.title,
                        });
                    }
                }
                res.json({ images: imagesRes });
            }
        );

        this.app.post("/fine-tune",
            async (req: express.Request, res: express.Response) => {
                try {
                    const response = await fetch(
                        "https://api.bageldb.ai/api/v1/asset",
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "X-API-KEY": `${process.env.BAGEL_API_KEY}`,
                            },
                            body: JSON.stringify(req.body),
                        }
                    );

                    const data = await response.json();
                    res.json(data);
                } catch (error) {
                    res.status(500).json({
                        error: "Please create an account at bakery.bagel.net and get an API key. Then set the BAGEL_API_KEY environment variable.",
                        details: error.message,
                    });
                }
            }
        );

        this.app.get("/fine-tune/:assetId",
            async (req: express.Request, res: express.Response) => {
                const assetId = req.params.assetId;
                const downloadDir = path.join(
                    process.cwd(),
                    "downloads",
                    assetId
                );

                console.log("Download directory:", downloadDir);

                try {
                    console.log("Creating directory...");
                    await fs.promises.mkdir(downloadDir, { recursive: true });

                    console.log("Fetching file...");
                    const fileResponse = await fetch(
                        `https://api.bageldb.ai/api/v1/asset/${assetId}/download`,
                        {
                            headers: {
                                "X-API-KEY": `${process.env.BAGEL_API_KEY}`,
                            },
                        }
                    );

                    if (!fileResponse.ok) {
                        throw new Error(
                            `API responded with status ${fileResponse.status}: ${await fileResponse.text()}`
                        );
                    }

                    console.log("Response headers:", fileResponse.headers);

                    const fileName =
                        fileResponse.headers
                            .get("content-disposition")
                            ?.split("filename=")[1]
                            ?.replace(/"/g, /* " */ "") || "default_name.txt";

                    console.log("Saving as:", fileName);

                    const arrayBuffer = await fileResponse.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);

                    const filePath = path.join(downloadDir, fileName);
                    console.log("Full file path:", filePath);

                    await fs.promises.writeFile(filePath, buffer);

                    // Verify file was written
                    const stats = await fs.promises.stat(filePath);
                    console.log(
                        "File written successfully. Size:",
                        stats.size,
                        "bytes"
                    );

                    res.json({
                        success: true,
                        message: "Single file downloaded successfully",
                        downloadPath: downloadDir,
                        fileCount: 1,
                        fileName: fileName,
                        fileSize: stats.size,
                    });
                } catch (error) {
                    console.error("Detailed error:", error);
                    res.status(500).json({
                        error: "Failed to download files from BagelDB",
                        details: error.message,
                        stack: error.stack,
                    });
                }
            }
        );
    }

    //

    private async optimize(
        agent: AgentRuntime, 
        twitterProfile: TwitterProfile, 
        engagement: Engagement, 
        opts: OptimizeOptions
    ): Promise<Optimization> {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { dryRun, verbose, maxIterations } = opts.opts;

        // First, analyze the engagement metrics to understand what works
        await this.ingestTweet(agent, engagement);
        
        const messageId = stringToUuid(Date.now().toString());
        const userId = stringToUuid('optimizer');
        const roomId = stringToUuid('optimization-room');

        const analysisContent: Content = {
            text: `
            # Twitter Profile Analysis Request
            
            Profile Information:
            ${JSON.stringify(twitterProfile, null, 2)}
            
            Engagement Metrics:
            ${JSON.stringify(engagement, null, 2)}
            
            Please analyze this Twitter profile and engagement data. 
            Suggest specific improvements to:
            1. Tone of voice
            2. Response style
            3. Personality traits
            4. Content focus areas
            
            Focus on concrete changes that would increase engagement.`,
            attachments: [],
            source: 'optimizer',
            inReplyTo: undefined
        };


        const analysisMemory: Memory = {
            id: messageId,
            agentId: agent.agentId,
            userId,
            roomId,
            content: analysisContent,
            createdAt: Date.now()
        };

        // NOTE: With this memory stored, we can fetch it from the database 
        // in order to analyze them whenever we want.
        await agent.messageManager.createMemory(analysisMemory);

        const state = await agent.composeState({
            content: analysisContent,
            userId,
            roomId,
            agentId: agent.agentId
        }, {
            agentName: agent.character.name
        });

        const context = composeContext({
            state,
            template: messageHandlerTemplate
        });

        const analysis = await generateMessageResponse({
            runtime: agent,
            context,
            modelClass: ModelClass.LARGE
        });

        if (!analysis) {
            return { success: false, valuesUpdated: {} };
        }

        elizaLogger.info('Analysis: ', analysis.text);

        // Create optimization content based on the analysis
        const optimizationContent: Content = {
            text: `
            Current Character Configuration:
            Bio: {{bio}}
            Lore: {{lore}}

            Analysis Results: {{analysis}}

            Please generate specific updates to the character configuration in JSON format:
            {
                "bio": "updated bio text",
                "lore": "updated lore text",
                "traits": ["trait1", "trait2", ...]
            }`,
            attachments: [],
            source: 'optimizer',
            inReplyTo: messageId
        };

        // Create optimization memory
        const optimizationMemory: Memory = {
            id: stringToUuid(Date.now().toString()),
            agentId: agent.agentId,
            userId,
            roomId,
            content: optimizationContent,
            createdAt: Date.now()
        };

        await agent.messageManager.createMemory(optimizationMemory);

        // Compose new state for the optimization request
        const optimizationState = await agent.composeState({
            content: optimizationContent,
            userId,
            roomId,
            agentId: agent.agentId,
        }, {
            agentName: agent.character.name,
            analysis: analysis.text,
            bio: agent.character.bio,
            lore: agent.character.lore
        });

        // Generate the optimization response
        const optimizationResponse = await generateMessageResponse({
            runtime: agent,
            context: composeContext({
                state: optimizationState,
                template: messageHandlerTemplate
            }),
            modelClass: ModelClass.LARGE
        });

        if (!optimizationResponse) {
            return { success: false, valuesUpdated: {} };
        }

        elizaLogger.info('Optimization Response: ', optimizationResponse.text);

        try {
            // Try to parse the response as JSON
            const updates = JSON.parse(optimizationResponse.text);
            
            // Only apply changes if not in dry run mode
            if (!dryRun) {
                elizaLogger.info('Applying changes to character values');

                elizaLogger.info('Updating character values:', updates);

                const updatedValues: CharacterValues = {};
                if (updates.bio) updatedValues['bio'] = updates.bio;
                if (updates.lore) updatedValues['lore'] = updates.lore;
                if (updates.traits) updatedValues['traits'] = JSON.stringify(updates.traits);

                if (verbose) {
                    elizaLogger.log('Proposed updates:', updatedValues);
                }

                return {
                    success: true,
                    valuesUpdated: updatedValues
                };
            }

            return {
                success: true,
                valuesUpdated: {}
            };

        } catch (error) {
            elizaLogger.error('Failed to parse optimization response:', error);
            return {
                success: false,
                valuesUpdated: {}
            };
        }
    }

    private async ingestTweet(agent: AgentRuntime, twitterStats: Engagement): Promise<void> {
        const { followers, following, tweets, likes, retweets } = twitterStats;
        
        // Calculate engagement rates
        const engagementRate = (likes + retweets) / followers * 100;
        const retweetRate = retweets / tweets * 100;
        const likeRate = likes / tweets * 100;

        // Store these metrics in the agent's memory for learning
        await agent.messageManager.createMemory({
            id: stringToUuid(Date.now().toString()),
            agentId: agent.agentId,
            userId: agent.agentId,
            roomId: stringToUuid('twitter-analytics'),
            content: {
                text: JSON.stringify({
                    timestamp: Date.now(),
                    metrics: {
                        engagementRate,
                        retweetRate,
                        likeRate,
                        followers,
                        following,
                        tweets
                    }
                }),
                attachments: [],
                source: 'twitter-analytics'
            },
            createdAt: Date.now()
        });
    }

    private async updateDatabase(agent: AgentRuntime, optimizations: Optimization[]): Promise<void> {
        if (!optimizations.length || !optimizations[0].success) {
            return;
        }

        const updates = optimizations[0].valuesUpdated;
        
        // Update the character file
        if (updates.bio) agent.character.bio = updates.bio;
        if (updates.lore) agent.character.lore = [...updates.lore];

        // Store the optimization history
        await agent.messageManager.createMemory({
            id: stringToUuid(Date.now().toString()),
            agentId: agent.agentId,
            userId: agent.agentId,
            roomId: stringToUuid('optimization-history'),
            content: {
                text: JSON.stringify({
                    timestamp: Date.now(),
                    updates,
                    version: Date.now().toString()
                }),
                attachments: [],
                source: 'character-optimization'
            },
            createdAt: Date.now()
        });
    }

    // agent/src/index.ts:startAgent calls this
    public registerAgent(runtime: AgentRuntime) {
        this.agents.set(runtime.agentId, runtime);
    }

    public unregisterAgent(runtime: AgentRuntime) {
        this.agents.delete(runtime.agentId);
    }

    public start(port: number) {
        this.server = this.app.listen(port, () => {
            elizaLogger.success(
                `REST API bound to 0.0.0.0:${port}. If running locally, access it at http://localhost:${port}.`
            );
        });

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

export const XOptimizerClientInterface: Client = {
    start: async (_runtime: IAgentRuntime) => {
        elizaLogger.log("DirectClientInterface start");
        const client = new XOptimizerClient();
        const serverPort = parseInt(settings.SERVER_PORT || "3000");
        client.start(serverPort);
        return client;
    },
    stop: async (_runtime: IAgentRuntime, client?: Client) => {
        if (client instanceof XOptimizerClient) {
            client.stop();
        }
    },
};

export default XOptimizerClientInterface;
