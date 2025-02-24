import { Context, Telegraf } from "telegraf";
import { IAgentRuntime, elizaLogger } from "@elizaos/core";
import { MessageManager } from "./messageManager.ts";

export class TelegramClient {
    private bot: Telegraf<Context>;
    private runtime: IAgentRuntime;
    private messageManager: MessageManager;

    constructor(runtime: IAgentRuntime, botToken: string) {
        elizaLogger.log("📱 Constructing new TelegramArticleClient...");
        this.runtime = runtime;
        this.bot = new Telegraf(botToken);
        this.messageManager = new MessageManager(this.bot, this.runtime);
        elizaLogger.log("✅ TelegramArticleClient constructor completed");
    }

    public async start(): Promise<void> {
        elizaLogger.log("🚀 Starting TelegramArticleClient bot...");
        try {
            await this.initializeBot();
            this.setupMessageHandlers();
            this.setupShutdownHandlers();
        } catch (error) {
            elizaLogger.error(
                "❌ Failed to launch TelegramArticleClient:",
                error
            );
            throw error;
        }
    }

    private async initializeBot(): Promise<void> {
        this.bot.launch({ dropPendingUpdates: true });
        elizaLogger.log(
            "✨ TelegramArticleClient successfully launched and is running!"
        );

        const botInfo = await this.bot.telegram.getMe();
        this.bot.botInfo = botInfo;
        elizaLogger.success(
            `TelegramArticleClient username: @${botInfo.username}`
        );

        this.messageManager.bot = this.bot;
    }

    private setupMessageHandlers(): void {
        elizaLogger.log("Setting up TelegramArticleClient message handlers...");

        this.bot.on("message", async (ctx) => {
            try {
                await this.messageManager.handleMessage(ctx);
            } catch (error) {
                elizaLogger.error("❌ Error handling message:", error);
                await ctx.reply(
                    "An error occurred while processing your message."
                );
            }
        });

        this.bot.on("photo", (ctx) => {
            elizaLogger.log(
                "📸 Received photo message with caption:",
                ctx.message.caption
            );
        });

        this.bot.on("document", (ctx) => {
            elizaLogger.log(
                "📎 Received document message:",
                ctx.message.document.file_name
            );
        });

        this.bot.catch((err, ctx) => {
            elizaLogger.error(
                `❌ TelegramArticleClient Error for ${ctx.updateType}:`,
                err
            );
            ctx.reply("An unexpected error occurred. Please try again later.");
        });
    }

    private setupShutdownHandlers(): void {
        const shutdownHandler = async (signal: string) => {
            elizaLogger.log(
                `⚠️ Received ${signal}. Shutting down TelegramArticleClient gracefully...`
            );
            try {
                await this.stop();
                elizaLogger.log("🛑 TelegramArticleClient stopped gracefully");
            } catch (error) {
                elizaLogger.error(
                    "❌ Error during TelegramArticleClient shutdown:",
                    error
                );
                throw error;
            }
        };

        process.once("SIGINT", () => shutdownHandler("SIGINT"));
        process.once("SIGTERM", () => shutdownHandler("SIGTERM"));
        process.once("SIGHUP", () => shutdownHandler("SIGHUP"));
    }

    public async stop(): Promise<void> {
        elizaLogger.log("Stopping TelegramArticleClient...");
        await this.bot.stop();
        elizaLogger.log("TelegramArticleClient stopped");
    }
}
