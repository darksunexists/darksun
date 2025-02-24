import { logger, task, wait } from "@trigger.dev/sdk/v3";

import type { 
    BackroomServiceResponse, 
    InvestigateTriggerPayload, 
    InvestigationTriggerResponse 
} from "../types";

export const investigationTask = task({
  id: "investigation",
  queue: {
    concurrencyLimit: 3,
  },
  run: async (payload: InvestigateTriggerPayload, { ctx }): Promise<InvestigationTriggerResponse> => {
    logger.log("Investigation task started");

    const investigateParams = payload.investigateParams;
    const url = payload.url;

    const apiKey = process.env.BACKEND_API_KEY!;

    if (!apiKey) {
        logger.error("BACKEND_API_KEY is not set");
        return {
            success: false,
            message: "BACKEND_API_KEY is not set",
            data: null,
        }
    }

    const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
    };

    logger.log("Investigating...", {
        investigateParams,
        url,
        apiKey,
    });

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(investigateParams),
    });

    // Set up event source to handle streaming updates
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = ''; // Add this line to store incomplete chunks

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true }); // Append new data to buffer
        
        // Split on double newlines and process complete messages
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || ''; // Keep the last incomplete chunk in the buffer

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
                case 'RUNTIMES_READY':
                    logger.log("Runtimes ready", update.data);
                    break;
                case 'INITIAL_QUESTION':
                    logger.log("Initial question generated", update.data);
                    break;
                case 'CONVERSATION_START':
                    logger.log("Investigation conversation started", update.data);
                    break;
                case 'CONVERSATION_UPDATE':
                    logger.log("Conversation updated", update.data);
                    break;
                case 'CONVERSATION_COMPLETE':
                    logger.log("Investigation conversation completed", update.data);
                    break;
                case 'METADATA_READY':
                    logger.log("Metadata generated");
                    break;
                case 'IQ_RESULT':
                    logger.log("IQ processing complete");
                    break;
                case 'BACKROOM_ENTRY_CREATED':
                    logger.log("Backroom entry created", update.data);
                    break;
                case 'INVESTIGATION_ENTRY_CREATED':
                    logger.log("Investigation entry created", update.data);
                    break;
                case 'COMPLETE':
                    logger.log("Investigation complete", update.data);
                    const data = update.data as BackroomServiceResponse;
                    console.log("Investigation complete", data);
                    return {
                        success: data.success,
                        message: data.message,
                        data: data.data
                    };
                case 'ERROR':
                    logger.error("Investigation error", update.data);
                    return {
                        success: false,
                        message: update.data.error,
                        data: null
                    };
            }
        }
    }

    // Process any remaining data in the buffer
    if (buffer.trim()) {
        try {
            const jsonStr = buffer.replace(/^data: /, '').trim();
            const finalUpdate = JSON.parse(jsonStr);
            // Handle the final update
            switch (finalUpdate.type) {
                case 'RUNTIMES_READY':
                    logger.log("Runtimes ready", finalUpdate.data);
                    break;
                case 'INITIAL_QUESTION':
                    logger.log("Initial question generated", finalUpdate.data);
                    break;
                case 'CONVERSATION_START':
                    logger.log("Investigation conversation started", finalUpdate.data);
                    break;
                case 'CONVERSATION_UPDATE':
                    logger.log("Conversation updated", finalUpdate.data);
                    break;
                case 'CONVERSATION_COMPLETE':
                    logger.log("Investigation conversation completed", finalUpdate.data);
                    break;
                case 'METADATA_READY':
                    logger.log("Metadata generated");
                    break;
                case 'IQ_RESULT':
                    logger.log("IQ processing complete");
                    break;
                case 'BACKROOM_ENTRY_CREATED':
                    logger.log("Backroom entry created", finalUpdate.data);
                    break;
                case 'INVESTIGATION_ENTRY_CREATED':
                    logger.log("Investigation entry created", finalUpdate.data);
                    break;
                case 'COMPLETE':
                    logger.log("Investigation complete", finalUpdate.data);
                    const finalData = finalUpdate.data as BackroomServiceResponse;
                    console.log("Investigation complete", finalData);
                    return {
                        success: finalData.success,
                        message: finalData.message,
                        data: finalData.data
                    };
                case 'ERROR':
                    logger.error("Investigation error", finalUpdate.data);
                    return {
                        success: false,
                        message: finalUpdate.data.error,
                        data: null
                    };
            }
        } catch (error) {
            logger.error("Error parsing final buffer", {
                buffer,
                error: error.message,
            });
        }
    }

    return {
        success: false,
        message: "Investigation failed",
        data: null
    };
  },
//   onFailure: async (payload, error, params) => {
//       return {
//         success: false,
//         message: error instanceof Error ? error.message : String(error),
//         data: null
//       }
//   },
handleError: async (payload, error, params) => {
    logger.error("Investigation error");
    if (error instanceof Error) {
        logger.error(error.message);
    } else {
        logger.error(String(error));
    }
    logger.error("Params: ", params);
    throw error;
}
});
