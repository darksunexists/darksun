import { task, logger } from "@trigger.dev/sdk/v3";
import { Scraper } from "agent-twitter-client";
import { initializeScraper, processTwitterResponse } from "../utils/x.ts";
import { TwitterCredentials } from "../types.ts";
import { supabase } from "../utils/createSupabaseClient.ts";

interface ArticleTweetPayload {
  articleTitle: string;
  articleId: number;
  videoUrl: string;
}

export const postArticleTweetTask = task({
  id: "post-article-tweet",
  queue: { concurrencyLimit: 3 },
  run: async (payload: ArticleTweetPayload) => {
    try {
        const cookies = process.env.TWITTER_COOKIES!;

        const twitterCredentials: TwitterCredentials = {
            username: process.env.TWITTER_USERNAME!,
            password: process.env.TWITTER_PASSWORD!,
            email: process.env.TWITTER_EMAIL!,
            cookies: cookies,
        };


        const scraper = await initializeScraper(twitterCredentials);
        logger.log("Scraper initialized for article tweet");

        // Fetch video media
        let mediaData: { data: Buffer; mediaType: string }[] = [];
        try {
            logger.log("Fetching video from URL", { url: payload.videoUrl });
            const response = await fetch(payload.videoUrl);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch video: ${response.status} ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const mediaType = response.headers.get("content-type") || "video/mp4";
            
            mediaData = [{
                data: Buffer.from(arrayBuffer),
                mediaType: mediaType
            }];

            logger.log("Video attachment ready", { size: mediaData[0].data.byteLength });
        } catch (error) {
            logger.error("Failed to prepare video attachment", { error });
            throw new Error("Video attachment preparation failed");
        }

      // Main tweet with video
      const baseUrl = process.env.DARKSUN_BASE_URL || "https://darksun.is";
      const mainTweetContent = `${payload.articleTitle}\n\nArticle link below`;
      
      const mainTweetResponse = await scraper.sendTweet(mainTweetContent, undefined, mediaData);
      const mainTweet = await processTwitterResponse(mainTweetResponse, false, twitterCredentials.username);
      logger.log("Main article tweet posted with video", { 
        tweetId: mainTweet.id,
        mediaType: mediaData[0].mediaType
      });

      // Reply tweet with permalink
      await new Promise(resolve => setTimeout(resolve, 2000));
      const permalink = `${baseUrl}/os/wiki/${encodeURIComponent(payload.articleTitle)}`;
      const replyContent = `Read the full article here: ${permalink}`;
      
      const replyResponse = await scraper.sendTweet(replyContent, mainTweet.id);
      const replyTweet = await processTwitterResponse(replyResponse, false, twitterCredentials.username);
      logger.log("Article link reply posted", { parentTweetId: mainTweet.id });

      try {
        const { error } = await supabase.from("articles").update({
            short_url: payload.videoUrl
        }).eq("id", payload.articleId);

        if (error) {
            logger.error("Failed to update article short url", { error });
        }
      } catch (error) {
        logger.error("Failed to update article short url", { error });
      }

      return {
        success: true,
        videoUrl: payload.videoUrl,
        mainTweetId: mainTweet.id,
        replyTweetId: replyTweet.id,
        tweetThreadUrl: mainTweet.permanentUrl
      };

    } catch (error) {
      logger.error("Article tweet posting failed", { error });
      throw new Error("Failed to post article tweets");
    }
  },
  handleError: (payload, error) => {
    logger.error("Article tweet task error", {
      error: error instanceof Error ? error.message : String(error),
      payload
    });
    throw error;
  }
}); 