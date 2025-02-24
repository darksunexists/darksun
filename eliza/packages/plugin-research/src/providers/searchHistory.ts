import { IAgentRuntime, Memory, Provider } from "@elizaos/core";

export const searchHistoryProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory) => {
        const allMemories = await runtime.messageManager.getMemories({
            roomId: message.roomId,
            count: 10, // Increased count since we're filtering after
        });

        const searchHistory = allMemories
            .filter((m) => m.content.action === "PERPLEXITY_SEARCH")
            .slice(0, 5)
            .map((m) => ({
                query: m.content.text,
                createdAt: m.createdAt,
            }));

        return JSON.stringify(searchHistory);
    },
};
