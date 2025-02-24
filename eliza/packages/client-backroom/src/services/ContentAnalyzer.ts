import PostgresDatabaseAdapter, { BackroomEntry } from '@elizaos/adapter-postgres';
import {
  ContentFeatures,
  SubtopicCluster,
  // ContentFormatFactors,
  ArticleDecision,
  RelationType,
} from '../types/article-generation';
import { elizaLogger, Memory, stringToUuid } from '@elizaos/core';
import { ArticleAnalyzer } from './ArticleAnalyzer';
import { UUID } from '@elizaos/core';

// const SIMILARITY_THRESHOLD = 0.7;

export class ContentAnalyzer {
  constructor(
    private dbAdapter: PostgresDatabaseAdapter,
    private articleAnalyzer: ArticleAnalyzer
  ) {}

  async extractFeatures(content: string, roomId: UUID): Promise<ContentFeatures> {
    return this.articleAnalyzer.extractFeatures(content, roomId);
  }

  async clusterConversations(
    backrooms: BackroomEntry[],
  ): Promise<SubtopicCluster[]> {
    const clusters: SubtopicCluster[] = [];

    for (const entry of backrooms) {
      const contentFeaturesRoomId = stringToUuid(entry.id + "-metadata");
      const db = this.dbAdapter;

      let isRoomIdExists = await db.getRoom(contentFeaturesRoomId);

      if (!isRoomIdExists) {
        isRoomIdExists = await db.createRoom(contentFeaturesRoomId);
      }

      await db.removeAllMemories(isRoomIdExists, "metadata");
      const features = entry.metadata;
      elizaLogger.info("Entry features: ", features);

      // Find similar cluster or create new one
      let added = false;
      for (const cluster of clusters) {
        // Check if we already have a cached relation
        // const cachedRelation = await db.getBackroomRelation(entry.id, cluster.id);
        
        let similarityScore = await db.getBackroomRelation(entry.id, cluster.id);
        
        if (similarityScore !== null) {
            elizaLogger.debug("Using cached similarity result", {
                sourceId: entry.id,
                clusterId: cluster.id,
                isSimilar: similarityScore
            });
        } else {
            // Calculate similarity and cache the result
            similarityScore = await this.articleAnalyzer.areConversationsSimilarLLM(
                features,
                cluster.features,
                entry.title,
                cluster.name,
                entry.topic,
                isRoomIdExists
            );

            await db.createBackroomRelation(entry.id, cluster.id, similarityScore);
            elizaLogger.debug("Cached new similarity result", {
                sourceId: entry.id,
                clusterId: cluster.id,
                isSimilar: similarityScore
            });
        }

        // Create memory record for traceability
        const memory: Memory = {
          content: {
            text: `Conversation 1 id: ${entry.id} and conversation(s) 2 id: ${cluster.id} similarity score ${similarityScore}`,
            attachments: [],
            inReplyTo: null,
          },
          userId: this.articleAnalyzer.metadataRuntime.agentId,
          roomId: isRoomIdExists,
          agentId: this.articleAnalyzer.metadataRuntime.agentId,
        }

        await this.dbAdapter.createMemory(memory, "metadata");

        elizaLogger.debug("Conversations similarity", {
          similarityScore,
          mainEntities: cluster.features.entities,
          keyClaims: cluster.features.claims
        });

        if (similarityScore) {
          cluster.relatedBackrooms.push(entry);
          // Merge features
          cluster.features = this.mergeFeatures(cluster.features, features);
          added = true;
          break;
        }
      }

      if (!added) {
        clusters.push({
          id: entry.id as UUID,
          name: entry.title,
          topic: entry.topic,
          relatedBackrooms: [entry],
          features: features,
        });
      }
    }

    return clusters;
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
                elizaLogger.debug("Found articles to update", {
                    articlesToUpdate
                });
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

  async formTopicClusters(backrooms: BackroomEntry[]): Promise<SubtopicCluster[]> {
    try {
        const clusters: SubtopicCluster[] = [];
        const processed = new Set<string>();
        
        // Sort backrooms by creation date to process older conversations first
        const sortedBackrooms = [...backrooms].sort((a, b) => 
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        for (const backroom of sortedBackrooms) {
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

            for (const cluster of clusters) {
                // Calculate aggregate similarity with cluster
                const clusterSimilarityScores = await Promise.all(
                    cluster.relatedBackrooms.map(async (clusterBackroom) => {
                        const cached = await this.dbAdapter.getBackroomRelation(
                            backroom.id,
                            clusterBackroom.id
                        );

                        if (cached !== null) return cached;

                        const score = await this.articleAnalyzer.areConversationsSimilarLLM(
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
                processed.add(backroom.id);
                continue;
            }

            // If no existing cluster found, try to form a new cluster
            const potentialClusterMembers: Array<{
                backroom: BackroomEntry;
                similarity: number;
            }> = [];

            // Find other unprocessed backrooms that could form a cluster
            for (const otherBackroom of sortedBackrooms) {
                if (processed.has(otherBackroom.id) || otherBackroom.id === backroom.id) 
                    continue;

                // First check for cached similarity score
                const cached = await this.dbAdapter.getBackroomRelation(
                    backroom.id,
                    otherBackroom.id
                );

                let similarity: number | null;
                
                if (cached !== null) {
                    elizaLogger.info(`Using cached similarity score`, {
                        backroom1: backroom.id,
                        backroom2: otherBackroom.id,
                        score: cached
                    });
                    similarity = cached;
                } else {
                    similarity = await this.articleAnalyzer.areConversationsSimilarLLM(
                        backroom.metadata,
                        otherBackroom.metadata,
                        backroom.title,
                        otherBackroom.title,
                        backroom.topic,
                        room
                    );

                    if (similarity === null) {
                        elizaLogger.warn("Similarity score is null. Skipping backroom relation creation.");
                        continue;
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
                }

                if (similarity >= 0.7) { // Higher threshold for new cluster formation
                    potentialClusterMembers.push({
                        backroom: otherBackroom,
                        similarity
                    });
                }
            }

            // Create new cluster if we have enough similar conversations
            if (potentialClusterMembers.length >= 1 || this.isSubstantialStandaloneBackroom(backroom)) {
                const newClusterMembers = [backroom, ...potentialClusterMembers.map(m => m.backroom)];
                const mergedFeatures = newClusterMembers.reduce((acc, curr) => 
                    this.mergeFeatures(acc, curr.metadata), backroom.metadata
                );

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

}
