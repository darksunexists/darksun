import { logger, SubtaskUnwrapError, task } from "@trigger.dev/sdk/v3";

import { processArticlesTask } from "./process-articles";
import { processSimilarityTask } from "./process-similarity";
import { 
    BackroomCreatedTriggerPayload,
    BackroomCreatedResponse,
    ProcessSimilarityResponse 
} from "../types";

export const backroomCreatedTask = task({
  id: "backroom-created",
  retry: {
    maxAttempts: 1,
  },
  queue: {
    concurrencyLimit: 3,
  },
  run: async (payload: BackroomCreatedTriggerPayload ): Promise<BackroomCreatedResponse> => {
    logger.log("Backroom created task started");

    const backroomUrl = process.env.BACKROOM_BASE_URL!;
    const backroomClientSimilarityPath = process.env.BACKROOM_CLIENT_SIMILARITY_PATH!;
    const backroomClientArticlesPath = process.env.BACKROOM_CLIENT_ARTICLES_PATH!;

    logger.log("BACKROOM_BASE_URL", { backroomUrl });
    logger.log("BACKROOM_CLIENT_SIMILARITY_PATH", { backroomClientSimilarityPath });
    logger.log("BACKROOM_CLIENT_ARTICLES_PATH", { backroomClientArticlesPath });

    if (!backroomUrl || !backroomClientSimilarityPath || !backroomClientArticlesPath) {
        logger.error("BACKROOM_BASE_URL, BACKROOM_CLIENT_SIMILARITY_PATH, BACKROOM_CLIENT_ARTICLES_PATH is not set");

        throw new Error("BACKROOM_BASE_URL, BACKROOM_CLIENT_SIMILARITY_PATH, BACKROOM_CLIENT_ARTICLES_PATH is not set");

    }

    const backroomId = payload.backroomId;
    const topic = payload.topic;

    logger.log("Triggering similarity task");

    logger.log("Triggering similarity task", {
        backroomId,
        topic,
    });

    let similarityTask: ProcessSimilarityResponse;

    try {
        similarityTask = await processSimilarityTask.triggerAndWait({
            backroomId,
            topic,
        }, {
            // tags: ["search-similarity"],
        }).unwrap();


        if (!similarityTask.success) {
            logger.error("Similarity task failed", {
                message: similarityTask.message,
                data: similarityTask,
            });
            return {
                success: false,
                message: similarityTask.message,
            }
        }


    logger.log("Similarity task completed");

    logger.log("Triggering articles task", {
        topic: topic,
    });

    } catch (error) {
        logger.error("Similarity task failed", {
            error,
        });

      if (error instanceof SubtaskUnwrapError) {
            logger.error("Similarity task failed", {
                error,
            });
            logger.error("Error in fetch-post-task", {
                runId: error.runId,
                taskId: error.taskId,
                cause: error.cause,
            });
        }

        return {
            success: false,
            message: "Similarity task failed",
        }
    }

    const articlesTask = await processArticlesTask.triggerAndWait({
        newBackroomId: backroomId,
    }, {
        // tags: ["search-articles"],
    }).unwrap();

    logger.log("Articles task completed", {
        success: articlesTask.success,
        message: articlesTask.message,
        data: articlesTask,
    });
    return {
        success: false,
        message: "Investigation failed",
    };
  },
  onSuccess: async (payload, result, params) => {
    logger.log("Backroom created task completed", {
        result,
        params,
    });
  },
  onFailure: async (payload, error, params) => {
    logger.error("Backroom created task failed", {
        error,
        params,
        payload,
    });
  },
  onStart: async (payload, params) => {
    logger.log("Backroom created task started", {
        params,
        payload,
    });
  },
  cleanup: async (payload, params) => {
    logger.log("Backroom created task cleanup", {
        params,
        payload,
    });
  },
  init: async (payload, params) => {
    logger.log("Backroom created task init", {
        params,
        payload,
    });
  },
  handleError: async (payload, error, params) => {
    logger.error("Backroom created task error", {
        error,
        params,
        payload,
    });
  },    
});