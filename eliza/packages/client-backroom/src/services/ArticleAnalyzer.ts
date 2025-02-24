import { Content, elizaLogger, Memory, stringToUuid, UUID } from '@elizaos/core';
import { AgentRuntime, ModelClass } from '@elizaos/core';
import { composeContext, generateMessageResponse } from '@elizaos/core';
import {
  ContentFeatures,
  ConversationMessage,
  SubtopicCluster,
} from '../types/article-generation';
import type { ArticleGenerationResult } from '../types/index.ts';

import { Article } from '@elizaos/adapter-postgres';
import { SimilarityUpdate } from '@elizaos/service-trigger';
// import PostgresDatabaseAdapter from '@elizaos/adapter-postgres';

export const extractFeaturesFooter = "\nResponse format should be formatted in a JSON block like this:\n```json\n{ \"user\": \"{{agentName}}\", \"text\": \"string\", \"technicalTerms\": [\"string\", \"string\"], \"entities\": [\"string\", \"string\"], \"claims\": [\"string\", \"string\"] }\n```";

export const createArticleFromClusterTemplate = "\nResponse format should be formatted in a JSON block like this:\n```json\n{ \"user\": \"{{agentName}}\", \"text\": \"string\", \"title\": \"string\", \"content\": \"string\" }\n```";

export const updateArticlePrompt = "\nResponse format should be formatted in a JSON block like this:\n```json\n{ \"user\": \"{{agentName}}\", \"text\": \"string\", \"title\": \"string\", \"content\": \"string\" }\n```";

export const similarityPrompt = "\nResponse format should be formatted in a JSON block like this:\n```json\n{ \"user\": \"{{agentName}}\", \"similarity\": \"number\" }\n```";

export class ArticleAnalyzer {
  darksunArticlesRuntime: AgentRuntime;
  metadataRuntime: AgentRuntime;

  constructor(darksunArticlesRuntime: AgentRuntime, metadataRuntime: AgentRuntime) {
    this.darksunArticlesRuntime = darksunArticlesRuntime;
    this.metadataRuntime = metadataRuntime;
  }

  async extractFeatures(content: string, roomId: UUID): Promise<ContentFeatures> {
    const prompt = `Analyze the following content and extract key features.

Content:
{{content}}

Extract and categorize the following elements:
1. Technical Terms: Specialized vocabulary and technical concepts
2. Named Entities: People, organizations, locations, artifacts
3. Key Claims: Main arguments or assertions made

# Instructions
1. Extract the technical terms, entities, and claims from the content.
2. Select the most relevant and important terms, entities, and claims.
3. There should be no more than 7 of each of the following: technical terms, entities, and claims.
4. Do NOT include {{agentName}} or the agent is is interacting with as entities.
5. Only include technical terms, entities, and claims that are truly relevant to the content.
6. The response should be formatted in a JSON block like this:

Format your response as JSON:
{
  "technicalTerms": ["term1", "term2"],
  "entities": ["entity1", "entity2"],
  "claims": ["claim1", "claim2"],
}` + extractFeaturesFooter;

    try {
      const contentFeaturesContent: Content = {
        text: prompt,
        attachments: [],
        inReplyTo: null,
        userId: this.metadataRuntime.agentId,
        roomId: roomId,
        agentId: this.metadataRuntime.agentId,
      };

      const contentFeaturesMemory: Memory = {
        content: contentFeaturesContent,
        userId: this.metadataRuntime.agentId,
        agentId: this.metadataRuntime.agentId,
        roomId: roomId,
      };

      const state = await this.metadataRuntime.composeState(contentFeaturesMemory, {
        content: content,
      });

      const response = await generateMessageResponse({
        runtime: this.metadataRuntime,
        context: composeContext({
          state: state,
          template: prompt,
        }),
        modelClass: ModelClass.LARGE,
      });

      elizaLogger.info(`Feature extraction response: ${JSON.stringify(response, null, 2)}`);

      const { technicalTerms, entities, claims } = response;

      if (!technicalTerms || !entities || !claims) {
        throw new Error('No response from feature extraction');
      }

      elizaLogger.info(`Feature extraction response: ${JSON.stringify(response, null, 2)}`);


      return {
        technicalTerms,
        entities,
        claims,
      } as ContentFeatures;
    } catch (error) {
      elizaLogger.error('Error extracting features:', error.message);
      // Fallback to basic regex for technical terms
      return {
        technicalTerms:
          content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [],
        entities: [],
        claims: [],
      };
    }
  }

  async calculateArticleSimilarity(
    article: Article,
    cluster: SubtopicCluster,
  ): Promise<number> {
    elizaLogger.info(`Calculating article similarity for article ${article.id} and cluster ${cluster.id}`);
    const clusterContent = cluster.relatedBackrooms.map(backroom => `Title: ${backroom.title}\n${backroom.content.messages.map(({ agent, message}) => `[${agent}]: ${message}`).join('\n')}`).join('\n\n---\n\n');

    elizaLogger.info(`Article content: ${JSON.stringify(article, null, 2)}`);


    const prompt = `Analyze whether new research conversations would meaningfully enhance an existing article through complementary or expanding information.

Article to Compare:
Title: {{articleTitle}}
Content: {{articleContent}}

New Research Conversations:
{{clusterContent}}

Your task is to provide:
• A single numeric enrichment score from 0.0 to 1.0 (in JSON format)
• 0.0 means the new content would not enhance the article (redundant or unrelated)
• 1.0 means the new content would significantly enhance the article
• Only respond with valid JSON: { "user": "{{agentName}}", "similarity": <number> }

When determining the enrichment value, consider:

• Knowledge Enhancement
  - Does it add new supporting evidence to existing claims?
  - Does it introduce valuable examples or case studies?
  - Does it provide additional context or background?
  - Does it offer alternative perspectives on the topic?

• Depth and Detail
  - Does it elaborate on points only briefly mentioned in the article?
  - Does it provide more technical depth where needed?
  - Does it clarify complex concepts with additional explanation?
  - Does it fill any information gaps in the original?

• Scope Extension
  - Does it cover related aspects not addressed in the original?
  - Does it make valuable connections to broader contexts?
  - Does it explore implications not previously considered?
  - Does it update or modernize any outdated information?

• Content Relationship
  - Is the new information complementary rather than redundant?
  - Does it maintain topical relevance while adding value?
  - Would it integrate naturally into the existing narrative?
  - Does it strengthen or challenge the article's main points?

Weighted considerations:
• High value: New evidence or examples that strengthen existing points
• High value: Detailed explanations of concepts only briefly covered
• Medium value: Related but peripheral information that adds context
• Low value: Redundant information or overly tangential content
• Zero value: Contradictory or unrelated information

Return only the numeric enrichment score in JSON. An example of the expected JSON format:
` + similarityPrompt;

    if (!article.roomId) {
      throw new Error('Article roomId is required');
    }

    const similarityRoomIdRaw = stringToUuid(`${article.id}-${cluster.id}`);

    let similarityRoomId = await this.metadataRuntime.databaseAdapter.getRoom(similarityRoomIdRaw);

    if (!similarityRoomId) {
      similarityRoomId = await this.metadataRuntime.databaseAdapter.createRoom(similarityRoomIdRaw);
    } else {
      await this.metadataRuntime.databaseAdapter.removeAllMemories(similarityRoomId, "articles");
    }

    try {
      const articleSimilarityContent: Content = {
        text: `Determine the similarity between article ${article.id} and the cluster ${cluster.id}`,
        attachments: [],
        inReplyTo: null,
        userId: this.metadataRuntime.agentId,
        roomId: similarityRoomId,
        agentId: this.metadataRuntime.agentId,
      };

      const articleSimilarityMemory: Memory = {
        content: articleSimilarityContent,
        userId: this.metadataRuntime.agentId,
        agentId: this.metadataRuntime.agentId,
        roomId: similarityRoomId,
      };

      elizaLogger.info(`Article similarity memory: ${JSON.stringify(articleSimilarityMemory, null, 2)}`);

      const state = await this.metadataRuntime.composeState(articleSimilarityMemory, {
        articleTitle: article.title,
        articleContent: article.article,
        clusterContent: clusterContent,
      });

      elizaLogger.info(`State was generated`);

      const context = composeContext({
        state: state,
        template: prompt,
      });

      elizaLogger.info('Context was generated');


      const response = await generateMessageResponse({
        runtime: this.metadataRuntime,
        context: context,
        modelClass: ModelClass.LARGE,
      });

      elizaLogger.info(`Similarity analysis response: ${JSON.stringify(response, null, 2)}`);

      const { similarity } = response;

      elizaLogger.info(`Similarity score: ${similarity}`);

      if (!similarity) {
        throw new Error('No similarity score from similarity analysis');
      }

      // if (!response?.text) {
      //   throw new Error('No response from similarity analysis');
      // }

      // Extract numerical score from response
      const score = Number(similarity);
      if (isNaN(score) || score < 0 || score > 1) {
        throw new Error('Invalid similarity score');
      }

      return score;
    } catch (error) {
      elizaLogger.error('Error calculating article similarity message:', error.message);
      // Return moderate similarity as fallback
      return 0.5;
    }
  }

  /**
   * LLM-based approach to conversation similarity.
   * This function compares metadata extracted from two conversations (A and B),
   * returning a Boolean to indicate whether they are similar enough to belong
   * in the same cluster of research features for article generation.
   */
  async areConversationsSimilar(
    features1: ContentFeatures,
    features2: ContentFeatures,
    title1: string,
    title2: string,
    topic: string,
    roomId: UUID,
    sendUpdate?: (update: SimilarityUpdate) => void
  ): Promise<number> {
    const prompt = `
Analyze the semantic similarity between two research conversations based on their extracted metadata and titles. You will be provided with the key features (entities, claims, and technical terms) that were extracted from each conversation, not the conversations themselves.

Topic Context: {{topic}}

# Conversation A
Title: {{title1}}
Extracted Features:
- Entities: {{conversationAEntities}}
- Claims: {{conversationAClaims}}
- Technical Terms: {{conversationATechnicalTerms}}

# Conversation B
Title: {{title2}}
Extracted Features:
- Entities: {{conversationBEntities}}
- Claims: {{conversationBClaims}}
- Technical Terms: {{conversationBTechnicalTerms}}

Your task is to determine how semantically similar these conversations are based on their metadata by analyzing:

1. CORE TOPIC ALIGNMENT (40% weight)
- Do the extracted features indicate the same core subject matter?
- Are the technical terms from the same domain/field?
- Do the entities suggest related contexts?

2. CLAIM COMPLEMENTARITY (35% weight)
- Do the extracted claims support/expand upon each other?
- Are they examining different aspects of the same topic?
- Would combining these claims create a more complete understanding?

3. INFORMATION OVERLAP (25% weight)
- What proportion of the features are unique vs shared?
- Do the technical terms indicate similar expertise levels?
- Are the entities part of the same narrative?

Scoring Guidelines:
0.0-0.2: Metadata indicates entirely different topics
0.3-0.4: Same broad field but different specific focus
0.5-0.6: Related topics with meaningful overlap
0.7-0.8: Strong alignment with complementary information
0.9-1.0: Nearly identical topic with high synergy

Clustering Implications:
- >= 0.7: Strong enough similarity to form/join a cluster
- >= 0.5: Potential match if other cluster members show alignment
- < 0.3: Too different to belong in same cluster

Return only a single similarity score from 0.0 to 1.0 in this JSON format:
` + similarityPrompt;

    const conversationSimilarityContent: Content = {
      text: `Analyzing metadata similarity between conversations "${title1}" and "${title2}"`,
      attachments: [],
      inReplyTo: null,
      userId: this.metadataRuntime.agentId,
      roomId: roomId,
      agentId: this.metadataRuntime.agentId,
    };

    const conversationSimilarityMemory: Memory = {
      content: conversationSimilarityContent,
      userId: this.metadataRuntime.agentId,
      agentId: this.metadataRuntime.agentId,
      roomId: roomId,
    };

    const state = await this.metadataRuntime.composeState(conversationSimilarityMemory, {
      topic,
      title1,
      title2,
      conversationAEntities: features1.entities.join(", "),
      conversationAClaims: features1.claims.join(", "),
      conversationATechnicalTerms: features1.technicalTerms.join(", "),
      conversationBEntities: features2.entities.join(", "),
      conversationBClaims: features2.claims.join(", "),
      conversationBTechnicalTerms: features2.technicalTerms.join(", "),
    });

    let retryCount = 0
    const MAX_TRY = 3; 

    while (retryCount < MAX_TRY) {
      // Generate a response from the model
      const response = await generateMessageResponse({
        runtime: this.metadataRuntime,
        context: composeContext({
          state: state,
          template: prompt,
        }),
        modelClass: ModelClass.SMALL,
      });

      // Extract the similarity score from the model's response
      const { similarity } = response;
      if (similarity === undefined || similarity === null) {
        elizaLogger.warn("No similarity score returned. Defaulting to 0.0");
        sendUpdate({
          type: "SIMILARITY_ERROR",
          data: {
            error: `No similarity score returned. Retrying... ${retryCount}/${MAX_TRY}`
          }
        });
        retryCount++;
        continue;
      }

      const numericSim = Number(similarity);
      if (isNaN(numericSim)) {
        elizaLogger.warn(`Invalid similarity score. Retrying... ${retryCount}/${MAX_TRY}`);
        sendUpdate({
          type: "SIMILARITY_ERROR", 
          data: {
            error: `Invalid similarity score. Retrying... ${retryCount}/${MAX_TRY}`
          }
        });
        retryCount++;
        continue;
      }

      elizaLogger.info(`Feature 1 and 2 similarity: ${numericSim}`);
      return numericSim;
    }

  }

  /**
   * LLM-based approach to conversation similarity.
   * This function compares metadata extracted from two conversations (A and B),
   * returning a Boolean to indicate whether they are similar enough to belong
   * in the same cluster of research features for article generation.
   */
  async areConversationsSimilarLLM(
    features1: ContentFeatures,
    features2: ContentFeatures,
    title1: string,
    title2: string,
    topic: string,
    roomId: UUID
  ): Promise<number> {
    const prompt = `
Analyze the semantic similarity between two research conversations based on their extracted metadata and titles. You will be provided with the key features (entities, claims, and technical terms) that were extracted from each conversation, not the conversations themselves.

Topic Context: {{topic}}

# Conversation A
Title: {{title1}}
Extracted Features:
- Entities: {{conversationAEntities}}
- Claims: {{conversationAClaims}}
- Technical Terms: {{conversationATechnicalTerms}}

# Conversation B
Title: {{title2}}
Extracted Features:
- Entities: {{conversationBEntities}}
- Claims: {{conversationBClaims}}
- Technical Terms: {{conversationBTechnicalTerms}}

Your task is to determine how semantically similar these conversations are based on their metadata by analyzing:

1. CORE TOPIC ALIGNMENT (40% weight)
- Do the extracted features indicate the same core subject matter?
- Are the technical terms from the same domain/field?
- Do the entities suggest related contexts?

2. CLAIM COMPLEMENTARITY (35% weight)
- Do the extracted claims support/expand upon each other?
- Are they examining different aspects of the same topic?
- Would combining these claims create a more complete understanding?

3. INFORMATION OVERLAP (25% weight)
- What proportion of the features are unique vs shared?
- Do the technical terms indicate similar expertise levels?
- Are the entities part of the same narrative?

Scoring Guidelines:
0.0-0.2: Metadata indicates entirely different topics
0.3-0.4: Same broad field but different specific focus
0.5-0.6: Related topics with meaningful overlap
0.7-0.8: Strong alignment with complementary information
0.9-1.0: Nearly identical topic with high synergy

Clustering Implications:
- >= 0.7: Strong enough similarity to form/join a cluster
- >= 0.5: Potential match if other cluster members show alignment
- < 0.3: Too different to belong in same cluster

Return only a single similarity score from 0.0 to 1.0 in this JSON format:
` + similarityPrompt;

    const conversationSimilarityContent: Content = {
      text: `Analyzing metadata similarity between conversations "${title1}" and "${title2}"`,
      attachments: [],
      inReplyTo: null,
      userId: this.metadataRuntime.agentId,
      roomId: roomId,
      agentId: this.metadataRuntime.agentId,
    };

    const conversationSimilarityMemory: Memory = {
      content: conversationSimilarityContent,
      userId: this.metadataRuntime.agentId,
      agentId: this.metadataRuntime.agentId,
      roomId: roomId,
    };

    const state = await this.metadataRuntime.composeState(conversationSimilarityMemory, {
      topic,
      title1,
      title2,
      conversationAEntities: features1.entities.join(", "),
      conversationAClaims: features1.claims.join(", "),
      conversationATechnicalTerms: features1.technicalTerms.join(", "),
      conversationBEntities: features2.entities.join(", "),
      conversationBClaims: features2.claims.join(", "),
      conversationBTechnicalTerms: features2.technicalTerms.join(", "),
    });

    // Generate a response from the model
    const response = await generateMessageResponse({
      runtime: this.metadataRuntime,
      context: composeContext({
        state: state,
        template: prompt,
      }),
      modelClass: ModelClass.SMALL,
    });

    // Extract the similarity score from the model's response
    const { similarity } = response;
    if (similarity === undefined || similarity === null) {
      elizaLogger.warn("No similarity score returned. Defaulting to 0.0");
      return null;
    }

    const numericSim = Number(similarity);
    if (isNaN(numericSim)) {
      elizaLogger.warn("Invalid similarity score. Defaulting to 0.0");
      return null;
    }

    elizaLogger.info(`Feature 1 and 2 similarity: ${numericSim}`);
    return numericSim;
  }

  private calculateJaccardSimilarity(set1: string[], set2: string[]): number {
    const set1Lower = new Set(set1.map((s) => s.toLowerCase()));
    const set2Lower = new Set(set2.map((s) => s.toLowerCase()));

    const intersection = new Set(
      [...set1Lower].filter((x) => set2Lower.has(x)),
    );

    const union = new Set([...set1Lower, ...set2Lower]);

    return intersection.size / union.size;
  }

  async generateArticleFromCluster(
    cluster: SubtopicCluster,
    roomId: UUID
  ): Promise<ArticleGenerationResult> {
    const prompt = `
    You are {{agentName}}
    About {{agentName}}:
    {{bio}}
    {{lore}}

    You exhibit the following traits: {{adjectives}}

    Generate a comprehensive article based on the following research conversations that contain the following metadata.

Conversations:
{{conversations}}

Key Entities: 
{{entities}}

Key Claims: 
{{claims}}

Technical Terms: 
{{technicalTerms}}

Instructions - Please write a long-form article that:
1. Synthesize the conversations into a cohesive article
2. Maintain {{agentName}}'s tone and style
3. Do not include citations or references
4. Synthesizes all key information from these conversations
5. Maintains a formal yet engaging tone
6. Organizes the content logically
7. Includes relevant technical details while remaining accessible
8. Draws connections between different pieces of information
9. Concludes with the most significant implications of these findings
10. Make sure to return the title and content in the format provided
11. Title should be less than 10 words
12. No special characters in titlea
13. Return content in markdown format
11. Response needs to be in JSON format shown below.

[Response format]:
` + createArticleFromClusterTemplate;

    try {
      const conversationContent = cluster.relatedBackrooms.map(backroom => `Backroom Title: ${backroom.title}\nBackroom Content: \n${backroom.content.messages.map(({ agent, message}) => `[${agent}]: ${message}`).join('\n\n')}`).join('\n\n---\n\n');

        roomId = await this.darksunArticlesRuntime.databaseAdapter.getRoom(roomId);

        if (!roomId) {
          roomId = await this.darksunArticlesRuntime.databaseAdapter.createRoom(roomId);
        } else {
          await this.darksunArticlesRuntime.databaseAdapter.removeAllMemories(roomId, "articles");
        }

      const articleContent: Content = {
        text: `Generating first article for ${cluster.id}`,
        attachments: [],
        inReplyTo: null,
        userId: this.darksunArticlesRuntime.agentId,
        roomId: roomId,
        agentId: this.darksunArticlesRuntime.agentId,
      };

      const articleMemory: Memory = {
        content: articleContent,
        userId: this.darksunArticlesRuntime.agentId,
        agentId: this.darksunArticlesRuntime.agentId,
        roomId: roomId,
      };


      const state = await this.darksunArticlesRuntime.composeState(articleMemory, {
        conversations: conversationContent,
        entities: cluster.features.entities.join(', '),
        claims: cluster.features.claims.join(', '),
        technicalTerms: cluster.features.technicalTerms.join(', '),
      });

      elizaLogger.info(`Starting article generation from cluster ${cluster.id}`);

      const context = composeContext({
        state,
        template: prompt,
      });

      elizaLogger.info("Article generation context:", context);

      const response = await generateMessageResponse({
        runtime: this.darksunArticlesRuntime,
        context,
        modelClass: ModelClass.LARGE,
      });

      elizaLogger.debug(`Article generation response: ${JSON.stringify(response, null, 2)}`);

      const memoryText = `
      Article generated for ${cluster.id}:

      Title: ${response.title}
      Content: ${response.content}
      `;

      const memory: Memory = {
        content: {
          text: memoryText,
          attachments: [],
          inReplyTo: null,
          userId: this.darksunArticlesRuntime.agentId,
          roomId: roomId,
          agentId: this.darksunArticlesRuntime.agentId,
        },
        userId: this.darksunArticlesRuntime.agentId,
        agentId: this.darksunArticlesRuntime.agentId,
        roomId: roomId,
      };

      await this.darksunArticlesRuntime.databaseAdapter.createMemory(memory, "articles");

      const { title, content } = response;

      if (!title || !content) {
        throw new Error('No title or content from article generation');
      }

      elizaLogger.debug(`Article generation response: ${response.text}`);

      return { title, content } as ArticleGenerationResult;
    } catch (error) {
      elizaLogger.error('Error generating article:', error);
      throw error;
    }
  }

  async createUpdatedArticle(
    existingArticle: Article,
    cluster: SubtopicCluster,
    roomId: UUID
  ): Promise<ArticleGenerationResult> {
    const prompt = `Update the following article with the new information from the research conversations.

Existing Article:
Title: {{articleTitle}}
Content: {{articleContent}}

Updated Research Conversations:
{{newResearch}}

New Information:
- Technical Terms: {{newTechnicalTerms}}
- Entities: {{newEntities}}
- Claims: {{newClaims}}

Instructions:
1. Integrate new information while maintaining article flow
2. Update or expand existing sections as needed
3. Add new sections if required
4. Maintain consistent style and tone
5. Do not include citations or references in content
6. Only update the title if it seems more necessary than not, otherwise keep it the same

Format:
Title: [Updated Title or Original Title]

[Updated Article Content]` + createArticleFromClusterTemplate;

    try {
      const newResearch = cluster.relatedBackrooms.map(backroom => `Title: ${backroom.title}\n${backroom.content.messages.map(({ agent, message}) => `[${agent}]: ${message}`).join('\n')}`).join('\n\n---\n\n');

      const existingFeatures = await this.extractFeatures(existingArticle.article, roomId);
      
      const newEntities = cluster.features.entities
        .filter(e => !existingFeatures.entities.includes(e));
      const newClaims = cluster.features.claims
        .filter(c => !existingFeatures.claims.includes(c));
      const newTechnicalTerms = cluster.features.technicalTerms
        .filter(t => !existingFeatures.technicalTerms.includes(t));

      const articleContent: Content = {
        text: `Updating article for ${cluster.id}`,
        attachments: [],
        inReplyTo: null,
        userId: this.darksunArticlesRuntime.agentId,
        roomId: roomId,
        agentId: this.darksunArticlesRuntime.agentId,
      };

      const articleMemory: Memory = {
        content: articleContent,
        userId: this.darksunArticlesRuntime.agentId,
        agentId: this.darksunArticlesRuntime.agentId,
        roomId: roomId,
      };

      const state = await this.darksunArticlesRuntime.composeState(articleMemory, {
        articleTitle: existingArticle.title,
        articleContent: existingArticle.article,
        newResearch,
        newEntities: newEntities.join(', '),
        newClaims: newClaims.join(', '),
        newTechnicalTerms: newTechnicalTerms.join(', '),
      });

      const response = await generateMessageResponse({
        runtime: this.darksunArticlesRuntime,
        context: composeContext({
          state,
          template: prompt,
        }),
        modelClass: ModelClass.LARGE,
      });

      const memoryText = `
      Article updated for ${cluster.id}:

      Title: ${response.title}
      Content: ${response.content}
      `;

      const memory: Memory = {
        content: {
          text: memoryText,
          attachments: [],
          inReplyTo: null,
          userId: this.darksunArticlesRuntime.agentId,
          roomId: roomId,
          agentId: this.darksunArticlesRuntime.agentId,
        },
        userId: this.darksunArticlesRuntime.agentId,
        agentId: this.darksunArticlesRuntime.agentId,
        roomId: roomId,
      };

      await this.darksunArticlesRuntime.databaseAdapter.createMemory(memory, "articles");

      const { title, content } = response;

      if (!title || !content) {
        throw new Error('No title or content from article generation');
      }

      elizaLogger.debug(`Article generation response: ${response.text}`);

      return { title, content } as ArticleGenerationResult;
    } catch (error) {
      elizaLogger.error('Error updating article:', error);
      throw error;
    }
  }

  async storeForLaterUse(
    conversation: ConversationMessage,
    relatedConversations: ConversationMessage[],
    roomId: UUID
  ) {
    const combinedContent = [conversation, ...relatedConversations]
      .map(c => `[${c.agent}]: ${c.message}`)
      .join('\n\n');
      
    const features = await this.extractFeatures(combinedContent, roomId);
    
    // For brief tool marks mention:
    // features.claims.length < 3 (insufficient)
    if (!this.checkContentSufficiency(features)) {
      return {
        action: 'STORE_FOR_LATER',
        relatedConversations: relatedConversations.map(c => c.id),
        features,
        reason: 'Insufficient combined content'
      };
    }
  }

  private areRelated(claim1: string, claim2: string): boolean {
    const similarity = this.calculateJaccardSimilarity(
      claim1.split(' '),
      claim2.split(' ')
    );
    return similarity > 0.3;
  }

  async analyzeNewConversation(conversation: ConversationMessage, roomId: UUID) {
    // Extract features from the conversation
    const features = await this.extractFeatures(conversation.message, roomId);
    
    // Check content sufficiency
    const hasSubstantialContent = this.checkContentSufficiency(features);
    if (!hasSubstantialContent) {
      return {
        action: 'STORE',
        reason: 'Insufficient content for standalone article'
      };
    }

    // For your granite cutting example:
    // features.technicalTerms = ['granite cutting', 'stone tools', ...]
    // features.claims = ['precise cutting techniques', 'tool marks indicate...']
    // features.methodology = ['archaeological analysis', 'tool mark comparison']
    
    return {
      action: 'CREATE_NEW',
      features,
      reason: 'Sufficient standalone content'
    };
  }

  private checkContentSufficiency(features: ContentFeatures): boolean {
    return (
      features.claims.length >= 3 &&
      features.entities.length >= 2
    );
  }

  async checkEnrichingContent(features: ContentFeatures, article: Article): Promise<boolean> {
    const existingFeatures = await this.extractFeatures(article.article, article.roomId);
    
    // Check if new content adds valuable examples or evidence
    const newExamples = features.claims.filter(c => 
      !existingFeatures.claims.includes(c) &&
      existingFeatures.claims.some(ec => this.areRelated(c, ec))
    );
    
    return newExamples.length > 0;
  }
}
