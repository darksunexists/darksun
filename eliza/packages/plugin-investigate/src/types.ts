import { Memory, Service, State, UUID } from "@elizaos/core";
import { IAgentRuntime } from "@elizaos/core";
import { z } from "zod";
import { Tweet } from "agent-twitter-client";

export interface TweetContent {
    text: string;
}

export const TweetSchema = z.object({
    text: z.string().describe("The text of the tweet"),
});

export const isTweetContent = (obj: any): obj is TweetContent => {
    return TweetSchema.safeParse(obj).success;
};

export type InvestigateUpdateType = 
  | 'RUNTIMES_READY'
  | 'INITIAL_QUESTION'
  | 'CONVERSATION_START'
  | 'CONVERSATION_UPDATE'
  | 'CONVERSATION_COMPLETE'
  | 'METADATA_READY'
  | 'IQ_RESULT'
  | 'BACKROOM_ENTRY_CREATED'
  | 'INVESTIGATION_ENTRY_CREATED'
  | 'COMPLETE';

export interface InvestigateUpdate {
  type: InvestigateUpdateType;
  data: any;
}

export interface InvestigationTriggerResponse {
    success: boolean;
    message: string;
    data: BackroomServiceResponse | null;
    updates?: InvestigateUpdate[];
}

export interface PerplexitySearchResult {
    text: string;
    metadata: {
        model: string;
        usage: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
        created: number;
        citations: string[];
        query: string;
        hasSourceCitations: boolean;
        character: string;
        enhancedQuery?: string;
    };
}

export interface ConversationMessage {
    id: string;
    agent: string;
    message: string;
    timestamp: string;
    citations?: string[];
}

export interface BackroomEntry {
    id: UUID;
    topic: string;
    title: string;
    question: string;
    content: {
        participants: string[];
        messages: ConversationMessage[];
    };
    iqTxHash: string | null;
    citations: string[];
    tweetUrl: string | null;
}

export interface BackroomServiceResponse {
    success: boolean;
    backroomEntry: BackroomEntry;
    backroomId: UUID;
    investigationId: UUID;
}

export interface InvestigationTriggerResponse {
    success: boolean;
    message: string;
    data: BackroomServiceResponse;
    updates?: InvestigateUpdate[];
}

export interface IInvestigateBackroomService extends Service {
    startBackroomConversation(runtime: IAgentRuntime, state: State): Promise<BackroomServiceResponse | null>;
    
}
