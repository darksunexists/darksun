import PostgresDatabaseAdapter, { BackroomEntry } from '@elizaos/adapter-postgres';
import {
  ContentFeatures,
  SubtopicCluster,
  // ContentFormatFactors,
  ArticleDecision,
  RelationType,
} from '../types/article-generation';
import { elizaLogger, stringToUuid } from '@elizaos/core';
import { ArticleAnalyzer } from './ArticleAnalyzer';
import { UUID } from '@elizaos/core';
import { 
    AnalysisCluster, 
    ClusterWithArticle, 
    transformToAnalysisCluster 
} from '../types/clusters';
import { FullCluster } from '../types';

// const SIMILARITY_THRESHOLD = 0.7;

export class ContentAnalyzer {
  constructor(
    private dbAdapter: PostgresDatabaseAdapter,
    private articleAnalyzer: ArticleAnalyzer
  ) {}

  async extractFeatures(content: string, roomId: UUID): Promise<ContentFeatures> {
    return this.articleAnalyzer.extractFeatures(content, roomId);
  }

  mergeFeatures(
    a: ContentFeatures,
    b: ContentFeatures,
  ): ContentFeatures {
    return {
      technicalTerms: [...new Set([...a.technicalTerms, ...b.technicalTerms])],
      entities: [...new Set([...a.entities, ...b.entities])],
      claims: [...new Set([...a.claims, ...b.claims])],
    };
  }

  async analyzeClusterForArticle(cluster: SubtopicCluster): Promise<ArticleDecision> {
    try {
        // First check if any of the backrooms in this cluster are already associated with articles
        const backroomIds = cluster.relatedBackrooms.map(b => b.id);
        const existingArticlesByBackrooms = await this.dbAdapter.getArticlesByBackroomIds(backroomIds);

        if (existingArticlesByBackrooms.length > 0) {
            elizaLogger.debug("Found existing articles using these backrooms", {
                articleCount: existingArticlesByBackrooms.length,
                backroomIds
            });

            // For each article, get all its associated backrooms
            const articlesWithBackrooms = await Promise.all(
                existingArticlesByBackrooms.map(async (article) => {
                    const backrooms = await this.dbAdapter.getBackroomsByArticleId(article.id);
                    return {
                        article,
                        backroomIds: backrooms.map(b => b.id)
                    };
                })
            );

            // Check if any article already contains all backrooms from this cluster
            const articleWithAllBackrooms = articlesWithBackrooms.find(({ backroomIds: articleBackrooms }) => 
                backroomIds.every(id => articleBackrooms.includes(id))
            );

            if (articleWithAllBackrooms) {
                return {
                    shouldCreate: false,
                    reason: "All backrooms are already associated with an existing article"
                };
            }

            // Identify articles that could be updated with new backrooms
            const articlesToUpdate = articlesWithBackrooms
                .filter(({ backroomIds: articleBackrooms }) => {
                    // Article should have some overlap but not contain all backrooms
                    const hasOverlap = backroomIds.some(id => articleBackrooms.includes(id));
                    const hasMissingBackrooms = backroomIds.some(id => !articleBackrooms.includes(id));
                    return hasOverlap && hasMissingBackrooms;
                })
                .map(({ article, backroomIds: articleBackrooms }) => ({
                    articleId: article.id,
                    missingBackroomIds: backroomIds.filter(id => !articleBackrooms.includes(id))
                }));

            if (articlesToUpdate.length > 0) {
                // Get similarity scores for related articles
                const relatedArticles: Array<{ 
                    id: number; 
                    similarity: number | null; 
                    error?: string 
                }> = [];

                // Process each article for similarity
                for (const article of existingArticlesByBackrooms) {
                    try {
                        const similarity = await this.articleAnalyzer.calculateArticleSimilarity(
                            article,
                            cluster
                        );
                        relatedArticles.push({ id: article.id, similarity });
                    } catch (error) {
                        elizaLogger.error(`Error calculating similarity for article ${article.id}:`, error);
                        relatedArticles.push({ 
                            id: article.id, 
                            similarity: null, 
                            error: error instanceof Error ? error.message : String(error) 
                        });
                    }
                }

                // Sort and categorize related articles
                const validRelations = relatedArticles
                    .filter(a => a.similarity !== null)
                    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

                return {
                    shouldCreate: false,
                    articlesToUpdate,
                    relatedArticles: validRelations.map(a => ({
                        id: a.id,
                        relationType: this.determineRelationType(a.similarity || 0)
                    })),
                    reason: "Updating existing articles with new backroom sources"
                };
            }
        }

        // Check minimum requirements for new article
        const hasMinimumConversations = cluster.relatedBackrooms.length >= 2;
        const hasSubstantialClaims = cluster.features.claims.length >= 3;
        const hasIdentifiableEntities = cluster.features.entities.length >= 2;

        if (!hasMinimumConversations || !hasSubstantialClaims || !hasIdentifiableEntities) {
            return {
                shouldCreate: false,
                reason: "Insufficient content for article creation"
            };
        }

        // Now proceed with topic-based search and similarity analysis for potential references
        const existingArticlesByTopic = await this.dbAdapter.getArticlesByTopic(cluster.topic);
        
        if (existingArticlesByTopic.length > 0) {
            const relatedArticles: Array<{ 
                id: number; 
                similarity: number | null; 
                error?: string 
            }> = [];

            // Process each article for similarity
            for (const article of existingArticlesByTopic) {
                try {
                    const similarity = await this.articleAnalyzer.calculateArticleSimilarity(
                        article,
                        cluster
                    );
                    relatedArticles.push({ id: article.id, similarity });
                } catch (error) {
                    elizaLogger.error(`Error calculating similarity for article ${article.id}:`, error);
                    relatedArticles.push({ 
                        id: article.id, 
                        similarity: null, 
                        error: error instanceof Error ? error.message : String(error) 
                    });
                }
            }

            // Sort and analyze valid relations
            const validRelations = relatedArticles
                .filter(a => a.similarity !== null)
                .sort((a, b) => (b.similarity || 0) - (a.similarity || 0));

            // Medium similarity - potential reference
            const mediumSimilarity = validRelations.filter(a => a.similarity > 0.3 && a.similarity < 0.7);
            if (mediumSimilarity.length > 0) {
                return {
                    shouldCreate: true,
                    shouldCreateWithReference: true,
                    relatedArticles: mediumSimilarity.map(a => ({
                        id: a.id,
                        relationType: RelationType.REFERENCE
                    }))
                };
            }

            // Low similarity - potential continuation
            const continuationCandidates = validRelations.filter(a => a.similarity > 0.2 && a.similarity <= 0.3);
            if (continuationCandidates.length > 0) {
                return {
                    shouldCreate: true,
                    relatedArticles: continuationCandidates.map(a => ({
                        id: a.id,
                        relationType: RelationType.CONTINUATION
                    }))
                };
            }
        }

        // If we get here, create new article
        return {
            shouldCreate: true,
            reason: "Creating new article from unique backroom sources"
        };
    } catch (error) {
        elizaLogger.error("Error analyzing cluster for article:", error);
        throw error;
    }
  }

  // Helper method to determine relation type based on similarity score
  private determineRelationType(similarity: number): RelationType {
    if (similarity >= 0.7) return RelationType.UPDATE;
    if (similarity > 0.3) return RelationType.REFERENCE;
    if (similarity > 0.2) return RelationType.CONTINUATION;
    return RelationType.UNRELATED;
  }

  //
  // V2
  //

  private isSubstantialBackroom(backroom: BackroomEntry): boolean {
      if (!backroom.metadata) return false;
      
      return (
          backroom.metadata.claims.length >= 3 &&
          backroom.metadata.entities.length >= 2 &&
          backroom.metadata.technicalTerms.length >= 2
      );
  }

  async formTopicClusters(backrooms: BackroomEntry[], sendUpdate: (update: any) => void): Promise<SubtopicCluster[]> {
    try {
        const clusters: SubtopicCluster[] = [];
        const processed = new Set<string>();
        
        // Sort backrooms by creation date to process older conversations first
        const sortedBackrooms = [...backrooms].sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        for (const backroom of sortedBackrooms) {
            sendUpdate({
                type: 'INFO',
                data: {
                    message: `Processing Backroom ${backroom.id}`,
                    backroomId: backroom.id
                }
            });

            if (processed.has(backroom.id)) continue;

            // Create room for similarity checks
            const roomId = stringToUuid(backroom.id + "-cluster-formation");
            let room = await this.dbAdapter.getRoom(roomId);
            if (!room) {
                room = await this.dbAdapter.createRoom(roomId);
            }

            // First, try to find an existing cluster this backroom belongs to
            let bestClusterMatch: {
                cluster: SubtopicCluster;
                score: number;
            } | null = null;

            sendUpdate({
                type: 'INFO',
                data: {
                    message: `Performing Similarity Search for Backroom ${backroom.id} and Clusters`,
                    backroomIds: clusters.map(c => c.id)
                }
            });
            for (const cluster of clusters) {
                sendUpdate({
                    type: 'INFO',
                    data: {
                        message: `Calculating Similarity for Backroom ${backroom.id} and Backrooms in cluster ${cluster.id}`,
                        backroomId: backroom.id,
                        clusterId: cluster.id
                    }
                });

                // Calculate aggregate similarity with cluster
                const clusterSimilarityScores = await Promise.all(
                    cluster.relatedBackrooms.map(async (clusterBackroom) => {
                        const cached = await this.dbAdapter.getBackroomRelation(
                            backroom.id,
                            clusterBackroom.id
                        );

                        if (cached !== null) return cached;

                        const score = await this.articleAnalyzer.areConversationsSimilar(
                            backroom.metadata,
                            clusterBackroom.metadata,
                            backroom.title,
                            clusterBackroom.title,
                            backroom.topic,
                            room
                        );

                        await this.dbAdapter.createBackroomRelation(
                            backroom.id,
                            clusterBackroom.id,
                            score
                        );

                        return score;
                    })
                );

                // Calculate cluster cohesion score (average similarity)
                const avgSimilarity = clusterSimilarityScores.reduce((a, b) => a + b, 0) / 
                    clusterSimilarityScores.length;

                // Track best matching cluster
                if (avgSimilarity >= 0.6 && // High similarity threshold for existing clusters
                    (!bestClusterMatch || avgSimilarity > bestClusterMatch.score)) {
                    bestClusterMatch = {
                        cluster,
                        score: avgSimilarity
                    };
                }
            }

            if (bestClusterMatch) {
                // Add to existing cluster
                bestClusterMatch.cluster.relatedBackrooms.push(backroom);
                bestClusterMatch.cluster.features = this.mergeFeatures(
                    bestClusterMatch.cluster.features,
                    backroom.metadata
                );
                sendUpdate({
                    type: 'INFO',
                    data: {
                        message: `Adding Backroom ${backroom.id} to Cluster ${bestClusterMatch.cluster.id}`
                    }
                });
                processed.add(backroom.id);
                continue;
            }

            // If no existing cluster found, try to form a new cluster
            let potentialClusterMembers: Array<{
                backroom: BackroomEntry;
                similarity: number;
            }> = [];

            sendUpdate({
                type: 'INFO',
                data: {
                    message: `Finding other unprocessed backrooms that could form a cluster with Backroom ${backroom.id}`,
                    backroomId: backroom.id
                }
            });

            // Find other unprocessed backrooms that could form a cluster
            const unprocessedBackrooms = sortedBackrooms.filter(
                otherBackroom => !processed.has(otherBackroom.id) && otherBackroom.id !== backroom.id
            );

            const similarityScores = await Promise.all(
                unprocessedBackrooms.map(async (otherBackroom) => {
                    const cached = await this.dbAdapter.getBackroomRelation(
                        backroom.id,
                        otherBackroom.id
                    );

                    if (cached !== null) {
                        elizaLogger.info(`Using cached similarity score`, {
                            backroom1: backroom.id,
                            backroom2: otherBackroom.id,
                            score: cached
                        });
                        return { backroom: otherBackroom, similarity: cached };
                    }

                    const similarity = await this.articleAnalyzer.areConversationsSimilar(
                        backroom.metadata,
                        otherBackroom.metadata,
                        backroom.title,
                        otherBackroom.title,
                        backroom.topic,
                        room
                    );

                    if (similarity === null) {
                        elizaLogger.warn("Similarity score is null. Skipping backroom relation creation.");
                        return null;
                    }

                    elizaLogger.debug(`Storing new similarity score`, {
                        backroom1: backroom.id,
                        backroom2: otherBackroom.id,
                        score: similarity
                    });

                    await this.dbAdapter.createBackroomRelation(
                        backroom.id,
                        otherBackroom.id,
                        similarity
                    );

                    return { backroom: otherBackroom, similarity };
                })
            );

            potentialClusterMembers = similarityScores
                .filter((result): result is NonNullable<typeof result> => 
                    result !== null && result.similarity >= 0.7
                );

            // Create new cluster if we have enough similar conversations
            if (potentialClusterMembers.length >= 1 || this.isSubstantialStandaloneBackroom(backroom)) {
                const newClusterMembers = [backroom, ...potentialClusterMembers.map(m => m.backroom)];
                const mergedFeatures = newClusterMembers.reduce((acc, curr) => 
                    this.mergeFeatures(acc, curr.metadata), backroom.metadata
                );

                sendUpdate({
                    type: 'INFO',
                    data: {
                        message: `Creating new cluster with Backroom ${backroom.id} and ${potentialClusterMembers.length} similar backrooms`,
                        backroomIds: newClusterMembers.map(b => b.id)
                    }
                });

                clusters.push({
                    id: backroom.id,
                    name: this.generateClusterName(newClusterMembers),
                    topic: backroom.topic,
                    relatedBackrooms: newClusterMembers,
                    features: mergedFeatures
                });

                // Mark all members as processed
                newClusterMembers.forEach(member => processed.add(member.id));
            }
        }

        return clusters;
    } catch (error) {
        elizaLogger.error('Error forming topic clusters:', error);
        throw error;
    }
  }

private isSubstantialStandaloneBackroom(backroom: BackroomEntry): boolean {
    if (!backroom.metadata) return false;
    
    // Stricter criteria for standalone backrooms
    return (
        backroom.metadata.claims.length >= 4 &&
        backroom.metadata.entities.length >= 3 &&
        backroom.metadata.technicalTerms.length >= 3 &&
        backroom.content.messages.length >= 5 // Minimum conversation length
    );
}

private generateClusterName(backrooms: BackroomEntry[]): string {
    // Extract common entities/terms across backrooms
    const commonTerms = new Set(
        backrooms[0].metadata.entities
            .filter(entity => 
                backrooms.every(b => 
                    b.metadata.entities.includes(entity)
                )
            )
    );
    
    return Array.from(commonTerms).slice(0, 3).join(" - ") || backrooms[0].title;
}

  async analyzeBackroomForClusters(
    newBackroom: BackroomEntry,
    existingClusters: FullCluster[]
  ): Promise<{
    matchingClusters: Array<{
      clusterId: UUID;
      avgSimilarity: number;
      relatedArticles?: Array<{ id: number; relationType: RelationType }>;
    }>;
    reason?: string;
  }> {
    try {
      elizaLogger.info(`Analyzing backroom ${newBackroom.id} for cluster fit`);

      if (existingClusters.length === 0) {
        return {
          matchingClusters: [],
          reason: "No existing clusters to compare with"
        };
      }

      // Create a room for analysis
      const analysisRoomId = stringToUuid(`${newBackroom.id}-cluster-analysis`);
      let room = await this.dbAdapter.getRoom(analysisRoomId);
      if (!room) {
        room = await this.dbAdapter.createRoom(analysisRoomId);
      }

      const matchingClusters = [];

      // Compare with each cluster
      for (const cluster of existingClusters) {
        // Calculate similarity with each backroom in the cluster
        const clusterSimilarityScores = await Promise.all(
          cluster.backrooms.map(async (clusterBackroom) => {
            const cached = await this.dbAdapter.getBackroomRelation(
              newBackroom.id,
              clusterBackroom.id
            );

            if (cached !== null) return cached;

            const score = await this.articleAnalyzer.areConversationsSimilar(
              newBackroom.metadata,
              clusterBackroom.metadata,
              newBackroom.title,
              clusterBackroom.title,
              newBackroom.topic,
              room
            );

            await this.dbAdapter.createBackroomRelation(
              newBackroom.id,
              clusterBackroom.id,
              score
            );

            return score;
          })
        );

        // Calculate average similarity for this cluster
        const avgSimilarity = clusterSimilarityScores.reduce((a, b) => a + b, 0) / 
          clusterSimilarityScores.length;

        // If similarity is high enough, add to matching clusters
        if (avgSimilarity >= 0.6) {
          const relatedArticles = await this.getRelatedArticles(newBackroom, cluster);
          
          matchingClusters.push({
            clusterId: cluster.id,
            avgSimilarity,
            relatedArticles
          });
        }
      }

      return {
        matchingClusters: matchingClusters.sort((a, b) => b.avgSimilarity - a.avgSimilarity),
        reason: matchingClusters.length > 0 
          ? `Found ${matchingClusters.length} matching clusters`
          : "No clusters with sufficient similarity found"
      };

    } catch (error) {
      elizaLogger.error("Error analyzing backroom for clusters:", error);
      throw error;
    }
  }

  private async getRelatedArticles(
    backroom: BackroomEntry,
    cluster: FullCluster
  ): Promise<Array<{ id: number; relationType: RelationType }>> {
    try {
      const articles = await this.dbAdapter.getArticlesByTopic(backroom.topic);
      const relatedArticles: Array<{ id: number; relationType: RelationType }> = [];

      const subtopicCluster: SubtopicCluster = {
        id: backroom.id,
        name: backroom.title,
        topic: backroom.topic,
        relatedBackrooms: cluster.backrooms,
        features: backroom.metadata
      };

      for (const article of articles) {
        const similarity = await this.articleAnalyzer.calculateArticleSimilarity(
          article,
          subtopicCluster
        );

        if (similarity !== null) {
          relatedArticles.push({
            id: article.id,
            relationType: this.determineRelationType(similarity)
          });
        }
      }

      return relatedArticles.sort((a, b) => {
        const relTypeOrder = {
          [RelationType.UPDATE]: 3,
          [RelationType.REFERENCE]: 2,
          [RelationType.CONTINUATION]: 1,
          [RelationType.UNRELATED]: 0
        };
        return relTypeOrder[b.relationType] - relTypeOrder[a.relationType];
      });

    } catch (error) {
      elizaLogger.error("Error getting related articles:", error);
      return [];
    }
  }

  async transformCluster(
    cluster: ClusterWithArticle,
    additionalBackroom?: BackroomEntry
  ): Promise<AnalysisCluster> {
    // Get all backrooms including the additional one
    const allBackrooms = additionalBackroom 
      ? [...cluster.backrooms, additionalBackroom]
      : cluster.backrooms;

    // Get unique backrooms by ID
    const uniqueBackrooms = Array.from(
      new Map(allBackrooms.map(b => [b.id, b])).values()
    );

    // Merge features from all backrooms
    const mergedFeatures = uniqueBackrooms.reduce(
      (acc, curr) => this.mergeFeatures(acc, curr.metadata),
      uniqueBackrooms[0].metadata
    );

    return transformToAnalysisCluster(cluster, mergedFeatures);
  }

  async analyzeSimilarBackrooms(
    backroom: BackroomEntry,
    unclusterableBackrooms: BackroomEntry[]
  ): Promise<{
    shouldCreateCluster: boolean;
    similarBackrooms: BackroomEntry[];
    reason?: string;
  }> {
    try {
        elizaLogger.info(`Analyzing backroom ${backroom.id} against ${unclusterableBackrooms.length} unclusterable backrooms`);

        if (unclusterableBackrooms.length === 0) {
            return {
                shouldCreateCluster: this.isSubstantialStandaloneBackroom(backroom),
                similarBackrooms: [],
                reason: "No unclusterable backrooms to compare with"
            };
        }

        // Create a room for similarity checks
        const roomId = stringToUuid(backroom.id + "-similarity");
        let room = await this.dbAdapter.getRoom(roomId);
        if (!room) {
            room = await this.dbAdapter.createRoom(roomId);
        }

        // Find similar backrooms
        const similarityResults = await Promise.all(
            unclusterableBackrooms.map(async (unclusterableBackroom) => {
                // First check for cached similarity score
                const cached = await this.dbAdapter.getBackroomRelation(
                    backroom.id,
                    unclusterableBackroom.id
                );

                let similarity: number;
                if (cached !== null) {
                    elizaLogger.info(`Using cached similarity score`, {
                        backroom1: backroom.id,
                        backroom2: unclusterableBackroom.id,
                        score: cached
                    });
                    similarity = cached;
                } else {
                    // Get the full backroom entry for the unclusterable backroom
                    const fullBackroom = await this.dbAdapter.getBackroomEntry(unclusterableBackroom.id);
                    if (!fullBackroom) {
                        elizaLogger.warn(`Could not find full backroom entry for ${unclusterableBackroom.id}`);
                        return null;
                    }

                    similarity = await this.articleAnalyzer.areConversationsSimilar(
                        backroom.metadata,
                        fullBackroom.metadata,
                        backroom.title,
                        fullBackroom.title,
                        backroom.topic,
                        room
                    );

                    // Cache the similarity score
                    await this.dbAdapter.createBackroomRelation(
                        backroom.id,
                        unclusterableBackroom.id,
                        similarity
                    );
                }

                return {
                    backroomId: unclusterableBackroom.id,
                    similarity
                };
            })
        );

        // Filter out null results and sort by similarity
        const validResults = similarityResults
            .filter((result): result is NonNullable<typeof result> => result !== null)
            .sort((a, b) => b.similarity - a.similarity);

        // Find highly similar backrooms (similarity >= 0.7)
        const highSimilarityBackrooms = await Promise.all(
            validResults
                .filter(result => result.similarity >= 0.7)
                .map(result => this.dbAdapter.getBackroomEntry(result.backroomId))
        );

        // Filter out any null results from getBackroomEntry
        const similarBackrooms = highSimilarityBackrooms.filter(
            (backroom): backroom is BackroomEntry => backroom !== null
        );

        // Determine if we should create a cluster
        const shouldCreateCluster = similarBackrooms.length > 0 || this.isSubstantialStandaloneBackroom(backroom);

        let reason: string;
        if (shouldCreateCluster) {
            reason = similarBackrooms.length > 0
                ? `Found ${similarBackrooms.length} similar backrooms with high similarity`
                : 'Backroom is substantial enough to form standalone cluster';
        } else {
            reason = 'Insufficient similarity with existing backrooms and not substantial enough for standalone cluster';
        }

        return {
            shouldCreateCluster,
            similarBackrooms,
            reason
        };

    } catch (error) {
        elizaLogger.error('Error analyzing similar backrooms:', error);
        throw error;
    }
  }

}
