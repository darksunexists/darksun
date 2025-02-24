import { elizaLogger, getEnvVariable, IAgentRuntime, Memory, Service, ServiceType, State } from "@elizaos/core";
import type {
    BackroomServiceResponse,
    IInvestigateBackroomService,
} from "../types";

import { tasks } from "@trigger.dev/sdk/v3";

import type { Tweet } from "agent-twitter-client";
import { investigationTask, MinimalArticle, InvestigateParams } from "@elizaos/service-trigger";

export class InvestigateBackroomService extends Service implements IInvestigateBackroomService {
    static serviceType: ServiceType = ServiceType.TEXT_GENERATION;

    async initialize(runtime: IAgentRuntime): Promise<void> {
        elizaLogger.info("Initializing investigateBackroom service");
    }

    async startBackroomConversation(runtime: IAgentRuntime, state: State): Promise<BackroomServiceResponse | null> {
        elizaLogger.info("Starting backroom conversation");

        let article: MinimalArticle | null = null;

        if (state.articleTitle && state.articleDescription && state.articleContent && state.articleUrl) {
            article = {
                title: state.articleTitle as string,
                description: state.articleDescription as string,
                content: state.articleContent as string,
                url: state.articleUrl as string,
            }
        } else {
            article = null;
        }

        const baseUrl= runtime.getSetting("INVESTIGATE_CLIENT_URL");
        const path = runtime.getSetting("INVESTIGATE_CLIENT_PATH");
        const url = `${baseUrl}${path}`;

        const investigateParams: InvestigateParams = {
            twitterAgentId: runtime.agentId,
            darksunId: runtime.agentId,
            roomId: state.roomId,
            agentName: state.agentName,
            article: article,
            currentPost: state.currentPost as string,
            formattedConversation: state.formattedConversation as string,
            originalMessage: state.originalMessage as Memory,
            tweet: state.tweet as Tweet,
            withIq: false
        }

        const investigateTask = await tasks.triggerAndPoll<typeof investigationTask>(
            "investigation",
            {
                investigateParams,
                url,
            },
            {
                pollIntervalMs: 10000,
                maxAttempts: 1,
                maxDuration: 100000, // 10 minutes
                tags: ["investigate"],
            }
        );

        if (investigateTask.isCompleted && investigateTask.output) {

            const output = investigateTask.output

            elizaLogger.info("Investigation output", output);

            return {
                success: output.success,
                backroomEntry: output.data.backroomEntry,
                backroomId: output.data.backroomId,
                investigationId: output.data.investigationId,
            }
        }

        elizaLogger.error("Failed to start backroom conversation");

        return null;
    }
}
