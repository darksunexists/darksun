import { Article, BackroomEntry, ClusterWithBackrooms } from "@elizaos/adapter-postgres";
import type { UUID, Memory } from "@elizaos/core";

import type { Tweet } from "agent-twitter-client";

export interface InvestigateClientOptions {
    withTwitter: boolean;
    useIqRPC: boolean;
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
  | 'COMPLETE'
  | 'EXTRACTING_FEATURES'
  | 'GENERATED_TWEET_RESPONSE'
  | 'SEND_TWEET_TRIGGERED';

export interface InvestigateUpdate {
  type: InvestigateUpdateType;
  data: any;
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
    data: BackroomServiceResponse | null;
    updates?: InvestigateUpdate[];
}

export interface ConversationMessage {
    id: string;
    agent: string;
    message: string;
    timestamp: string;
    citations?: string[];
}

export interface ScrapedArticle {
    title: string;
    description: string;
    content: string;
    url: string;
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
    article?: ScrapedArticle;
    withIq?: boolean;
}

export interface FullCluster extends ClusterWithBackrooms { 
  article: Article;
}

export interface GenerateArticleParams  {
    twitterAgentId: UUID;
    darksunId: UUID;
    roomId: UUID;
    agentName: string;
    currentPost: string;
    formattedConversation: string;
    originalMessage: Memory;
    tweet: Tweet;
    article?: ScrapedArticle;
    withIq?: boolean;
}

export type GenerateArticleUpdateType = 
  | 'AGENTS_READY'
  | 'ANALYZERS_READY'
  | 'EXISTING_ARTICLES_FETCHED'
  | 'CLUSTER_PROCESSING_START'
  | 'ARTICLE_UPDATED'
  | 'CREATING_ARTICLE'
  | 'ARTICLE_CREATED'
  | 'BACKROOMS_STORED'
  | 'IQ_RESULT'
  | 'STARTING_IQ'
  | 'COMPLETE'
  | 'ERROR';

export interface GenerateArticleUpdate {
  type: GenerateArticleUpdateType;
  data: any;
}

export interface SimliClientConfig {
    apiKey: string;
    faceID: string;
    handleSilence: boolean;
    videoRef: any;
    audioRef: any;
}

export interface BackroomClientOptions {
    withTwitter: boolean;
    useIqRPC: boolean;
}

export interface ArticleGenerationResult {
  title: string;
  content: string;
}

export type TopicAnalysisUpdateType = 
  | 'AGENTS_READY'
  | 'ANALYZERS_READY'
  | 'EXISTING_DATA_FETCHED'
  | 'BACKROOM_ANALYSIS_START'
  | 'CLUSTER_UPDATED'
  | 'NEW_CLUSTER_CREATED'
  | 'BACKROOM_STORED'
  | 'IQ_RESULT'
  | 'COMPLETE'
  | 'INFO'
  | "ERROR";

export interface TopicAnalysisUpdate {
  type: TopicAnalysisUpdateType;
  data: any;
}

export interface TopicAnalysisResponse {
  success: boolean;
  newClusters: number;
  updatedClusters: number;
  unclusterableBackrooms: number;
  processedBackrooms: string[];
}

export type BackroomAnalysisUpdateType = 
  | 'AGENTS_READY'
  | 'ANALYZERS_READY'
  | 'TOPIC_DATA_FETCHED'
  | 'NO_CLUSTERS_FOUND'
  | 'SIMILARITY_ANALYSIS_START'
  | 'SIMILARITY_ANALYSIS_COMPLETE'
  | 'CLUSTER_COMPARISON_START'
  | 'UNCLUSTERABLE_COMPARISON_START'
  | 'CLUSTER_DECISION_MADE'
  | 'CLUSTER_COMPARISON_COMPLETE'
  | 'ARTICLE_UPDATED'
  | 'NEW_CLUSTER_CREATED'
  | 'MARKED_UNCLUSTERABLE'
  | 'IQ_RESULT'
  | 'COMPLETE'
  | 'ERROR';

export interface BackroomAnalysisUpdate {
  type: BackroomAnalysisUpdateType;
  data: any;
}

export interface BackroomAnalysisResponse {
  success: boolean;
  action: 'ADDED_TO_CLUSTER' | 'CREATED_CLUSTER' | 'MARKED_UNCLUSTERABLE';
  clusterId?: string;
  articleId?: string;
  reason?: string;
}

// Method return types