import { task, logger } from "@trigger.dev/sdk/v3";
import { generateShortTask } from "./generate-short";
import { postArticleTweetTask } from "./post-article-tweet";
import { TransitionEffectEnum, VideoGenerationError } from "../types/longstories";
import { ArticleTweetPayload } from "../types";

export const generateArticleTweetTask = task({
  id: "generate-article-tweet",
  queue: { concurrencyLimit: 3 },
  run: async (payload: ArticleTweetPayload) => {
    logger.log("Generate article tweet task started");

    const motionEnabled = process.env.MOTION_ENABLED === "true";

    try {
      // Generate the video
      const videoResult = await generateShortTask.triggerAndWait({
        articleContent: payload.articleContent,
        articleTitle: payload.articleTitle,
        articleId: payload.articleId,
        videoParams: {
          effects: { 
            transition: TransitionEffectEnum.Enum.fade,
            floating: true
          },
          quality: "medium",
          motionConfig: {
            enabled: motionEnabled,
            strength: 3
          }
        },
      }).unwrap();

      // Post tweets
      const tweetResult = await postArticleTweetTask.triggerAndWait({
        ...payload,
        videoUrl: videoResult.videoUrl,
      }).unwrap();

      return {
        success: true,
        videoUrl: videoResult.videoUrl,
        mainTweetId: tweetResult.mainTweetId,
        replyTweetId: tweetResult.replyTweetId
      };

    } catch (error) {
      if (error instanceof VideoGenerationError) {
        throw new Error(`Video generation failed: ${error.message}`);
      }
      throw new Error("Article tweet process failed");
    }
  },
  handleError: (payload, error) => {
    logger.error("Article generation pipeline error", { error, payload });
    throw error;
  }
});