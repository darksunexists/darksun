import { Plugin } from "@elizaos/core";

import { investigateAction } from "./actions/investigate.ts";
import { shouldInvestigateEvaluator } from "./evaluators/shouldInvestigateEvaluator.ts";
import { InvestigateBackroomService } from "./services/investigate-backroom.ts";

export const investigatePlugin: Plugin = {
    name: "investigate",
    description: "Read some text and determine if it should be investigated further",
    actions: [investigateAction],
    evaluators: [shouldInvestigateEvaluator],
    services: [new InvestigateBackroomService()],
};

export default investigatePlugin;
