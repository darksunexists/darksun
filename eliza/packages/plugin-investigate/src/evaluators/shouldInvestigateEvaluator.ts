import { elizaLogger, Evaluator, IAgentRuntime, Memory, State } from "@elizaos/core";

export const shouldInvestigateEvaluator: Evaluator = {
    name: "SHOULD_INVESTIGATE",
    description: "Evaluates if a tweet should be investigated further",
    similes: ["SHOULD_INVESTIGATE", "SHOULD_RESEARCH", "SHOULD_INVESTIGATE_TOPIC", "SHOULD_INVESTIGATE_QUESTION", "SHOULD_INVESTIGATE_TWEET", "RESEARCH_TWEET", "RESEARCH_QUESTION", "RESEARCH_TOPIC"],
    validate: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
        const hasCredentials =
            !!process.env.TWITTER_USERNAME && !!process.env.TWITTER_PASSWORD;


        elizaLogger.log(`Has Twitter credentials: ${hasCredentials}`);

        return hasCredentials;
    },
    handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: { [key: string]: unknown; }) => {

        if (!state) {
            state = await runtime.composeState(message, options);
        }

        const shouldInvestigate = await runtime.evaluate(message, state);

        elizaLogger.log(`Should investigate: ${shouldInvestigate}`);

        return true;
    },
    examples: [
        {
            context: "Tweet asking about quantum computing",
            messages: [
                {
                    user: "{{user1}}",
                    content: { text: "@darksun tell me more about this" },
                },
            ],
            outcome: "True",
        },
        {
            context: "Tweet explaining the nature of our universe",
            messages: [
                {
                    user: "{{user1}}",
                    content: { text: "@darksun what are you thoughts on this?" },
                },
            ],
            outcome: "True",
        },
        {
            context: "Tweet talking about the weather",
            messages: [
                {
                    user: "{{user1}}",
                    content: { text: "@darksun what is the weather like in the bay area?" },
                },
            ],
            outcome: "False",
        },
        {
            context: "Tweet asking about a topic not related to {{topics}}",
            messages: [
                {
                    user: "{{user1}}",
                    content: { text: "@darksun what is the price of ETH?" },
                },
            ],
            outcome: "False",
        }
    ],
};
