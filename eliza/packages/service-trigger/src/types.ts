import type { Content, Memory, UUID } from "@elizaos/core";
import type { Tweet } from "agent-twitter-client";
import type { Article, BackroomEntry } from "@elizaos/adapter-postgres";
import { TransitionEffectEnum } from "./types/longstories";

// Base response type
export interface BaseResponse {
    success: boolean;
    message: string;
}

// Response with data
export interface DataResponse<T> extends BaseResponse {
    data: T;
}

// Specific data types
export type BackroomOperationData = {
    backroomEntry: BackroomEntry;
    backroomId: UUID;
    investigationId: UUID;
};

// Task Response Types
export type InvestigationTriggerResponse = DataResponse<BackroomOperationData>;
export type BackroomServiceResponse = DataResponse<BackroomOperationData>;
export type ProcessSimilarityResponse = BaseResponse & { topic?: string };
export type BackroomCreatedResponse = BaseResponse;

export interface PostInvestigationTweetResponse extends BaseResponse {
    data?: {
        firstTweetUrl: string;
        tweetResponse: string;
        initialTweet?: Tweet;
        followupTweet?: Tweet;
    };
}

// Task Payload Types
export interface ProcessArticlesTriggerPayload {
    newBackroomId: string;
}

export interface ProcessSimilarityTriggerPayload {
    backroomId: string;
    topic: string;
}

export interface BackroomCreatedTriggerPayload {
    backroomId: string;
    topic: string;
}

export interface ArticleTweetPayload {
  articleContent: string;
  articleTitle: string;
  articleId: number;
}

export interface GenerateShortPayload {
  articleContent: string;
  articleTitle: string;
  articleId: number;
  videoParams: {
    effects?: {
      transition?: TransitionEffectEnum;
      floating?: boolean;
    };
    quality?: "low" | "medium" | "high";
    motionConfig?: {
      enabled: boolean;
      strength: number;
    }
  };
}

// Update Types
export type ProcessArticlesUpdateType = 'ARTICLE_UPDATE' | 'ARTICLE_COMPLETE' | 'ARTICLE_ERROR' | 'ARTICLE_START' | "ARTICLE_INFO";

export interface ProcessArticlesUpdate {
    type: ProcessArticlesUpdateType;
    data: any;
}

export type SimilarityUpdateType = 'SIMILARITY_UPDATE' | 'SIMILARITY_COMPLETE' | 'SIMILARITY_ERROR' | 'SIMILARITY_START' | 'NEW_SIMILARITY_CHECK';

export interface SimilarityUpdate {
    type: SimilarityUpdateType;
    data: any;
}

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

export interface MinimalArticle {
    title: string;
    description: string;
    content: string;
    url: string;
    imageUrl?: string;
}

export interface InvestigateParams {
    twitterAgentId: UUID;
    darksunId: UUID;
    roomId: UUID;
    agentName: string;
    currentPost: string;
    formattedConversation: string;
    originalMessage: Memory;
    tweet: Tweet;
    article?: MinimalArticle;
    withIq?: boolean;
}

export interface InvestigateTriggerPayload {
    investigateParams: InvestigateParams;
    url: string;
}

export interface TwitterCredentials {
  username: string;
  password: string;
  email?: string;
  twoFactorSecret?: string;
  cookies: string;
}

export interface MinimalTweet {
  id: string;
  username: string;
  text: string;
  tweetUrl?: string;
}

export interface PostInvestigationTweetPayload {
  investigateResponse: Content;
  backroomId: string;
  investigationId: UUID;
  tweet: MinimalTweet;
  twitterConfig: {
    MAX_INVESTIGATE_TWEET_LENGTH: number;
  };
}