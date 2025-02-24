import { elizaLogger, parseBooleanFromText } from '@elizaos/core';
import yargs from 'yargs';
import { ErrorLogger } from './utils/errorLogger.ts';

const VALID_MODES = [
  'backroom-api',
  'darksun-twitter',
  'investigate-api',
] as const;
type Mode = (typeof VALID_MODES)[number];

class AgentRunner {
  private mode: Mode;
  private characterPath?: string;
  private characterPaths?: string;
  private withTwitter?: boolean;
  private useIqRPC?: boolean;

  constructor() {
    // Parse command line arguments
    const args = yargs(process.argv.slice(2))
      .option('mode', {
        alias: 'm',
        type: 'string',
        description:
          'Operation mode: backroom-api, darksun-twitter, or investigate-api',
        choices: VALID_MODES,
      })
      .option('characters', {
        type: 'string',
        description: 'Comma-separated paths to character files',
      })
      .option('withTwitter', {
        type: 'boolean',
        description: 'Whether to use Twitter',
      })
      .option('useIqRPC', {
        type: 'boolean',
        description: 'Whether to use IQ RPC',
      })
      .help()
      .parseSync();

    const mode = (args.mode || process.env.AGENT_MODE) as Mode;
    if (!mode || !VALID_MODES.includes(mode)) {
      throw new Error(
        `Invalid mode: ${mode}. Must be one of: ${VALID_MODES.join(', ')}.
Provide via --mode flag or AGENT_MODE environment variable.`,
      );
    }

    elizaLogger.info('CLI arguments:', args);

    this.mode = mode;
    this.characterPaths = args.characters || process.env.CHARACTER_PATHS;
    this.withTwitter = args.withTwitter || false;
    this.useIqRPC = args.useIqRPC || false;

    // Validate we have at least one character file
    if (!this.characterPaths) {
      throw new Error(
        'No character configuration provided. Use --characters or set CHARACTER_PATHS.',
      );
    }

    // Initialize Telegram-based error logging if configured
    if (
      process.env.TELEGRAM_ERROR_BOT_TOKEN &&
      process.env.TELEGRAM_ERROR_CHAT_ID
    ) {
      ErrorLogger.initialize({
        botToken: process.env.TELEGRAM_ERROR_BOT_TOKEN,
        chatId: process.env.TELEGRAM_ERROR_CHAT_ID,
      });
    } else {
      elizaLogger.warn(
        'Telegram error logging is not configured. ' +
          'Set TELEGRAM_ERROR_BOT_TOKEN and TELEGRAM_ERROR_CHAT_ID to enable.',
      );
      // Remove `process.exit(1)` if you do not want to force-exit when logging is not configured
      // process.exit(1);
    }
  }

  async start() {
    try {
      elizaLogger.info(`Starting in ${this.mode} mode`);
      elizaLogger.info(`Using character path(s): ${this.characterPaths}`);

      switch (this.mode) {
        case 'darksun-twitter': {
          // Basic Twitter mode
          elizaLogger.info('Starting darksun-twitter mode');
          const { start: startDarksunTwitter } = await import(
            './modes/default.ts'
          );
          await startDarksunTwitter({
            characters: this.characterPaths,
          });
          break;
        }
        case 'backroom-api': {
          elizaLogger.info('Starting backroom-api mode');
          const { start: startBackroomApi } = await import(
            './modes/backroom-api.ts'
          );
          await startBackroomApi({
            characters: this.characterPaths,
            withTwitter: this.withTwitter,
            useIqRPC: this.useIqRPC,
          });
          break;
        }
        case 'investigate-api': {
          elizaLogger.info('Starting investigate-api mode');
          const { start: startInvestigateApi } = await import(
            './modes/investigate-api.ts'
          );
          await startInvestigateApi({
            characters: this.characterPaths,
            withTwitter: this.withTwitter,
            useIqRPC: this.useIqRPC,
          });
          break;
        }
        default: {
          throw new Error(`Unsupported mode: ${this.mode}`);
        }
      }
    } catch (error) {
      elizaLogger.error(`Failed to start ${this.mode} mode:`, error);
      // Optionally log to Telegram if set up
      await ErrorLogger.logError(error as Error, `${this.mode} mode`);
      process.exit(1);
    }
  }
}

new AgentRunner().start().catch(async (error) => {
  elizaLogger.error('Unhandled error:', error);
  await ErrorLogger.logError(error as Error, 'main');
  process.exit(1);
});

// Handle uncaught/unhandled if PREVENT_UNHANDLED_EXIT is set
if (
  process.env.PREVENT_UNHANDLED_EXIT &&
  parseBooleanFromText(process.env.PREVENT_UNHANDLED_EXIT)
) {
  process.on('uncaughtException', (err) => {
    elizaLogger.error('uncaughtException', err);
  });
  process.on('unhandledRejection', (err) => {
    elizaLogger.error('unhandledRejection', err);
  });
}
