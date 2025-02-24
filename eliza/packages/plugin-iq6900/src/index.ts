import { Plugin } from "@elizaos/core";
export { onchainJson } from "./types/iq";

export const elizaCodeinPlugin: Plugin = {
    name: "eliza-codein",
    description: "Plugin that interacts with the on-chain inscription method “Code-In",
    actions: [
    ],
    providers: [
        /* custom providers */
    ],
    evaluators: [
         /* custom evaluators */
    ],
    services: [],
    clients: [],

};