import { Action, composeContext, elizaLogger, generateMessageResponse, HandlerCallback, IAgentRuntime, Memory, ModelClass, State, Content, UUID, stringToUuid, ServiceType } from "@elizaos/core";
import { z } from "zod";
import { 
    backroomCompleteTemplate, 
    formatQueryTemplate, 
    perplexityRewriteTemplate, investigationValidationTemplate 
} from "../templates.ts";
import { PerplexitySearchResult } from "../types";
import { firecrawl, Firecrawl } from "../firecrawl.ts";
import { InvestigateBackroomService } from "../services/investigate-backroom.ts";
import type { Tweet } from "agent-twitter-client";

export const investigateAction: Action = {
    name: "INVESTIGATE",
    similes: ["INVESTIGATE", "RESEARCH", "INVESTIGATE_TOPIC", "INVESTIGATE_QUESTION", "INVESTIGATE_TWEET", "INVESTIGATE_TWEET_REPLY"],
    description: "To investigate deeper into a topic, question, or tweet",
    validate: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State
    ) => {

        const hasCredentials =
            !!process.env.TWITTER_USERNAME && !!process.env.TWITTER_PASSWORD;

        const hasPerplexityCredentials = !!process.env.PERPLEXITY_API_KEY;

        elizaLogger.log(`Has Twitter credentials: ${hasCredentials}`);
        elizaLogger.log(`Has Perplexity credentials: ${hasPerplexityCredentials}`);

        if (!hasCredentials || !hasPerplexityCredentials) {
            return false
        }

        if (!state.currentPost || !state.formattedConversation) {
            return false;
        }

        const hasInvestigationMemoryManager = runtime.getMemoryManager('investigations');

        if (!hasInvestigationMemoryManager) {
            elizaLogger.error("Investigation memory manager not found");
            return false;
        }

        const context = composeContext({
            state: {
                ...state,
            },
            template: investigationValidationTemplate,
        });

        elizaLogger.info("Investigation Validation Context: ", context);

        const response = await generateMessageResponse({
            runtime: runtime,
            context: context,
            modelClass: ModelClass.SMALL,
        });

        elizaLogger.info("Investigation validation response: ", response);

        const shouldInvestigate = response.shouldInvestigate;

        if (shouldInvestigate) {
            return true;
        }

        return false;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state?: State,
        options?: { [key: string]: unknown; },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("Investigating...");

        const investigationMemoryManager = runtime.getMemoryManager('investigations');

        if (!investigationMemoryManager) {
            elizaLogger.error("Investigation memory manager not found");
            return false;
        }

        if (!state) {
            elizaLogger.warn("Investigate action: State is undefined, composing state...");
            state = await runtime.composeState(message, options);
        }

        let firecrawlApp: Firecrawl;

        if (state.articleUrl && typeof state.articleUrl === "string") {
            firecrawlApp = await firecrawl(runtime, {
                apiKey: process.env.FIRECRAWL_API_KEY!,
                apiUrl: process.env.FIRECRAWL_API_URL ?? undefined,
                scrapeParams: {
                    formats: ["markdown"],
                    onlyMainContent: true,
                    waitFor: 3000,
                },
            });

            const scrapeResponse = await firecrawlApp.scrape(state.articleUrl);

            if (!scrapeResponse.success) {
                elizaLogger.error("Error scraping article:", scrapeResponse.error);
                elizaLogger.warn("Skipping article scraping");
            } else {
                state.articleTitle = scrapeResponse.metadata?.title;
                state.articleDescription = scrapeResponse.metadata?.description;
                state.articleContent = scrapeResponse.markdown;
            }
        }

        // NOTE: Now using the Backroom service to kickstart a backroom's conversation which will be handled by client-backroom

        const backroomService = runtime.getService<InvestigateBackroomService>(ServiceType.TEXT_GENERATION);

        const backroomResponse = await backroomService.startBackroomConversation(runtime, state);

        elizaLogger.info(`Backroom conversation: ${backroomResponse}`);

        // purposefully disable tweet generation for now
        if (false && backroomResponse) {
            const cleanedMessages = backroomResponse.backroomEntry.content.messages
                .map((message) => `[${message.agent}]: ${message.message}`)
                .join("\n\n");

            state.backroomConversation = cleanedMessages;

            const tweetResponse = await generateTweetResponse(runtime, state);

            elizaLogger.info(`Tweet response: ${tweetResponse.text}`);

            const tweet = state.tweet as Tweet;
            const userIdUUID = stringToUuid(tweet.userId as string);

            const backroomMemory: Memory = {
                agentId: runtime.agentId,
                roomId: message.roomId,
                content: {
                    text: tweetResponse.text,
                    backroomEntry: backroomResponse.backroomEntry,
                    investigationId: backroomResponse.investigationId,
                    purpose: "Created a final tweet response for investigation",
                },
                userId: userIdUUID,
                createdAt: Date.now(),
            }

            try {
                await investigationMemoryManager.addEmbeddingToMemory(backroomMemory);
                await investigationMemoryManager.createMemory(backroomMemory, true);
            } catch (error) {
                elizaLogger.error("Error creating investigation memory:", error);
            }

            callback(tweetResponse, {
                backroomId: backroomResponse.backroomId,
                investigationId: backroomResponse.investigationId,
            });

            return true;
        }

        return true;
    },
    examples: [
        // [
        //     {
        //         user: "{{user1}}",
        //         content: { text: "@darksun tell me more about this" },
        //     },
        //     {
        //         user: "{{agentName}}",
        //         content: {
        //             text: "I'll investigate this topic and get back to you soon.",
        //             action: "INVESTIGATE",
        //         },
        //     },
        // ],
    ],
};

async function formatQuery(runtime: IAgentRuntime, state: State): Promise<Content> {
    const context = composeContext({
        state: {
            ...state,
        },
        template: formatQueryTemplate,
    });

    elizaLogger.info("Format Query Context: ", context);

    const query = await generateMessageResponse({
        runtime: runtime,
        context: context,
        modelClass: ModelClass.SMALL,
    });

    return query;
}


export async function generateTweetResponse(runtime: IAgentRuntime, state: State): Promise<Content> {

    const context = composeContext({
        state: {
            ...state,
        },
        template: backroomCompleteTemplate,
    });

    elizaLogger.info("Backroom Complete Context: ", context);

    const response = await generateMessageResponse({
        runtime: runtime,
        context: context,
        modelClass: ModelClass.LARGE,
    });

    elizaLogger.info("Created Tweet Response: ", response);

    return response;
}

export const perplexityEnvSchema = z.object({
    PERPLEXITY_API_KEY: z.string({
        required_error:
            "PERPLEXITY_API_KEY is required for Perplexity API plugin",
    }),
});

export type PerplexityConfig = z.infer<typeof perplexityEnvSchema>;


export async function validatePerplexityConfig(
    runtime: IAgentRuntime
): Promise<PerplexityConfig> {
    try {
        const config = {
            PERPLEXITY_API_KEY:
                runtime.getSetting("PERPLEXITY_API_KEY") ||
                process.env.PERPLEXITY_API_KEY,
        };

        return perplexityEnvSchema.parse(config);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const errorMessages = error.errors
                .map((err) => `${err.path.join(".")}: ${err.message}`)
                .join("\n");
            throw new Error(
                `Perplexity configuration validation failed:\n${errorMessages}`
            );
        }
        throw error;
    }
}

async function searchPerplexity(
    query: string, 
    runtime: IAgentRuntime, 
): Promise<PerplexitySearchResult> {

       const MAX_RETRIES = 3;
        const TIMEOUT = 10000; // 10 seconds
        
        let retries = 0;
        while (retries < MAX_RETRIES) {
            try {
                // Get character's personality
                const character = runtime.character;
                const originalQuery = query;

                const config = await validatePerplexityConfig(runtime);

                // Now perform the actual search with the enhanced query
                const options = {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${config.PERPLEXITY_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: "llama-3.1-sonar-small-128k-online",
                        messages: [
                            {
                                role: "system",
                                content: `You are ${character.name}. ${
                                    "You are an expert at researching and analyzing data. You are also a great writer and can write in a way that is both informative and engaging."
                                }\n\nRespond in character while following these STRICT RULES:
                                2. Present the strongest evidence and most interesting findings first
                                3. Focus on "what if" scenarios and potential connections
                                4. Acknowledge uncertainty as an opportunity for discovery
                                5. Use your character's unique perspective to analyze patterns
                                6. Maintain your character's voice while being direct
                                7. NO meta-commentary about searching or processing
                                8. ONE complete response that builds interest
                                9. Only use citation numbers when actual sources exist
                                10. Do not include sources text in the response`,
                            },
                            {
                                role: "user",
                                content: query,
                            },
                        ],
                        temperature: 0.2,
                        top_p: 0.9,
                        search_domain_filter: [], // Allow all domains for comprehensive search
                        return_images: false,
                        return_related_questions: false,
                        search_recency_filter: "year", // Extend search window to find more research
                        top_k: 5, // Increase number of results
                        stream: false,
                        presence_penalty: 0,
                        frequency_penalty: 1,
                    }),
                };

                const response = await fetch(
                    "https://api.perplexity.ai/chat/completions",
                    options
                );
                const result = await response.json();

                if (!response.ok) {
                    throw new Error(
                        `Perplexity API error: ${result.error?.message || "Unknown error"}`
                    );
                }

                let content =
                    result.choices[0]?.message?.content || "No response content";

                // Remove citation numbers when no sources exist
                if (!result.citations?.length && content.match(/\[\d+\]/)) {
                    content = content.replace(/\[\d+\]/g, "");
                }

                // Filter out "I am currently..." type responses
                if (content.match(/I am (currently|now|presently|actively)/i)) {
                    content = content.replace(/^.*?(?=\n|$)/m, "").trim();
                }

                // Filter out any "Sources: " text as well as any [1], [2], [3] etc.
                if (content.match(/Sources:/)) {
                    content = content.replace(/Sources: .*|\[\d+\]/g, "");
                }

                // Filter out [1], [2], [3] etc.
                if (content.match(/\[\d+\]/)) {
                    content = content.replace(/\[\d+\]/g, "");
                }

                // Take the response from perplexity and write it in the agent's own words

                const formattedResponse = {
                    text: content,
                    metadata: {
                        model: result.model,
                        usage: result.usage,
                        created: result.created,
                        citations: result.citations || [],
                        query: originalQuery,
                        // enhancedQuery,
                        hasSourceCitations: result.citations?.length > 0,
                        character: character.name,
                    },
                };

                elizaLogger.info('Perplexity search result (formatted):', formattedResponse);

                return formattedResponse;
            } catch (error) {
                retries++;
                if (retries === MAX_RETRIES) throw error;
            }

        }
}

async function rewritePerplexityResponse(rawText: string, runtime: IAgentRuntime, state: State, roomId: UUID): Promise<Content> {

        const content: Content = {
            text: rawText,
            attachments: [],
            inReplyTo: undefined,
        };

        const systemMessage = {
            content,
            userId: stringToUuid("system-investigateRewrite"),
            roomId: roomId,
            agentId: runtime.agentId,
        };

        state.adjectives = runtime.character.adjectives.join(", ");

        const context = composeContext({
            state,
            template: perplexityRewriteTemplate,
        });

        elizaLogger.info("Perplexity Rewrite Context: ", context);

        const response = await generateMessageResponse({
            runtime: runtime,
            context,
            modelClass: ModelClass.SMALL,
        });

        elizaLogger.info("Perplexity Rewrite Response: ", response.text);

        if (!response.text) {
            throw new Error("No response from generateMessageResponse");
        }

        return response;
}