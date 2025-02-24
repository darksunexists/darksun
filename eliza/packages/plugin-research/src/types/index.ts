export interface PerplexitySearchResult {
    answer: string;
    query: string;
    sources: Array<{
        title: string;
        url: string;
        snippet: string;
    }>;
}
