import { elizaLogger, IAgentRuntime } from '@elizaos/core';
import FirecrawlApp, { CrawlParams, CrawlStatusResponse, ErrorResponse, ScrapeParams, ScrapeResponse } from '@mendable/firecrawl-js';


// The point of this file will be to create a function that will take in a url, we will crawl the website using firecrawl, and then we return the main content of the website as a string.

// export const firecrawlWebsite = async (url: string) => {
//     const response = await firecrawl.crawl(url);
//     return response.content;
// };

interface CrawlResult {
    content: string;
    url: string;
}

export interface FirecrawlOptions {
    apiKey?: string;
    apiUrl?: string;
    crawlParams?: CrawlParams;
    scrapeParams?: ScrapeParams;
}

export class Firecrawl {
    private firecrawlApp: FirecrawlApp;
    private scrapeParams: ScrapeParams;

    constructor(opts: FirecrawlOptions) {
        this.firecrawlApp = new FirecrawlApp({
            apiKey: opts.apiKey,
            apiUrl: opts.apiUrl,
        });
        this.scrapeParams = opts.scrapeParams || { formats: ["markdown"], waitFor: 3000 };
    }

    async scrape(url: string, params?: ScrapeParams): Promise<ScrapeResponse | ErrorResponse> {

        const response = await this.firecrawlApp.scrapeUrl(url, params || this.scrapeParams);

        elizaLogger.info("Scrape response:", response);

        if (!response.success) {
            elizaLogger.error("Error crawling website");
            elizaLogger.info("Error response:", response);
            return response as ErrorResponse;
        }

        elizaLogger.info("Scrape response:", response);

        return response as ScrapeResponse;
    }

}

// export const firecrawl = new Firecrawl({
//     apiKey: process.env.FIRECRAWL_API_KEY!,
// });

export const firecrawl = async (runtime: IAgentRuntime, options?: FirecrawlOptions) => {

    const apiKey = runtime.getSetting("FIRECRAWL_API_KEY");
    const apiUrl = runtime.getSetting("FIRECRAWL_API_URL");

    if (!apiKey && !options?.apiKey) {
        elizaLogger.error("FIRECRAWL_API_KEY is not set");
        throw new Error("FIRECRAWL_API_KEY is not set");
    }

    const firecrawlApp = new Firecrawl({
        apiKey: options?.apiKey || apiKey,
        apiUrl: options?.apiUrl || apiUrl,
        crawlParams: options?.crawlParams,
        scrapeParams: options?.scrapeParams,
    });

    return firecrawlApp;
}