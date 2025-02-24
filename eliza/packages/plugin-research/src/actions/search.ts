import {
    Action,
    IAgentRuntime,
    Memory,
    State,
    HandlerCallback,
    generateMessageResponse,
    AgentRuntime,
    Content,
    UUID,
    stringToUuid,
    ModelClass,
    composeContext,
    generateText,
} from "@elizaos/core";
import { elizaLogger } from "@elizaos/core";
import { validatePerplexityConfig } from "../environment.ts";
import dotenv from "dotenv";
import path from "path";

const perplexitySearchFooter = "\nResponse format should be formatted in a JSON block like this:\n```json\n{ \"user\": \"{{agentName}}\", \"text\": \"string\" } \n```";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

async function rewritePerplexityResponse(rawText: string, runtime: IAgentRuntime, roomId: UUID): Promise<string> {

        const perplexityRewriteTemplate = `
        You are {{agentName}}
        About {{agentName}}:
        {{bio}}
        {{lore}}

        Task: Rewrite the following text from the perspective of {{agentName}}:
        {{rawText}}

        [INSTRUCTIONS]:
        1. Rewrite the text in the style of {{agentName}}, and from the perspective of {{agentName}}
        2. Make sure the rewritten text keeps the same meaning and information as the original text
        3. Write this as a direct response to someone in a conversation. Structure it well but keep it in a conversastional tone.
        4. Do not include any other text in your response, only the rewritten text in your final response
        5. You are {{agentName}}, so write your response as if you were {{agentName}}, with no other text than {{agentName}}'s response
        6. If applicable, remove any internal chain of thought or reasoning from the original text. Just write the response.
        `;

        const content: Content = {
            text: "Rewrite perplexity response",
            attachments: [],
            inReplyTo: undefined,
        };

        const systemMessage = {
            content,
            userId: stringToUuid("system-backroomRewrite"),
            roomId: roomId,
            agentId: runtime.agentId,
        };

        // const memory: Memory = {
        //     id: stringToUuid(Date.now().toString()),
        //     userId: stringToUuid("system-backroomRewrite"),
        //     agentId: runtime.agentId,
        //     roomId: roomId,
        //     content,
        //     createdAt: Date.now(),
        // };

        // await runtime.messageManager.addEmbeddingToMemory(memory);
        // await runtime.messageManager.createMemory(memory, true);

        const state = await runtime.composeState(systemMessage, {
            rawText: rawText,
        });

        const context = composeContext({
            state,
            template: perplexityRewriteTemplate,
        });

        elizaLogger.info("Perplexity Rewrite Context: ", context);

        const response = await generateText({
            runtime: runtime,
            context,
            modelClass: ModelClass.LARGE,
        });

        elizaLogger.info("Perplexity Rewrite Response: ", response);

        if (!response) {
            throw new Error("No response from generateMessageResponse");
        }

        return response;
}

export const perplexitySearch: Action = {
    name: "PERPLEXITY_SEARCH",
    similes: [
        "SEARCH",
        "LOOK_UP",
        "FIND_INFO",
        "RESEARCH",
        "INVESTIGATE",
        "QUERY",
    ],
    description: "Search for information using Perplexity API. To be used when you need to search the web for up to date information.",
    validate: async (runtime: IAgentRuntime, _message: Memory) => {
        try {
            await validatePerplexityConfig(runtime);
            return true;
        } catch (error) {
            elizaLogger.error("Perplexity plugin validation failed:", error);
            return false;
        }
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state: State | undefined,
        _options: any,
        callback: HandlerCallback | undefined
    ): Promise<unknown> => {
        const MAX_RETRIES = 3;
        const TIMEOUT = 10000; // 10 seconds


        const config = await validatePerplexityConfig(runtime);

        let retries = 0;
        while (retries < MAX_RETRIES) {
            try {
                // Get character's personality
                const character = runtime.character;
                const originalQuery = message.content.text;

                // Enhance query with character's perspective
                const queryFormulation = {
                    model: config.PERPLEXITY_MODEL,
                    messages: [
                        {
                            role: "system",
                            content: `You are ${character.name}. ${
                                character.system || ""
                            }\n\nReformulate the search query based on your knowledge, expertise, and character traits. Focus on discovering hidden connections and compelling evidence.`,
                        },
                        {
                            role: "user",
                            content: `Original query: "${originalQuery}"\nCharacter context: ${
                                Array.isArray(character.bio)
                                    ? character.bio.join(" ")
                                    : character.bio || ""
                            }\n\nProvide ONLY the enhanced search query, no explanation.`,
                        },
                    ],
                };
                // Get the reformulated query
                const queryResponse = await fetch(
                    "https://api.perplexity.ai/chat/completions",
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${config.PERPLEXITY_API_KEY}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(queryFormulation),
                    }
                );

                const queryResult = await queryResponse.json();
                const enhancedQuery =
                    queryResult.choices[0]?.message?.content || originalQuery;

                elizaLogger.info(
                    `${character.name} is searching Perplexity for: ${enhancedQuery}`
                );

                // Now perform the actual search with the enhanced query
                const options = {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${config.PERPLEXITY_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        model: config.PERPLEXITY_MODEL,
                        messages: [
                            {
                                role: "system",
                                content: `You are ${character.name}. ${
                                    character.system || ""
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
                                content: enhancedQuery,
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

                const rewrittenResponse = await rewritePerplexityResponse(content, runtime, message.roomId);

                const formattedResponse = {
                    text: rewrittenResponse,
                    metadata: {
                        model: result.model,
                        usage: result.usage,
                        created: result.created,
                        citations: result.citations || [],
                        query: originalQuery,
                        enhancedQuery,
                        hasSourceCitations: result.citations?.length > 0,
                        character: character.name,
                    },
                };


                if (callback) {
                    elizaLogger.info("Calling callback");
                    const [newMemory] = await callback(formattedResponse);

                    await runtime.messageManager.createMemory(newMemory, true);

                    return null;
                }

                elizaLogger.info('Perplexity search result (formatted):', formattedResponse);

                return formattedResponse;
            } catch (error) {
                retries++;
                if (retries === MAX_RETRIES) throw error;
            }
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: { text: "What is the capital of France?" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "Let me search that for you",
                    action: "PERPLEXITY_SEARCH",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: { text: "Find information about quantum computing" },
            },
            {
                user: "{{agentName}}",
                content: {
                    text: "I'll look that up for you",
                    action: "PERPLEXITY_SEARCH",
                },
            },
        ],
    ],
};
