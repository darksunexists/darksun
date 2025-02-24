
import { Plugin } from "@elizaos/core";

import { describeImage } from "./actions/describe-image.ts";
import { ImageDescriptionService } from "./services/image.ts";

const ImageDescriptionPlugin: Plugin = {
    name: "image-description",
    description: "Image description plugin",
    services: [new ImageDescriptionService()],
    actions: [describeImage],
};

export { ImageDescriptionService, ImageDescriptionPlugin };
