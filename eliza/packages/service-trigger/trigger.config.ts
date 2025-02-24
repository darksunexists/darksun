import { defineConfig } from "@trigger.dev/sdk/v3";

import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";

export default defineConfig({
  project: "proj_mskjtvwwpjdqxgnwrohk",
  runtime: "node",
  logLevel: "debug",
  // The max compute seconds a task is allowed to run. If the task run exceeds this duration, it will be stopped.
  // You can override this on an individual task.
  // See https://trigger.dev/docs/runs/max-duration
  maxDuration: 3600,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
  telemetry:  {
    instrumentations: [
      new UndiciInstrumentation(),
      new HttpInstrumentation(),
      new PgInstrumentation(),
    ]
  },
  build: {
    external: ["@elizaos/client-twitter-v2", "agent-twitter-client", "onnxruntime-node", "@anush008", "sharp"],
  },
  dirs: ["./src/trigger"],
  onStart: async () => {
    console.log("Starting Trigger.dev");
  },
  onFailure: async () => {
    console.log("Trigger.dev failed");
  },
  onSuccess: async () => {
    console.log("Trigger.dev succeeded");
  },
});
