import { IAgentRuntime } from "@elizaos/core";
import { z } from "zod";

export const perplexityEnvSchema = z.object({
    PERPLEXITY_API_KEY: z.string({
        required_error:
            "PERPLEXITY_API_KEY is required for Perplexity API plugin",
    }),
    PERPLEXITY_MODEL: z.string({
        required_error:
            "PERPLEXITY_MODEL is required for Perplexity API plugin",
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
            PERPLEXITY_MODEL:
                runtime.getSetting("PERPLEXITY_MODEL") ||
                process.env.PERPLEXITY_MODEL,
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
