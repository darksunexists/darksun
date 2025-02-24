import { Evaluator, IAgentRuntime, Memory } from "@elizaos/core";
import { PerplexitySearchResult } from "../types/index.ts";

export const searchQualityEvaluator: Evaluator = {
    name: "SEARCH_QUALITY",
    description: "Evaluates the quality and relevance of search results",
    similes: ["QUALITY", "RELEVANCE", "SEARCH_ASSESSMENT"],
    examples: [
        {
            context: "Search for information about quantum computing",
            messages: [
                {
                    user: "Agent",
                    content: {
                        text: "What is quantum computing?",
                        action: "PERPLEXITY_SEARCH",
                        result: {
                            sources: [
                                {
                                    title: "Introduction to Quantum Computing",
                                    url: "example.edu",
                                    snippet: "Detailed explanation",
                                },
                            ],
                            answer: "Comprehensive answer about quantum computing",
                        },
                    },
                },
            ],
            outcome:
                "High quality search with academic source and detailed answer",
        },
    ],
    validate: async () => true,
    handler: async (runtime: IAgentRuntime, message: Memory) => {
        const state = await runtime.composeState(message);
        console.log(`Evaluating search quality for room ${state.roomId}`);

        if (message.content.action !== "PERPLEXITY_SEARCH") {
            console.log(`[${state.agentId}] Not a Perplexity search action`);
            return null;
        }

        const result = message.content.result as PerplexitySearchResult;
        const quality = result.sources.length > 0 ? "high" : "low";

        console.log(
            `[${state.agentId}] Search quality evaluation for room ${state.roomId}: ${quality} (${result.sources.length} sources)`
        );

        return {
            quality,
            sourcesCount: result.sources.length,
            roomId: state.roomId,
            agentId: state.agentId,
        };
    },
};
