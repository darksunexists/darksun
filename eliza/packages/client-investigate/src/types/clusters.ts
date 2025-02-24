import { UUID } from "@elizaos/core";
import { BackroomEntry, Article } from "@elizaos/adapter-postgres";
import { ContentFeatures } from "./article-generation";

// Base interface for common cluster properties
export interface BaseCluster {
    id: UUID;
    topic: string;
    backrooms: BackroomEntry[];
}

// Database cluster representation
export interface DBCluster extends BaseCluster {
    articleId: number;
    createdAt: Date;
    updatedAt: Date;
}

// Cluster with associated article data
export interface ClusterWithArticle extends DBCluster {
    article: Article;
}

// Cluster optimized for content analysis
export interface AnalysisCluster extends BaseCluster {
    name: string;
    features: ContentFeatures;
}

// Type guard functions
export const isDBCluster = (cluster: any): cluster is DBCluster => {
    return 'articleId' in cluster && 'createdAt' in cluster;
};

export const isClusterWithArticle = (cluster: any): cluster is ClusterWithArticle => {
    return isDBCluster(cluster) && 'article' in cluster;
};

// Transformation functions
export const transformToAnalysisCluster = (
    cluster: DBCluster | ClusterWithArticle,
    features: ContentFeatures
): AnalysisCluster => {
    const article = 'article' in cluster ? cluster.article : null;
    
    return {
        id: cluster.id,
        topic: cluster.topic,
        name: article?.title || `Cluster-${cluster.id}`,
        backrooms: cluster.backrooms,
        features
    };
}; 