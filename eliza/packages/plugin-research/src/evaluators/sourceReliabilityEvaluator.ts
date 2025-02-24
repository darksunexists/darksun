import { Evaluator, IAgentRuntime, Memory } from "@elizaos/core";
import { PerplexitySearchResult } from "../types/index.ts";

export const sourceReliabilityEvaluator: Evaluator = {
    name: "SOURCE_RELIABILITY",
    description: "Assesses the reliability of sources",
    similes: ["RELIABILITY", "CREDIBILITY", "TRUSTWORTHINESS"],
    examples: [
        {
            context: "Search using academic and government sources",
            messages: [
                {
                    user: "Agent",
                    content: {
                        text: "What are the latest climate change statistics?",
                        action: "PERPLEXITY_SEARCH",
                        result: {
                            sources: [
                                {
                                    title: "Climate Report",
                                    url: "epa.gov",
                                    snippet: "Official statistics",
                                },
                                {
                                    title: "Research Paper",
                                    url: "university.edu",
                                    snippet: "Academic research",
                                },
                            ],
                            answer: "Recent climate data from reliable sources",
                        },
                    },
                },
            ],
            outcome: "High reliability with .gov and .edu domain sources",
        },
    ],
    validate: async () => true,
    handler: async (runtime: IAgentRuntime, message: Memory) => {
        const state = await runtime.composeState(message);
        console.log(`Evaluating source reliability for room ${state.roomId}`);

        if (message.content.action !== "PERPLEXITY_SEARCH") {
            console.log(`[${state.agentId}] Not a Perplexity search action`);
            return null;
        }

        const result = message.content.result as PerplexitySearchResult;
        const reliableSources = result.sources.filter(
            (s) =>
                s.url.includes(".edu") ||
                s.url.includes(".gov") ||
                s.url.includes(".org")
        ).length;

        console.log(
            `[${state.agentId}] Source reliability evaluation for room ${state.roomId}: ${reliableSources} reliable sources found`
        );

        return {
            reliableSources,
            roomId: state.roomId,
            agentId: state.agentId,
        };
    },
};
