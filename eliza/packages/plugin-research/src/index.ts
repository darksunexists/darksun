import { Plugin } from "@elizaos/core";
import { searchHistoryProvider } from "./providers/searchHistory.ts";
import { sourceProvider } from "./providers/source.ts";
import { searchQualityEvaluator } from "./evaluators/searchQualityEvaluator.ts";
import { sourceReliabilityEvaluator } from "./evaluators/sourceReliabilityEvaluator.ts";
import { perplexitySearch } from "./actions/search.ts";

export const researchPlugin: Plugin = {
    name: "perplexity",
    description: "Perplexity Plugin for Eliza. To be used when you need to search the web for information.",
    actions: [perplexitySearch],
    evaluators: [searchQualityEvaluator, sourceReliabilityEvaluator],
    providers: [searchHistoryProvider, sourceProvider],
};

export default researchPlugin;
