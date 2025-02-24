import { logger, task } from "@trigger.dev/sdk/v3";
import type { Tweet } from "agent-twitter-client";

import { processTwitterResponse, initializeScraper } from "../utils/x.ts";

import { PostInvestigationTweetPayload, PostInvestigationTweetResponse, TwitterCredentials } from "../types.ts";
import { splitTweetContent, wait } from "../utils/index.ts";
import { supabase } from "../utils/createSupabaseClient.ts";

export const postInvestigationTweetTask = task({
  id: "post-investigation-tweet",
  queue: {
    concurrencyLimit: 3,
  },
  run: async (payload: PostInvestigationTweetPayload): Promise<PostInvestigationTweetResponse> => {
    logger.log("Post investigation tweet task started");

    const rawCookies = process.env.TWITTER_COOKIES!;

    const twitterCredentials: TwitterCredentials = {
      username: process.env.TWITTER_USERNAME!,
      password: process.env.TWITTER_PASSWORD!,
      email: process.env.TWITTER_EMAIL!,
      cookies: rawCookies,
    };

    const { investigateResponse, backroomId, tweet, twitterConfig } = payload;
    const isLongTweet = twitterConfig.MAX_INVESTIGATE_TWEET_LENGTH > 280;

    try {
      const scraper = await initializeScraper(twitterCredentials);

      logger.log("Scraper initialized");

      const withMagnifyGlass = "🔍 " + investigateResponse.text;

      const tweetChunks = splitTweetContent(withMagnifyGlass, twitterConfig.MAX_INVESTIGATE_TWEET_LENGTH);

      const sentTweets: Tweet[] = [];
      let previousTweetId = tweet.id;

      for (const chunk of tweetChunks) {
        const result = await scraper.sendTweet(chunk.trim(), previousTweetId);
        const tweet = await processTwitterResponse(result, isLongTweet, twitterCredentials.username);
        sentTweets.push(tweet);
        previousTweetId = tweet.id;

        await wait(1000, 2000);
      }

      logger.log("Initial response sent");
      
      // const initialTweet = await processTwitterResponse(initialResponse, isLongTweet, twitterCredentials.username);

      // Send follow-up tweet with backroom link
      const baseUrl = process.env.DARKSUN_CONVO_URL || "https://darksun.is/os/convo";
      const followupResponse = await scraper.sendTweet(
        `See the full investigation here: ${baseUrl}/${backroomId}`,
        sentTweets[sentTweets.length - 1].id
      );
      
      const followupTweet = await processTwitterResponse(followupResponse, false, twitterCredentials.username);

      try {
        const { error } = await supabase.from("investigations").update({
          tweet_response: sentTweets.map(tweet => tweet.text).join("\n\n"),
          tweet_url: sentTweets[0].permanentUrl,
          in_reply_to: tweet.tweetUrl

        }).eq("id", payload.investigationId);

        if (error) {
          logger.error("Error updating investigation", { error });
        }

      } catch (error) {
        logger.error("Error updating investigation", { error });
      }


      return {
        success: true,
        message: "Investigation tweets posted successfully",
        data: {
          firstTweetUrl: sentTweets[0].permanentUrl,
          tweetResponse: sentTweets.map(tweet => tweet.text).join("\n"),
          initialTweet: sentTweets[0],
          followupTweet: followupTweet
        }
      };

    } catch (error) {
      logger.error("Error posting investigation tweet", error);
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error occurred"
      };
    }
  },
  handleError: async (payload, error) => {
    logger.error("Post investigation tweet task error", {
      error: error instanceof Error ? error.message : String(error),
      payload
    });
    throw error;
  }
}); 