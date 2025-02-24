import type { BackroomEntry } from "@elizaos/adapter-postgres";
import { UUID } from "@elizaos/core";

export interface ContentFeatures {
  technicalTerms: string[];
  entities: string[];
  claims: string[];
}

// export interface ClusterConversation extends ConversationMessage {
//   backroomId: string;
// }

export interface ClusterConversation {
  backroomId: string;
  conversation: ConversationMessage[];
}

export interface SubtopicCluster {
  id: UUID;
  name: string;
  topic: string;
  features: ContentFeatures;
  relatedBackrooms: BackroomEntry[];
}

export interface ContentFormatFactors {
  depth: number;
  breadth: number;
  evidenceQuality: number;
  controversyLevel: number;
  interconnectedness: number;
}

export type ContentFormatType =
  | 'deep_dive'
  | 'roundup'
  | 'comparative'
  | 'topic_guide';

export interface TemplateSection {
  name: string;
  required: boolean;
  minWords?: number;
}

export interface ContentTemplate {
  type: ContentFormatType;
  sections: TemplateSection[];
}

export interface ConversationMessage {
  id: string;
  agent: string;
  message: string;
  timestamp: string;
  citations?: string[];
}

// Add these interfaces to the top with your other interfaces
export interface ArticleGenerationRequest {
  topic: string;
  backroomIds?: UUID[];  // Optional specific backroom entries to process
  withIq?: boolean;
}

export interface ArticleGenerationResponse {
  success: boolean;
  articles: NewArticle[];
  updatedArticles: UpdatedArticle[];
  relatedArticles: RelatedArticle[];
  storedForLater: StoredForLater[];
}

interface NewArticle {
  id: string;
  title: string;
  content: string;
  type: 'new';
  relatedBackrooms: string[];
  relatedArticles?: string[];
}

interface UpdatedArticle {
  id: string;
  title: string;
  content: string;
  type: 'updated';
  relatedBackrooms: string[];
}

interface RelatedArticle {
  id: string;
  title: string;
  content: string;
  type: 'related';
  relatedBackrooms: string[];
  referencedArticles: string[];
}

interface StoredForLater {
  backroomId: string;
  reason: string;
}

export enum RelationType {
  UPDATE = 'update',
  REFERENCE = 'reference',
  CONTINUATION = 'continuation',
  UNRELATED = 'unrelated',
  ERROR = 'error'
}

export interface ArticleDecision {
  shouldCreate: boolean;
  articlesToUpdate?: Array<{
    articleId: number;
    missingBackroomIds: UUID[];
  }>;
  shouldCreateWithReference?: boolean;
  relatedArticles?: Array<{
    id: number;
    relationType: RelationType;
  }>;
  reason?: string;
  errors?: Array<{
    articleId: number;
    error: string;
  }>;
}

export interface ClusterAnalysisResult {
  shouldAddToCluster: boolean;
  targetClusterId?: UUID;
  reason?: string;
  relatedArticles?: Array<{ id: number; relationType: RelationType }>;
}