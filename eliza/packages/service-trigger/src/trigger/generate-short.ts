import { logger, SubtaskUnwrapError, task } from "@trigger.dev/sdk/v3";
import { Scraper } from "agent-twitter-client";
import { 
  VideoCreationResponse,
  PollingResponse,
  VideoGenerationError,
  TransitionEffectEnum
} from "../types/longstories";
import { generateVideoRequest } from "../utils/longstories";
import { GenerateShortPayload } from "../types";

/**
 * NEW API: https://longstories.ai/api/v1/agent
 */

async function createVideo(payload: Omit<GenerateShortPayload, "twitterCredentials">): Promise<VideoCreationResponse> {
  const videoServiceUrl = process.env.VIDEO_SERVICE_URL;
  const videoServiceApiKey = process.env.VIDEO_SERVICE_API_KEY;

  if (!videoServiceUrl || !videoServiceApiKey) {
    throw new Error("Video service configuration missing");
  }

  // Default values
  const params = {
    effects: {
      transition: TransitionEffectEnum.Enum.fade,
      floating: false,
      ...payload.videoParams.effects
    },
    quality: payload.videoParams.quality || "medium",
    motionConfig: payload.videoParams.motionConfig || {
      enabled: false,
      strength: 0
    }
  };

  const videoRequest = generateVideoRequest(
    payload.articleContent, 
    {
      effectsConfig: params.effects,
      quality: params.quality,
      motionConfig: params.motionConfig,
    }
  );

  const response = await fetch(`${videoServiceUrl}/api/v1/short`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": videoServiceApiKey,
    },
    body: JSON.stringify(videoRequest),
  });

  if (!response.ok) {
    const errorBody = await response.json();
    logger.error("Video API responded with error", {
      status: response.status,
      error: errorBody
    });
    throw new Error(`Video API responded with ${response.status}`);
  }

  return response.json();
}

async function checkVideoStatus(runId: string): Promise<PollingResponse> {
  const videoServiceUrl = process.env.VIDEO_SERVICE_URL;
  const videoServiceApiKey = process.env.VIDEO_SERVICE_API_KEY;

  if (!videoServiceUrl || !videoServiceApiKey) {
    throw new Error("Video service configuration missing");
  }

  const response = await fetch(`${videoServiceUrl}/api/v1/short?runId=${runId}`, {
    headers: {
      "x-api-key": videoServiceApiKey,
    }
  });

  if (!response.ok) {
    logger.error("Status check failed", {
      status: response.status,
      body: await response.json().catch(() => (response.statusText))
    });
    return {
      status: "FAILED",
      isCompleted: true,
      isSuccess: false,
      output: undefined,
      error: {
        message: `Status check failed: ${response.status}`,
        details: await response.json().catch(() => ("No details available"))
      }
    };
  }

  const res = await response.json();

  return res.data as PollingResponse;
}

export const generateShortTask = task({
  id: "generate-short",
  queue: { concurrencyLimit: 3 },
  run: async (payload: GenerateShortPayload, ctx) => {

    logger.info("Generating short video", { payload });

    try {
      // Start video generation
      const videoResponse = await createVideo(payload);
      
      // Poll until completion
      let status = await checkVideoStatus(videoResponse.data.id);
      while (!status.isCompleted) {
        await new Promise(resolve => setTimeout(resolve, 20000));
        status = await checkVideoStatus(videoResponse.data.id);
        
        if (status.error) {
          throw new VideoGenerationError({
            code: "POLLING_ERROR",
            message: status.error.message,
            details: status.error.details
          });
        }
      }

      logger.info("Video generation polling status", { status });

      if (!status.output?.url) {
        throw new Error("Video generation completed but no URL found");
      }

      return {
        success: true,
        videoUrl: status.output.url,
      };

    } catch (error) {
      logger.error("Video generation task failed", { error });
      
      if (error instanceof VideoGenerationError) {
        throw new SubtaskUnwrapError(error.message, ctx.ctx.run.id, error);
      }
      
      throw new SubtaskUnwrapError(
        "Video generation process failed",
        ctx.ctx.run.id,
        error
      );
    }
  },
  handleError: (payload, error) => {
    logger.error("Video generation task error", {
      error: error instanceof Error ? error.message : String(error),
      payload
    });
    throw error;
  }
});