/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger, task } from "@trigger.dev/sdk/v3";

import { 
    ProcessSimilarityTriggerPayload,
    ProcessSimilarityResponse,
    SimilarityUpdate,
} from "../types";

export const processSimilarityTask = task({
  id: "process-similarity",
  queue: {
    concurrencyLimit: 3,
  },
  onStart: async (payload: ProcessSimilarityTriggerPayload ) => {
    console.log("Process similarity task started");
    logger.log("Process similarity task started", {
        backroomId: payload.backroomId,
    });
  },
  run: async (payload: ProcessSimilarityTriggerPayload): Promise<ProcessSimilarityResponse> => {
    logger.log("Process similarity task started");
    
    const { backroomId } = payload;

    const apiKey = process.env.BACKEND_API_KEY!;
    const url = process.env.BACKROOM_BASE_URL!;

    if (!url) {
        logger.error("BACKROOM_BASE_URL is not set");
        return {
            success: false,
            message: "BACKROOM_BASE_URL is not set",
        }
    }

    if (!apiKey) {
      logger.error("BACKEND_API_KEY is not set");
      return {
        success: false,
        message: "BACKEND_API_KEY is not set",
      }
    }

    const headers = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    };

    const res = await fetch(`${url}/process-similarity`, {
      method: "POST",
      headers,
      body: JSON.stringify({ backroomId }),
    });

    if (!res.ok) {
      logger.error("Failed to start similarity processing", {
        status: res.status,
        statusText: res.statusText
      });
      return {
        success: false,
        message: `HTTP error: ${res.status} ${res.statusText}`
      };
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Add new chunk to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete events from buffer
        const events = buffer.split('\n\n');
        buffer = events.pop() || ''; // Keep last incomplete event in buffer

        for (const event of events) {
          if (!event.trim()) continue;

          const match = event.match(/^data: (.+)$/m);
          if (!match) continue;

          try {
            const update = JSON.parse(match[1]) as SimilarityUpdate;
            
            switch (update.type) {
              case 'SIMILARITY_COMPLETE':
                logger.log("Similarity complete", update.data);
                return {
                  success: true,
                  message: "Similarity complete",
                  topic: update.data.topic,
                };
              case 'SIMILARITY_ERROR':
                logger.error("Similarity error", update.data);
                return {
                  success: false,
                  message: update.data.error,
                };
              default:
                logger.log(`${update.type}`, update.data);
            }
          } catch (err) {
            logger.error("Error parsing SSE data", { error: err, data: match[1] });
          }
        }
      }
    } catch (error) {
      logger.error("Error processing SSE stream", { error });
      throw error;
    } finally {
      reader?.releaseLock();
    }

    return {
      success: false,
      message: "Stream ended without completion",
    };
  },
//   onSuccess: async (payload, result, params) => {
//     logger.log("Process similarity task completed", {
//         result,
//         params,
//         payload,
//     });
//   },
//   onFailure: async (payload, error, params) => {
//     logger.error("Process similarity task failed", {
//         error,
//         params,
//         payload,
//     });
//   },
//   cleanup: async (payload, params) => {
//     logger.log("Process similarity task cleanup", {
//         params,
//         payload,
//     });
//   },
//   init: async (payload, params) => {
//     logger.log("Process similarity task init", {
//         params,
//         payload,
//     });
//   },    
  handleError: async (payload, error, params) => {
    logger.error("Process similarity task error", {
        error,
        params,
        payload,
    });
    return {
      error,
      retryDelayInMs: 5000,
    }
  },
});