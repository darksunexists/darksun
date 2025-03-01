import { SearchMode, Tweet } from "agent-twitter-client";
import {
    composeContext,
    generateMessageResponse,
    generateShouldRespond,
    messageCompletionFooter,
    shouldRespondFooter,
    Content,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    ModelClass,
    State,
    stringToUuid,
    elizaLogger,
    getEmbeddingZeroVector,
    ServiceType,
    IImageDescriptionService,
} from "@elizaos/core";
import { ClientBase } from "./base.ts";
import { buildConversationThread, sendTweet, wait } from "./utils.ts";
import type { PostgresDatabaseAdapter } from "@elizaos/adapter-postgres";

export const twitterMessageHandlerTemplate =
    `
# Areas of Expertise
{{knowledge}}

# About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{topics}}

{{providers}}

{{characterPostExamples}}

{{postDirections}}

Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

{{recentPosts}}

# TASK: Generate a post/reply in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}) while using the thread of tweets as additional context:

Current Post:
{{currentPost}}
Here is the descriptions of images in the Current post.
{{imageDescriptions}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Generate a post in the voice, style and perspective of {{agentName}} (@{{twitterUserName}}). You MUST include an action if the current post text includes a prompt that is similar or fitting to one of the available actions mentioned here:
{{actionNames}}
{{actions}}

Here is the current post text again. Remember to include an action if the current post text includes a prompt that asks for one of the available actions mentioned above (does not need to be exact)
{{currentPost}}
Here is the descriptions of images in the Current post.
{{imageDescriptions}}
` + messageCompletionFooter;

export const twitterShouldRespondTemplate = (targetUsersStr: string) =>
    `# INSTRUCTIONS: Determine if {{agentName}} (@{{twitterUserName}}) should respond to the message and participate in the conversation. Do not comment. Just respond with "true" or "false".

Response options are RESPOND, IGNORE and STOP.

PRIORITY RULE: ALWAYS RESPOND to these users regardless of topic or message content: ${targetUsersStr}. Topic relevance should be ignored for these users.

For other users:
- {{agentName}} should RESPOND to messages directed at them
- {{agentName}} should RESPOND to conversations relevant to their background
- {{agentName}} should IGNORE irrelevant messages
- {{agentName}} should IGNORE very short messages unless directly addressed
- {{agentName}} should STOP if asked to stop
- {{agentName}} should STOP if conversation is concluded
- {{agentName}} is in a room with other users and wants to be conversational, but not annoying.

IMPORTANT:
- {{agentName}} (aka @{{twitterUserName}}) is particularly sensitive about being annoying, so if there is any doubt, it is better to IGNORE than to RESPOND.
- For users not in the priority list, {{agentName}} (@{{twitterUserName}}) should err on the side of IGNORE rather than RESPOND if in doubt.

Recent Posts:
{{recentPosts}}

Current Post:
{{currentPost}}

Thread of Tweets You Are Replying To:
{{formattedConversation}}

# INSTRUCTIONS: Respond with [RESPOND] if {{agentName}} should respond, or [IGNORE] if {{agentName}} should not respond to the last message and [STOP] if {{agentName}} should stop participating in the conversation.
` + shouldRespondFooter;

export class TwitterInteractionClient {
    client: ClientBase;
    runtime: IAgentRuntime;
    private isDryRun: boolean;
    constructor(client: ClientBase, runtime: IAgentRuntime) {
        this.client = client;
        this.runtime = runtime;
        this.isDryRun = this.client.twitterConfig.TWITTER_DRY_RUN;
    }

    async start() {
        const handleTwitterInteractionsLoop = () => {
            this.handleTwitterInteractions();
            setTimeout(
                handleTwitterInteractionsLoop,
                // Defaults to 2 minutes
                this.client.twitterConfig.TWITTER_POLL_INTERVAL * 1000
            );
        };
        handleTwitterInteractionsLoop();
    }

    async handleTwitterInteractions() {
        elizaLogger.log("Checking Twitter interactions");

        const twitterUsername = this.client.profile.username;
        try {
            // Check for mentions
            const mentionCandidates = (
                await this.client.fetchSearchTweets(
                    `@${twitterUsername}`,
                    20,
                    SearchMode.Latest
                )
            ).tweets;

            elizaLogger.log(
                "Completed checking mentioned tweets:",
                mentionCandidates.length
            );
            let uniqueTweetCandidates = [...mentionCandidates];
            // Only process target users if configured
            if (this.client.twitterConfig.TWITTER_TARGET_USERS.length) {
                const TARGET_USERS = this.client.twitterConfig.TWITTER_TARGET_USERS;

                elizaLogger.log("Processing target users:", TARGET_USERS);

                if (TARGET_USERS.length > 0) {
                    // Create a map to store tweets by user
                    const tweetsByUser = new Map<string, Tweet[]>();

                    // Fetch tweets from all target users
                    for (const username of TARGET_USERS) {
                        try {
                            const userTweets = (
                                await this.client.twitterClient.fetchSearchTweets(
                                    `from:${username}`,
                                    3,
                                    SearchMode.Latest
                                )
                            ).tweets;

                            // Filter for unprocessed, non-reply, recent tweets
                            const validTweets = userTweets.filter((tweet) => {
                                const isUnprocessed =
                                    !this.client.lastCheckedTweetId ||
                                    parseInt(tweet.id) >
                                        this.client.lastCheckedTweetId;
                                const isRecent =
                                    Date.now() - tweet.timestamp * 1000 <
                                    2 * 60 * 60 * 1000;

                                elizaLogger.log(`Tweet ${tweet.id} checks:`, {
                                    isUnprocessed,
                                    isRecent,
                                    isReply: tweet.isReply,
                                    isRetweet: tweet.isRetweet,
                                });

                                return (
                                    isUnprocessed &&
                                    !tweet.isReply &&
                                    !tweet.isRetweet &&
                                    isRecent
                                );
                            });

                            if (validTweets.length > 0) {
                                tweetsByUser.set(username, validTweets);
                                elizaLogger.log(
                                    `Found ${validTweets.length} valid tweets from ${username}`
                                );
                            }
                        } catch (error) {
                            elizaLogger.error(
                                `Error fetching tweets for ${username}:`,
                                error
                            );
                            continue;
                        }
                    }

                    // Select one tweet from each user that has tweets
                    const selectedTweets: Tweet[] = [];
                    for (const [username, tweets] of tweetsByUser) {
                        if (tweets.length > 0) {
                            // Randomly select one tweet from this user
                            const randomTweet =
                                tweets[
                                    Math.floor(Math.random() * tweets.length)
                                ];
                            selectedTweets.push(randomTweet);
                            elizaLogger.log(
                                `Selected tweet from ${username}: ${randomTweet.text?.substring(0, 100)}`
                            );
                        }
                    }

                    // Add selected tweets to candidates
                    uniqueTweetCandidates = [
                        ...mentionCandidates,
                        ...selectedTweets,
                    ];
                }
            } else {
                elizaLogger.log(
                    "No target users configured, processing only mentions"
                );
            }

            // Sort tweet candidates by ID in ascending order
            uniqueTweetCandidates
                .sort((a, b) => a.id.localeCompare(b.id))
                .filter((tweet) => tweet.userId !== this.client.profile.id);

            // for each tweet candidate, handle the tweet
            for (const tweet of uniqueTweetCandidates) {
                if (
                    !this.client.lastCheckedTweetId ||
                    BigInt(tweet.id) > this.client.lastCheckedTweetId
                ) {
                    // Generate the tweetId UUID the same way it's done in handleTweet
                    const tweetId = stringToUuid(
                        tweet.id + "-" + this.runtime.agentId
                    );

                    // Check if we've already processed this tweet
                    const existingResponse =
                        await this.runtime.messageManager.getMemoryById(
                            tweetId
                        );

                    if (existingResponse) {
                        elizaLogger.log(
                            `Already responded to tweet ${tweet.id}, skipping`
                        );
                        continue;
                    }
                    elizaLogger.log("New Tweet found", tweet.permanentUrl);

                    const roomId = stringToUuid(
                        tweet.conversationId + "-" + this.runtime.agentId
                    );

                    const userIdUUID =
                        tweet.userId === this.client.profile.id
                            ? this.runtime.agentId
                            : stringToUuid(tweet.userId!);

                    await this.runtime.ensureConnection(
                        userIdUUID,
                        roomId,
                        tweet.username,
                        tweet.name,
                        "twitter"
                    );

                    const thread = await buildConversationThread(
                        tweet,
                        this.client
                    );

                    const message = {
                        content: { text: tweet.text },
                        agentId: this.runtime.agentId,
                        userId: userIdUUID,
                        roomId,
                    };

                    await this.handleTweet({
                        tweet,
                        message,
                        thread,
                    });

                    // Save the latest checked tweet ID to the file
                    await this.client.cacheLatestCheckedTweetId();
                }
            }

            // Save the latest checked tweet ID to the file
            await this.client.cacheLatestCheckedTweetId();

            elizaLogger.log("Finished checking Twitter interactions");
        } catch (error) {
            elizaLogger.error("Error handling Twitter interactions:", error);
        }
    }

    private async handleTweet({
        tweet,
        message,
        thread,
    }: {
        tweet: Tweet;
        message: Memory;
        thread: Tweet[];
    }) {
        if (tweet.userId === this.client.profile.id) {
            // console.log("skipping tweet from bot itself", tweet.id);
            // Skip processing if the tweet is from the bot itself
            return;
        }

        if (!message.content.text) {
            elizaLogger.log("Skipping Tweet with no text", tweet.id);
            return { text: "", action: "IGNORE" };
        }

        elizaLogger.log("Processing Tweet: ", tweet.id);
        const formatTweet = (tweet: Tweet) => {
            return `  ID: ${tweet.id}
  From: ${tweet.name} (@${tweet.username})
  Text: ${tweet.text}`;
        };
        const currentPost = formatTweet(tweet);

        elizaLogger.debug("Thread: ", thread);
        const formattedConversation = thread
            .map(
                (tweet) => `@${tweet.username} (${new Date(
                    tweet.timestamp * 1000
                ).toLocaleString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "short",
                    day: "numeric",
                })}):
        ${tweet.text}`
            )
            .join("\n\n");

        elizaLogger.debug("formattedConversation: ", formattedConversation);

        // Initialize arrays for tracking links and image descriptions
        const linksToIgnoreDuringInvestigation = [];
        const imageDescriptionsArray = [];
        const allUrls = new Set<string>();

        // Process media from thread (including quoted/retweeted tweets)
        for (const threadTweet of thread) {
            // Helper to process media in any tweet
            const processMedia = (t: Tweet) => {
                for (const photo of t.photos) {
                    linksToIgnoreDuringInvestigation.push(photo.url);
                }
                for (const video of t.videos) {
                    if (video.url) linksToIgnoreDuringInvestigation.push(video.url);
                }
            };

            processMedia(threadTweet);
            if (threadTweet.quotedStatus) processMedia(threadTweet.quotedStatus);
            if (threadTweet.retweetedStatus) processMedia(threadTweet.retweetedStatus);
        }

        try {
            // Process media from current tweet and related tweets
            const processTweetMedia = (t: Tweet) => {
                for (const photo of t.photos) {
                    linksToIgnoreDuringInvestigation.push(photo.url);
                }
                for (const video of t.videos) {
                    if (video.url) linksToIgnoreDuringInvestigation.push(video.url);
                }
            };

            const tweetsToProcess = [tweet];
            if (tweet.inReplyToStatus) tweetsToProcess.push(tweet.inReplyToStatus);
            if (tweet.quotedStatus) tweetsToProcess.push(tweet.quotedStatus);
            if (tweet.retweetedStatus) tweetsToProcess.push(tweet.retweetedStatus);

            for (const tweetToProcess of tweetsToProcess) {
                processTweetMedia(tweetToProcess);
                // Also check quoted/retweeted in nested tweets
                if (tweetToProcess.quotedStatus) processTweetMedia(tweetToProcess.quotedStatus);
                if (tweetToProcess.retweetedStatus) processTweetMedia(tweetToProcess.retweetedStatus);
            }

            // Generate image descriptions for current tweet's photos
            elizaLogger.debug('Getting images');
            for (const photo of tweet.photos) {
                try {
                    elizaLogger.debug('Generating image description for:', photo.url);
                    const description = await this.runtime
                        .getService<IImageDescriptionService>(ServiceType.IMAGE_DESCRIPTION)
                        .describeImage(photo.url);
                    imageDescriptionsArray.push(description);
                } catch (error) {
                    elizaLogger.error("Error occurred during image description: ", error);
                }
            }
        } catch (error) {
            elizaLogger.error("Error occurred during media processing: ", error);
        }

        // Collect URLs from current tweet and related tweets
        const addUrlsFromTweet = (t: Tweet) => t.urls.forEach(url => allUrls.add(url));
        addUrlsFromTweet(tweet);
        if (tweet.inReplyToStatus) addUrlsFromTweet(tweet.inReplyToStatus);
        if (tweet.quotedStatus) addUrlsFromTweet(tweet.quotedStatus);
        if (tweet.retweetedStatus) addUrlsFromTweet(tweet.retweetedStatus);

        // Filter out media URLs to find article links
        const articleUrls = Array.from(allUrls)
            .filter(url => !linksToIgnoreDuringInvestigation.includes(url));

        // Use the first article URL (if any exist)
        const articleUrl = articleUrls.length > 0 ? articleUrls[0] : null;

        if (articleUrl) {
            elizaLogger.info("Article URL: ", articleUrl);
        } else {
            elizaLogger.info("No article URL found");
        }

        let state = await this.runtime.composeState(message, {
            twitterClient: this.client.twitterClient,
            twitterUserName: this.client.twitterConfig.TWITTER_USERNAME,
            currentPost,
            formattedConversation,
            imageDescriptions: imageDescriptionsArray.length > 0
            ? `\nImages in Tweet:\n${imageDescriptionsArray.map((desc, i) =>
              `Image ${i + 1}: Title: ${desc.title}\nDescription: ${desc.description}`).join("\n\n")}`:"",
            articleUrl,
            tweet
        });

        // check if the tweet exists, save if it doesn't
        const tweetId = stringToUuid(tweet.id + "-" + this.runtime.agentId);
        const tweetExists =
            await this.runtime.messageManager.getMemoryById(tweetId);

        if (!tweetExists) {
            elizaLogger.log("tweet does not exist, saving");
            const userIdUUID = stringToUuid(tweet.userId as string);
            const roomId = stringToUuid(tweet.conversationId);

            const message = {
                id: tweetId,
                agentId: this.runtime.agentId,
                content: {
                    text: tweet.text,
                    url: tweet.permanentUrl,
                    inReplyTo: tweet.inReplyToStatusId
                        ? stringToUuid(
                              tweet.inReplyToStatusId +
                                  "-" +
                                  this.runtime.agentId
                          )
                        : undefined,
                },
                userId: userIdUUID,
                roomId,
                createdAt: tweet.timestamp * 1000,
            };
            this.client.saveRequestMessage(message, state);
        }

        // get usernames into str
        const validTargetUsersStr = this.client.twitterConfig.TWITTER_TARGET_USERS.join(",");

        const shouldRespondContext = composeContext({
            state,
            template: twitterShouldRespondTemplate(validTargetUsersStr),
            // template:
            //     this.runtime.character.templates
            //         ?.twitterShouldRespondTemplate ||
            //     this.runtime.character?.templates?.shouldRespondTemplate ||
            //     twitterShouldRespondTemplate(validTargetUsersStr),
        });


        const shouldRespond = await generateShouldRespond({
            runtime: this.runtime,
            context: shouldRespondContext,
            modelClass: ModelClass.MEDIUM,
        });

        elizaLogger.log("Should Respond: ", shouldRespond);

        // Promise<"RESPOND" | "IGNORE" | "STOP" | null> {
        if (shouldRespond !== "RESPOND") {
            elizaLogger.log("Not responding to message");
            return { text: "Response Decision:", action: shouldRespond };
        }

        const context = composeContext({
            state,
            template:
                this.runtime.character.templates
                    ?.twitterMessageHandlerTemplate ||
                this.runtime.character?.templates?.messageHandlerTemplate ||
                twitterMessageHandlerTemplate,
        });

        elizaLogger.debug("Interactions prompt:\n" + context);

        // This is the main response generation
        const response = await generateMessageResponse({
            runtime: this.runtime,
            context,
            modelClass: ModelClass.LARGE,
        });


        if (response.action === "INVESTIGATE") {

            const memory: Memory = {
                id: stringToUuid(tweet.id + "-" + this.runtime.agentId),
                agentId: this.runtime.agentId,
                userId: stringToUuid(tweet.userId),
                roomId: stringToUuid(tweet.conversationId),
                createdAt: tweet.timestamp * 1000,
                content: {
                    text: response.text,
                    url: tweet.permanentUrl,
                    inReplyTo: tweet.inReplyToStatusId
                        ? stringToUuid(
                            tweet.inReplyToStatusId +
                                "-" +
                                this.runtime.agentId
                        )
                        : undefined,
                    ...response,
                    tweet: tweet,
                },
            };

            state.originalMessage = message;

            // await this.runtime.messageManager.addEmbeddingToMemory(memory);
            // await this.runtime.messageManager.createMemory(memory);

            let investigateResponse: Content | null = null;

            await this.runtime.processActions(
                memory, 
                [memory], 
                state, 
                async (newMessage: Content, files: any) => {
                    investigateResponse = newMessage;

                    const investigationId = files.investigationId;
                    const backroomId = files.backroomId as string;

                    const removeQuotes = (str: string) =>
                        str.replace(/^['"](.*)['"]$/, "$1");

                    const stringId = stringToUuid(tweet.id + "-" + this.runtime.agentId);

                    investigateResponse.inReplyTo = stringId;

                    investigateResponse.text = removeQuotes(investigateResponse.text);

                    if (investigateResponse.text) {
                        try {
                            const callback: HandlerCallback = async (response: Content) => {
                                const magnifyGlass = "🔍 ";
                                response.text = magnifyGlass + response.text;

                                if (this.isDryRun) {
                                    elizaLogger.info(
                                        `Dry run: Selected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`
                                    );
                                    return [];
                                } else {
                                    const memories = await sendTweet(
                                        this.client,
                                        response,
                                        message.roomId,
                                        this.client.twitterConfig.TWITTER_USERNAME,
                                        tweet.id,
                                        true,
                                    );
                                    return memories;
                                }
                            };

                            const darksunConvoUrl = this.runtime.getSetting("DARKSUN_CONVO_URL") ?? "https://darksun.is/os/convo";

                            const finalInvestigationTweetText = "see the full investigation here: " + `${darksunConvoUrl}/${backroomId}`;

                            const finalInvestigationTweet: Content = {
                                text: finalInvestigationTweetText,
                            };

                            const responseMessages = await callback(investigateResponse);

                            const firstTweetUrl = responseMessages[0].content.url;

                            const lastTweet = responseMessages[responseMessages.length - 1];

                            const inReplyTo = lastTweet.content.url?.split("/").pop();

                            if (this.isDryRun) {
                                elizaLogger.info(
                                    `Dry run: Selected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`
                                );
                                return [];
                            }

                            const investigationTweetMemory = await sendTweet(
                                this.client,
                                finalInvestigationTweet,
                                message.roomId,
                                this.client.twitterConfig.TWITTER_USERNAME,
                                inReplyTo,
                                true,
                            );

                            responseMessages.push(...investigationTweetMemory);

                            const db = this.runtime.databaseAdapter as PostgresDatabaseAdapter;

                            await db.addTweetToInvestigation({
                                investigationId: investigationId,
                                tweetUrl: firstTweetUrl,
                                tweetResponse: investigateResponse.text,
                            });

                            state = (await this.runtime.updateRecentMessageState(
                                state
                            )) as State;

                            for (const responseMessage of responseMessages) {
                                if (
                                    responseMessage ===
                                    responseMessages[responseMessages.length - 1]
                                ) {
                                    responseMessage.content.action = response.action;
                                } else {
                                    responseMessage.content.action = "CONTINUE";
                                }
                                await this.runtime.messageManager.createMemory(
                                    responseMessage
                                );
                            }

                            const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${investigateResponse.text}`;

                            await this.runtime.cacheManager.set(
                                `twitter/tweet_generation_${tweet.id}.txt`,
                                responseInfo
                            );
                            await wait();
                        } catch (error) {
                            elizaLogger.error(`Error sending response tweet: ${error}`);
                        }
                    }

                    return [];
                }
            );
            return;
        }

        const removeQuotes = (str: string) =>
            str.replace(/^['"](.*)['"]$/, "$1");

        const stringId = stringToUuid(tweet.id + "-" + this.runtime.agentId);

        response.inReplyTo = stringId;

        response.text = removeQuotes(response.text);

        if (response.text) {
            try {
                const callback: HandlerCallback = async (response: Content) => {
                    elizaLogger.log("Sending response tweet");
                    const memories = await sendTweet(
                        this.client,
                        response,
                        message.roomId,
                        this.client.twitterConfig.TWITTER_USERNAME,
                        tweet.id
                    );
                    return memories;
                };

                const responseMessages = await callback(response);

                elizaLogger.log("Response Messages: ", responseMessages);

                state = (await this.runtime.updateRecentMessageState(
                    state
                )) as State;

                for (const responseMessage of responseMessages) {
                    if (
                        responseMessage ===
                        responseMessages[responseMessages.length - 1]
                    ) {
                        responseMessage.content.action = response.action;
                    } else {
                        responseMessage.content.action = "CONTINUE";
                    }
                    await this.runtime.messageManager.createMemory(
                        responseMessage
                    );
                }

                await this.runtime.processActions(
                    message,
                    responseMessages,
                    state,
                    callback
                );

                const responseInfo = `Context:\n\n${context}\n\nSelected Post: ${tweet.id} - ${tweet.username}: ${tweet.text}\nAgent's Output:\n${response.text}`;

                await this.runtime.cacheManager.set(
                    `twitter/tweet_generation_${tweet.id}.txt`,
                    responseInfo
                );
                await wait();
            } catch (error) {
                elizaLogger.error(`Error sending response tweet: ${error}`);
            }
        }
    }

    async buildConversationThread(
        tweet: Tweet,
        maxReplies: number = 10
    ): Promise<Tweet[]> {
        const thread: Tweet[] = [];
        const visited: Set<string> = new Set();

        async function processThread(currentTweet: Tweet, depth: number = 0) {
            elizaLogger.log("Processing tweet:", {
                id: currentTweet.id,
                inReplyToStatusId: currentTweet.inReplyToStatusId,
                depth: depth,
            });

            if (!currentTweet) {
                elizaLogger.log("No current tweet found for thread building");
                return;
            }

            if (depth >= maxReplies) {
                elizaLogger.log("Reached maximum reply depth", depth);
                return;
            }

            // Handle memory storage
            const memory = await this.runtime.messageManager.getMemoryById(
                stringToUuid(currentTweet.id + "-" + this.runtime.agentId)
            );
            if (!memory) {
                const roomId = stringToUuid(
                    currentTweet.conversationId + "-" + this.runtime.agentId
                );
                const userId = stringToUuid(currentTweet.userId);

                await this.runtime.ensureConnection(
                    userId,
                    roomId,
                    currentTweet.username,
                    currentTweet.name,
                    "twitter"
                );

                this.runtime.messageManager.createMemory({
                    id: stringToUuid(
                        currentTweet.id + "-" + this.runtime.agentId
                    ),
                    agentId: this.runtime.agentId,
                    content: {
                        text: currentTweet.text,
                        source: "twitter",
                        url: currentTweet.permanentUrl,
                        inReplyTo: currentTweet.inReplyToStatusId
                            ? stringToUuid(
                                  currentTweet.inReplyToStatusId +
                                      "-" +
                                      this.runtime.agentId
                              )
                            : undefined,
                    },
                    createdAt: currentTweet.timestamp * 1000,
                    roomId,
                    userId:
                        currentTweet.userId === this.twitterUserId
                            ? this.runtime.agentId
                            : stringToUuid(currentTweet.userId),
                    embedding: getEmbeddingZeroVector(),
                });
            }

            if (visited.has(currentTweet.id)) {
                elizaLogger.log("Already visited tweet:", currentTweet.id);
                return;
            }

            visited.add(currentTweet.id);
            thread.unshift(currentTweet);

            elizaLogger.debug("Current thread state:", {
                length: thread.length,
                currentDepth: depth,
                tweetId: currentTweet.id,
            });

            if (currentTweet.inReplyToStatusId) {
                elizaLogger.log(
                    "Fetching parent tweet:",
                    currentTweet.inReplyToStatusId
                );
                try {
                    const parentTweet = await this.twitterClient.getTweet(
                        currentTweet.inReplyToStatusId
                    );

                    if (parentTweet) {
                        elizaLogger.log("Found parent tweet:", {
                            id: parentTweet.id,
                            text: parentTweet.text?.slice(0, 50),
                        });
                        await processThread(parentTweet, depth + 1);
                    } else {
                        elizaLogger.log(
                            "No parent tweet found for:",
                            currentTweet.inReplyToStatusId
                        );
                    }
                } catch (error) {
                    elizaLogger.log("Error fetching parent tweet:", {
                        tweetId: currentTweet.inReplyToStatusId,
                        error,
                    });
                }
            } else {
                elizaLogger.log(
                    "Reached end of reply chain at:",
                    currentTweet.id
                );
            }
        }

        // Need to bind this context for the inner function
        await processThread.bind(this)(tweet, 0);

        elizaLogger.debug("Final thread built:", {
            totalTweets: thread.length,
            tweetIds: thread.map((t) => ({
                id: t.id,
                text: t.text?.slice(0, 50),
            })),
        });

        return thread;
    }
}
