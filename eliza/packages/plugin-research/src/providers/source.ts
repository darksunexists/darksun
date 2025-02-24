import { IAgentRuntime, Memory, Provider } from "@elizaos/core";

export const sourceProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory) => {
        const allMemories = await runtime.messageManager.getMemories({
            roomId: message.roomId,
            count: 10,
        });

        const sources = allMemories
            .filter((m) => m.content.action === "PERPLEXITY_SEARCH")
            .flatMap((m) => {
                const metadata = m.content.metadata as {
                    citations?: Array<{ title: string; url: string }>;
                };
                return metadata?.citations || [];
            });

        return JSON.stringify(sources);
    },
};
