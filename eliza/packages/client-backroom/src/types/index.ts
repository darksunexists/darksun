import { Article, BackroomEntry, ClusterWithBackrooms} from "@elizaos/adapter-postgres";
import type { UUID, Memory } from "@elizaos/core";

import type { Tweet } from "agent-twitter-client";

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

type StandardUpdateType = 'AGENTS_READY' | 'ANALYZERS_READY' | 'EXISTING_ARTICLES_FETCHED' | 'CLUSTER_PROCESSING_START' | 'NEW_CLUSTER_CREATED' | 'ARTICLE_UPDATED' | 'CREATING_ARTICLE' | 'ARTICLE_CREATED' | 'BACKROOMS_STORED' | 'IQ_RESULT' | 'IQ_ERROR' | 'STARTING_IQ';

export type GenerateArticleUpdateType = StandardUpdateType 
| 'ANALYZERS_READY'
| 'EXISTING_ARTICLES_FETCHED'
| 'CLUSTER_PROCESSING_START'
| 'CREATING_CLUSTER'
| 'NEW_CLUSTER_CREATED'
| 'ARTICLE_UPDATED'
| 'CREATING_ARTICLE'
| 'ARTICLE_CREATED'
| 'COMPLETE'
| 'ERROR'
| 'INFO'
| 'UNCLUSTERABLE_BACKROOMS_FETCHED';


export interface GenerateArticleUpdate {
  type: GenerateArticleUpdateType;
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


export interface FullCluster extends ClusterWithBackrooms { 
  article: Article;
}