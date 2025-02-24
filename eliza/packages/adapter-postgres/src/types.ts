import { UUID } from "@elizaos/core";

export enum RelationType {
  UPDATE = 'update',
  REFERENCE = 'reference',
  CONTINUATION = 'continuation',
  UNRELATED = 'unrelated',
  ERROR = 'error'
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
  iqTxHash: string | null;
  content: {
    participants: string[];
    messages: ConversationMessage[];
  };
  created_at: Date;
  upvotes: number;
  citations: string[] | null;
  tweetUrl: string | null;
  metadata: {
    technicalTerms: string[];
    entities: string[];
    claims: string[];
  };
}

export interface ScrappedArticle {
    title: string;
    description: string;
    content: string;
    url: string;
}

export interface Article {
    id: number;
    version: number;
    article: string;
    title: string;
    topic: string;
    imageUrl: string | null;
    iqTxHash: string | null;
    createdAt: Date;
    roomId: UUID;
}

export interface ArticleWithBackrooms extends Article {
    backrooms: BackroomEntry[];
}

export interface ArticleVersion {
  id: number;
  articleId: number;
  article: string;
  title: string;
  version: number;
  createdAt: Date;
  updatedBy?: UUID;
  updateReason?: string;
}

export interface ArticleSource {
  id: number;
  articleId: number;
  backroomId: UUID;
  addedAt: Date;
}

export interface ArticleRelation {
  id: number;
  sourceArticleId: number;
  relatedArticleId: number;
  relationType: RelationType;
  createdAt: Date;
}

export interface ClusterWithBackrooms {
  id: UUID;
  topic: string;
  articleId: number;
  backrooms: BackroomEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UnclusterableBackroom {
    id: UUID;
    topic: string;
    reason: string;
    markedAt: Date;
}