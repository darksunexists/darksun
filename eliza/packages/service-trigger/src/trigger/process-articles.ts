/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger, task } from "@trigger.dev/sdk/v3";
import { 
    ProcessArticlesTriggerPayload,
    ProcessArticlesUpdate,
    ProcessArticlesUpdateType,
    InvestigationTriggerResponse 
} from "../types";

export const processArticlesTask = task({
  id: "process-articles",
  queue: {
    concurrencyLimit: 2,
  },
  // Set an optional maxDuration to prevent tasks from running indefinitely
//   maxDuration: 600, // Stop executing after 300 secs (5 mins) of compute
  run: async (payload: ProcessArticlesTriggerPayload): Promise<InvestigationTriggerResponse> => {
    logger.log("Process articles task started");

    const { newBackroomId } = payload;
    const url = process.env.BACKROOM_BASE_URL!;
    const apiKey = process.env.BACKEND_API_KEY!;

    if (!url || !apiKey) {
      const message = !url ? "BACKEND_BASE_URL is not set" : "BACKEND_API_KEY is not set";
      logger.error(message);
      return { success: false, message, data: null };
    }

    logger.log("Processing articles", { newBackroomId, url, apiKey });

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const res = await fetch(`${url}/generate-articles-v3`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ newBackroomId }),
      });

      if (!res.ok) {
        logger.error("Failed to start article generation", {
          status: res.status,
          statusText: res.statusText
        });
        return {
          success: false,
          message: `HTTP error: ${res.status} ${res.statusText}`,
          data: null
        };
      }

      if (!res.body) {
        logger.error("No response body received");
        return {
          success: false,
          message: "No response body received",
          data: null
        };
      }

      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          logger.log("Stream completed normally");
          break;
        }
        
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        const updates = parts
          .filter(part => part.trim().startsWith('data: '))
          .map(part => {
            try {
              const jsonStr = part.replace(/^data: /, '').trim();
              return JSON.parse(jsonStr);
            } catch (error) {
              logger.error("Error parsing SSE message", {
                part,
                error: error.message,
              });
              return null;
            }
          })
          .filter(update => update !== null);

        for (const update of updates) {
          switch (update.type) {
            case 'ARTICLE_COMPLETE':
              logger.log("Article generation complete", update.data);
              return {
                success: true,
                message: "Article generation complete",
                data: update.data
              };
            case 'ERROR':
              logger.error("Article generation error", update.data);
              return {
                success: false,
                message: update.data.error,
                data: null
              };
            default:
              logger.log(`${update.type}`, update.data);
          }
        }
      }

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        try {
          const jsonStr = buffer.replace(/^data: /, '').trim();
          const finalUpdate = JSON.parse(jsonStr);
          if (finalUpdate.type === 'ARTICLE_COMPLETE') {
            return {
              success: true,
              message: "Article generation complete",
              data: finalUpdate.data
            };
          }
        } catch (error) {
          logger.error("Error processing final buffer", {
            buffer,
            error: error.message,
          });
        }
      }

      return {
        success: false,
        message: "Stream ended without completion",
        data: null
      };

    } catch (error) {
      logger.error("Error processing SSE stream", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      throw error; // Let the handleError function deal with it
    } finally {
      // Ensure we always release the reader
      if (reader) {
        try {
          await reader.cancel();
          logger.log("Stream reader cancelled successfully");
        } catch (error) {
          logger.error("Error cancelling stream reader", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  },

  handleError: async (payload, error, params) => {
    logger.error("Process articles task error", {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : String(error),
      params,
      payload,
    });

    // Ensure the error is properly thrown to trigger cleanup
    throw error;
  },

  cleanup: async (payload, params) => {
    logger.log("Process articles task cleanup", {
      params,
      payload,
    });
  },

  onFailure: async (payload, error, params) => {
    logger.error("Process articles task failed", {
      error: error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : String(error),
      params,
      payload,
    });
  },

  // Keep other lifecycle methods...
  init: async (payload, params) => {
    logger.log("Process articles task init", { params, payload });
  },

  onSuccess: async (payload, result, params) => {
    logger.log("Process articles task completed", { result, params, payload });
  },

  onStart: async (payload, params) => {
    logger.log("Process articles task started", { params, payload });
  },
});
