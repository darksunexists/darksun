import {
    Keypair,
    Transaction,
    SystemProgram,
    PublicKey,
    Connection,
} from "@solana/web3.js";
import bs58 from "bs58";
import * as anchor from "@coral-xyz/anchor";
import idl from "../idl.json" with { type: "json" };
import { elizaLogger, getEnvVariable } from "@elizaos/core";

export class IQ {
    private network: string;
    private iqHost: string;
    private web3: typeof anchor.web3;
    private connection: Connection;
    private provider: anchor.AnchorProvider;
    private keypair: Keypair;
    private expected_receiver: PublicKey;
    private chunkSize: number;
    private amountToSend: number;

    constructor(
        network = "https://api.mainnet-beta.solana.com",
        iqHost = "https://solanacontractapi.uc.r.appspot.com"
    ) {
        this.network = network;
        this.iqHost = iqHost;
        this.web3 = anchor.web3;
        this.chunkSize = 850;
        this.amountToSend = 0.003 * this.web3.LAMPORTS_PER_SOL;

        const secretKeyBase58 = getEnvVariable("IQ_SECRET_KEY", "");

        if (secretKeyBase58 === "") {
            throw new Error("IQ_SECRET_KEY is not set");
        }

        // Initialize keypair
        const secretKey = bs58.decode(secretKeyBase58);
        this.keypair = Keypair.fromSecretKey(secretKey);

        // Initialize connection and provider
        this.connection = new Connection(this.network, "processed");
        this.provider = new anchor.AnchorProvider(
            this.connection,
            new anchor.Wallet(this.keypair),
            { commitment: "processed" }
        );
        anchor.setProvider(this.provider);

        this.expected_receiver = new PublicKey(
            "GbgepibVcKMbLW6QaFrhUGG34WDvJ2SKvznL2HUuquZh"
        );
    }

    private async getPDA(userKey: string): Promise<string | undefined> {
        try {
            const response = await fetch(`${this.iqHost}/getPDA/${userKey}`);
            const data = await response.json();
            if (response.ok) {
                return data.PDA as string;
            }
            elizaLogger.error(`Failed to fetch PDA: ${data.error || 'Unknown error'}`);
            throw new Error("getPDA - Failed to fetch PDA");
        } catch (error) {
            elizaLogger.error("Error fetching PDA:", error);
            throw error;
        }
    }

    private async getDBPDA(userKey: string): Promise<string | undefined> {
        try {
            const response = await fetch(`${this.iqHost}/getDBPDA/${userKey}`);
            const data = await response.json();
            if (response.ok) {
                return data.DBPDA as string;
            }
            elizaLogger.error(`Failed to fetch DBPDA: ${data.error || 'Unknown error'}`);
            throw new Error("getDBPDA - Failed to fetch DBPDA");
        } catch (error) {
            elizaLogger.error("Error fetching DBPDA:", error);
            throw error;
        }
    }

    private async txSend(tx: Transaction): Promise<string | undefined> {
        try {
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.feePayer = this.keypair.publicKey;
            tx.lastValidBlockHeight = lastValidBlockHeight;
            
            tx.sign(this.keypair);
            elizaLogger.info("Sending transaction");

            const txid = await this.web3.sendAndConfirmTransaction(
                this.connection,
                tx,
                [this.keypair],
                {
                    maxRetries: 5,
                    skipPreflight: true,
                    commitment: "processed",
                }
            );

            elizaLogger.info("Transaction sent, txid:", txid);
            return txid;
        } catch (error) {
            if (error instanceof Error) {
                elizaLogger.error("Failed to send transaction: " + error.message);
            }
            throw error;
        }
    }

    private async createSendTransaction(
        code: string,
        before_tx: string,
        method: number,
        decode_break: number
    ): Promise<string | undefined> {
        try {
            const userKey = this.keypair.publicKey;
            const PDA = await this.getPDA(userKey.toString());

            if (!PDA) {
                elizaLogger.error("Failed to fetch PDA");
                throw new Error("Failed to fetch PDA");
            }

            // @ts-expect-error - idl is not typed
            const program = new anchor.Program(idl, userKey);

            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();

            const tx = new this.web3.Transaction({
                blockhash: blockhash,
                lastValidBlockHeight: lastValidBlockHeight,
                feePayer: userKey,
            });
            const ix = await program.methods
                .sendCode(code, before_tx, method, decode_break)
                .accounts({
                    user: userKey,
                    codeAccount: PDA,
                    systemProgram: SystemProgram.programId,
                })
                .instruction();

            tx.add(ix);
            return await this.txSend(tx);
        } catch (error) {
            elizaLogger.error(
                "createSendTransaction - Failed to create instruction:",
                error
            );
            throw error;
        }
    }

    private async createDbCodeTransaction(
        handle: string,
        tail_tx: string,
        type: string,
        offset: string
    ): Promise<string | undefined> {
        try {
            const userKey = this.keypair.publicKey;
            const DBPDA = await this.getDBPDA(userKey.toString());

            if (!DBPDA) {
                elizaLogger.error("Failed to fetch DBPDA");
                throw new Error("Failed to fetch DBPDA");
            }

            // @ts-expect-error - idl is not typed
            const program = new anchor.Program(idl, userKey);
            const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
            const tx = new this.web3.Transaction({ 
                feePayer: userKey,
                blockhash: blockhash,
                lastValidBlockHeight: lastValidBlockHeight,
            });

            // const transix = this.web3.SystemProgram.transfer({
            //     fromPubkey: userKey,
            //     toPubkey: new PublicKey(DBPDA),
            //     lamports: this.amountToSend,
            // });

            // tx.add(transix);

            const dbcodefreeix = await program.methods
                .dbCodeInForFree(handle, tail_tx, type, offset)
                .accounts({
                    user: userKey,
                    dbAccount: DBPDA,
                    systemProgram: SystemProgram.programId,
                })
                .instruction();

            tx.add(dbcodefreeix);
            return await this.txSend(tx);
        } catch (error) {
            elizaLogger.error("Failed to create db code transaction:", error);
            elizaLogger.info("Failed to create db code transaction: ", error.message);
            throw error;
        }
    }

    private async getChunk(textData: string): Promise<string[]> {
        const datalength = textData.length;
        const totalChunks = Math.ceil(datalength / this.chunkSize);
        const chunks = [];

        for (let i = 0; i < totalChunks; i++) {
            const start = i * this.chunkSize;
            const end = Math.min(start + this.chunkSize, datalength);
            chunks.push(textData.slice(start, end));
        }

        return chunks.length < 1 ? ["null"] : chunks;
    }

    public async processText(
        textData: string,
        handle: string,
        type: string = "text",
        offset: string = "no offset"
    ): Promise<string | undefined> {
        const chunkList = await this.getChunk(textData);
        let beforeHash: string = "Genesis";
        let method = 0;
        let decode_break = 0;

        let retries = 0;

        elizaLogger.info("Number of chunks: " + chunkList.length);
        for (const text of chunkList) {

            while (retries < 10) {
                try {
                    const txHash = await this.createSendTransaction(
                        text,
                        beforeHash,
                        method,
                        decode_break
                    );
                    
                    if (!txHash) {
                        elizaLogger.error("Failed to send transaction chunk");
                        throw new Error("Failed to send transaction chunk");
                    }
                    
                    beforeHash = txHash;

                    // Wait a moment for the transaction to be confirmed
                    await new Promise((resolve) => setTimeout(resolve, 1000));

                    break;

                } catch (error) {
                    elizaLogger.error("Failed to send transaction chunk:", error);
                    retries++;
                }
            }

            if (retries >= 5) {
                elizaLogger.error("Failed to send transaction chunk");
            }
        }
        retries = 0;

        let resultHash: string | undefined;

        while (retries < 3) {
            try {
                resultHash = await this.createDbCodeTransaction(
                    handle,
                    beforeHash,
                    type,
                    offset
                );

                elizaLogger.info("Result hash: " + resultHash);

                // if (!resultHash) {
                //     elizaLogger.error("Failed to create db code transaction");
                //     return undefined;
                // }
                break;
            } catch (error) {
                elizaLogger.error("Failed to create db code transaction:", error);
                retries++;
            }
        }

        return resultHash;
    }
}
