import { bringAgentWithWalletAddress } from "../functions/bringIQData";

let onchainJson = null;

if (process.env.IQ_LOAD_CHARACTER == "true") {
    onchainJson = await (async () => {
        return await bringAgentWithWalletAddress();
    })();
}

export { onchainJson };
