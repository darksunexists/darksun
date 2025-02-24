/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import yargs from 'yargs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import {
  ICacheManager,
  AgentRuntime,
  Character,
  IAgentRuntime,
  ModelProviderName,
  elizaLogger,
  settings,
  IDatabaseAdapter,
  validateCharacterConfig,
  stringToUuid,
  CacheManager,
  IDatabaseCacheAdapter,
  DbCacheAdapter,
  Clients,
  Evaluator,
  Provider,
  Plugin,
  Action,
  Service,
  IMemoryManager,
  MemoryManager,
  CacheStore,
  FsCacheAdapter,
  Client,
} from '@elizaos/core';

import Database from 'better-sqlite3';
import { PostgresDatabaseAdapter } from '@elizaos/adapter-postgres';
import { SqliteDatabaseAdapter } from '@elizaos/adapter-sqlite';
import { RedisClient } from '@elizaos/adapter-redis';

import { TelegramClientInterface } from '@elizaos/client-telegram';
import { TwitterClientInterface } from '@elizaos/client-twitter-v2';
import { DirectClient } from '@elizaos/client-direct';
import { BackroomClient } from '@elizaos/client-backroom';
import { InvestigateClient } from '@elizaos/client-investigate';

import { bootstrapPlugin } from '@elizaos/plugin-bootstrap';
import researchPlugin from '@elizaos/plugin-research';
import { onchainJson } from '@elizaos/plugin-iq6900';
import { ImageDescriptionService } from '@elizaos/plugin-image-description';

export type AgentOptions = {
  evaluators?: Evaluator[];
  providers?: Provider[];
  plugins?: Plugin[];
  actions?: Action[];
  services?: Service[];
  managers?: IMemoryManager[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rlDefault = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rlDefault.on('SIGINT', () => {
  rlDefault.close();
  process.exit(0);
});

/**
 * Helper function to parse CLI arguments with Yargs.
 */
export function parseArguments(): {
  character?: string;
  characters?: string;
} {
  try {
    return yargs(process.argv.slice(2))
      .option('character', {
        type: 'string',
        description: 'Path to the character JSON file',
      })
      .option('characters', {
        type: 'string',
        description: 'Comma separated list of paths to character JSON files',
      })
      .parseSync();
  } catch (error) {
    elizaLogger.error('Error parsing arguments:', error);
    return {};
  }
}

function isAllStrings(arr: unknown[]): boolean {
  return Array.isArray(arr) && arr.every((item) => typeof item === 'string');
}

/**
 * Loads a character from on-chain JSON (via `@elizaos/plugin-iq6900`).
 */
export async function loadCharacterFromOnchain(): Promise<Character[]> {
  if (onchainJson === 'null') return [];
  try {
    const parsedChar = JSON.parse(onchainJson);
    validateCharacterConfig(parsedChar);

    // Attempt to inject environment-based secrets matching a prefix
    // if character has an .id, we can build a prefix from it
    const charId = parsedChar.id || parsedChar.name;
    const characterPrefix = `CHARACTER.${charId.toUpperCase().replace(/ /g, '_')}.`;
    const characterSettings = Object.entries(process.env)
      .filter(([key]) => key.startsWith(characterPrefix))
      .reduce((acc, [key, value]) => {
        const settingKey = key.slice(characterPrefix.length);
        return { ...acc, [settingKey]: value };
      }, {});

    if (Object.keys(characterSettings).length > 0) {
      parsedChar.settings = parsedChar.settings || {};
      parsedChar.settings.secrets = {
        ...parsedChar.settings.secrets,
        ...characterSettings,
      };
    }

    // Load plugins if needed
    if (isAllStrings(parsedChar.plugins)) {
      const importedPlugins = await Promise.all(
        parsedChar.plugins.map(async (pluginPath: string) => {
          const imported = await import(pluginPath);
          return imported.default || imported;
        }),
      );
      parsedChar.plugins = importedPlugins;
    }

    elizaLogger.info(`Loaded on-chain character: ${parsedChar.name}`);
    return [parsedChar];
  } catch (err) {
    elizaLogger.error(`Error parsing on-chain character:`, err);
    return [];
  }
}

/**
 * Loads one or more local character definitions from .ts or .json paths.
 */
export async function loadCharacters(
  charactersArg: string,
): Promise<Character[]> {
  const characterPaths = charactersArg
    .split(',')
    .map((filePath) => path.resolve(process.cwd(), filePath.trim()));

  const loadedCharacters: Character[] = [];

  for (const filePath of characterPaths) {
    try {
      let character: Character;
      if (filePath.endsWith('.ts')) {
        const mod = await import(filePath);
        if (!mod.character) {
          throw new Error(
            `File "${filePath}" does not export a 'character' property.`,
          );
        }
        character = mod.character;
      } else {
        // JSON file
        const raw = fs.readFileSync(filePath, 'utf8');
        character = JSON.parse(raw);
      }

      validateCharacterConfig(character);

      // Handle potential string-based plugin references
      if (character.plugins) {
        const importedPlugins = await Promise.all(
          character.plugins.map(async (plugin: any) => {
            if (typeof plugin === 'object' && plugin !== null) {
              // Already loaded
              return plugin;
            }
            if (typeof plugin === 'string') {
              const imported = await import(plugin);
              return imported.default || imported;
            }
            throw new Error(
              `Invalid plugin type in character "${character.name}": ${plugin}`,
            );
          }),
        );
        character.plugins = importedPlugins;
      }

      elizaLogger.log(`Loaded character: ${character.name} from "${filePath}"`);
      loadedCharacters.push(character);
    } catch (err) {
      elizaLogger.error(`Failed to load character from "${filePath}":`, err);
      process.exit(1);
    }
  }

  if (loadedCharacters.length === 0) {
    elizaLogger.warn('No characters were loaded.');
  }
  return loadedCharacters;
}

/**
 * Returns a provider-specific API key from a Character's secrets or fallback to environment.
 */
export function getTokenForProvider(
  provider: ModelProviderName,
  character: Character,
): string {
  switch (provider) {
    case ModelProviderName.LLAMALOCAL:
    case ModelProviderName.OLLAMA:
    case ModelProviderName.GAIANET:
      return '';
    case ModelProviderName.OPENAI:
      return (
        character.settings?.secrets?.OPENAI_API_KEY || settings.OPENAI_API_KEY
      );
    case ModelProviderName.ETERNALAI:
      return (
        character.settings?.secrets?.ETERNALAI_API_KEY ||
        settings.ETERNALAI_API_KEY
      );
    case ModelProviderName.LLAMACLOUD:
    case ModelProviderName.TOGETHER:
      return (
        character.settings?.secrets?.LLAMACLOUD_API_KEY ||
        settings.LLAMACLOUD_API_KEY ||
        character.settings?.secrets?.TOGETHER_API_KEY ||
        settings.TOGETHER_API_KEY ||
        character.settings?.secrets?.XAI_API_KEY ||
        settings.XAI_API_KEY ||
        character.settings?.secrets?.OPENAI_API_KEY ||
        settings.OPENAI_API_KEY
      );
    case ModelProviderName.ANTHROPIC:
    case ModelProviderName.CLAUDE_VERTEX:
      return (
        character.settings?.secrets?.ANTHROPIC_API_KEY ||
        character.settings?.secrets?.CLAUDE_API_KEY ||
        settings.ANTHROPIC_API_KEY ||
        settings.CLAUDE_API_KEY
      );
    case ModelProviderName.REDPILL:
      return (
        character.settings?.secrets?.REDPILL_API_KEY || settings.REDPILL_API_KEY
      );
    case ModelProviderName.OPENROUTER:
      return (
        character.settings?.secrets?.OPENROUTER || settings.OPENROUTER_API_KEY
      );
    case ModelProviderName.GROK:
      return character.settings?.secrets?.GROK_API_KEY || settings.GROK_API_KEY;
    case ModelProviderName.HEURIST:
      return (
        character.settings?.secrets?.HEURIST_API_KEY || settings.HEURIST_API_KEY
      );
    case ModelProviderName.GROQ:
      return character.settings?.secrets?.GROQ_API_KEY || settings.GROQ_API_KEY;
    case ModelProviderName.GALADRIEL:
      return (
        character.settings?.secrets?.GALADRIEL_API_KEY ||
        settings.GALADRIEL_API_KEY
      );
    case ModelProviderName.FAL:
      return character.settings?.secrets?.FAL_API_KEY || settings.FAL_API_KEY;
    case ModelProviderName.ALI_BAILIAN:
      return (
        character.settings?.secrets?.ALI_BAILIAN_API_KEY ||
        settings.ALI_BAILIAN_API_KEY
      );
    case ModelProviderName.VOLENGINE:
      return (
        character.settings?.secrets?.VOLENGINE_API_KEY ||
        settings.VOLENGINE_API_KEY
      );
    case ModelProviderName.NANOGPT:
      return (
        character.settings?.secrets?.NANOGPT_API_KEY || settings.NANOGPT_API_KEY
      );
    case ModelProviderName.HYPERBOLIC:
      return (
        character.settings?.secrets?.HYPERBOLIC_API_KEY ||
        settings.HYPERBOLIC_API_KEY
      );
    case ModelProviderName.VENICE:
      return (
        character.settings?.secrets?.VENICE_API_KEY || settings.VENICE_API_KEY
      );
    case ModelProviderName.AKASH_CHAT_API:
      return (
        character.settings?.secrets?.AKASH_CHAT_API_KEY ||
        settings.AKASH_CHAT_API_KEY
      );
    case ModelProviderName.GOOGLE:
      return (
        character.settings?.secrets?.GOOGLE_GENERATIVE_AI_API_KEY ||
        settings.GOOGLE_GENERATIVE_AI_API_KEY
      );
    default:
      const message = `Unsupported model provider: ${provider}`;
      elizaLogger.error(message);
      throw new Error(message);
  }
}

/**
 * Initialize any necessary external chat clients for a given character: Telegram, Twitter, etc.
 */
export async function initializeClients(
  character: Character,
  runtime: IAgentRuntime,
  enabledClients?: Clients[],
): Promise<Record<string, any>> {
  const clients: Record<string, any> = {};

  // If the character wants Telegram
  if (enabledClients?.includes(Clients.TELEGRAM)) {
    const telegramClient = await TelegramClientInterface.start(runtime);
    if (telegramClient) {
      clients.telegram = telegramClient;
    }
  }

  // If the character wants Twitter
  if (enabledClients?.includes(Clients.TWITTER)) {
    const twitterClient = await TwitterClientInterface.start(runtime);
    if (twitterClient) {
      clients.twitter = twitterClient;
    }
  }

  // If the character’s plugin includes additional client(s)
  if (Array.isArray(character.plugins)) {
    for (const plugin of character.plugins) {
      if (plugin.clients) {
        for (const pluginClient of plugin.clients) {
          const startedClient = await pluginClient.start(runtime);
          const typeName = deriveClientType(pluginClient);
          clients[typeName] = startedClient;
        }
      }
    }
  }

  return clients;
}

/**
 * Attempt to name a plugin-based client in a stable manner
 */
function deriveClientType(client: Client): string {
  if ('type' in client) {
    // If the client object includes a `.type` property
    return (client as any).type;
  }
  const constructorName = client.constructor?.name;
  if (constructorName && !constructorName.includes('Object')) {
    return constructorName.toLowerCase().replace('client', '');
  }
  return `client_${Date.now()}`;
}

/**
 * Create the agent's runtime object with default or user-specified sets of plugins, providers, etc.
 */
export function createAgent(
  character: Character,
  db: IDatabaseAdapter,
  cache: ICacheManager,
  token: string,
  options?: AgentOptions,
): AgentRuntime {
  elizaLogger.success('Creating runtime for character:', character.name);

  return new AgentRuntime({
    databaseAdapter: db,
    token,
    modelProvider: character.modelProvider,
    evaluators: options?.evaluators || [],
    character,
    plugins: [bootstrapPlugin, ...(options?.plugins || [])],
    providers: options?.providers || [],
    actions: options?.actions || [],
    services: options?.services || [],
    managers: options?.managers || [],
    cacheManager: cache,
    conversationLength: 7,
  });
}

/**
 * Start a conversation agent with the given client (Direct, Backroom, Investigate, etc.).
 */
export async function startAgent(
  character: Character,
  client: DirectClient | BackroomClient | InvestigateClient,
  options: AgentOptions,
): Promise<IAgentRuntime> {
  let db: (IDatabaseAdapter & IDatabaseCacheAdapter) | undefined;

  try {
    // Ensure we have an .id
    character.id = character.id || stringToUuid(character.name);
    character.username = character.username || character.name;

    // Acquire token for chosen model provider
    const token = getTokenForProvider(character.modelProvider, character);
    elizaLogger.info(`Token for ${character.name}: [REDACTED]`);

    // Initialize database
    const dataDir = path.join(__dirname, '../data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    db = initializeDatabase(dataDir) as IDatabaseAdapter &
      IDatabaseCacheAdapter;
    await db.init();

    // Initialize cache
    const cache = initializeCache(
      process.env.CACHE_STORE ?? CacheStore.DATABASE,
      character,
      dataDir,
      db,
    );

    // If the character is an "investigator" or "backroom" agent, add relevant memory managers
    const lowerName = character.name.toLowerCase();
    const specialAgents = [
      'darksun-investigator',
      'holmes-iv',
      'metadata-analyzer',
      'darksun-articles',
    ];
    const needsExtraMemory = specialAgents.includes(lowerName);
    if (needsExtraMemory) {
      if (!options.services) {
        options.services = [];
      }
      // For example, add ImageDescriptionService for Darksun-Investigator
      if (lowerName === 'darksun-investigator') {
        options.services.push(new ImageDescriptionService());
      }
    }

    // Create the agent runtime
    const runtime = createAgent(character, db, cache, token, options);

    // Register specialized memory managers for these special agents
    if (needsExtraMemory) {
      const tableNames = ['investigations', 'backroom', 'metadata', 'articles'];
      tableNames.forEach((name) => {
        runtime.registerMemoryManager(
          new MemoryManager({
            tableName: name,
            runtime,
          }),
        );
      });
    }

    await runtime.initialize();

    // Start any relevant chat clients (telegram/twitter etc.)
    runtime.clients = await initializeClients(
      character,
      runtime,
      character.clients,
    );

    // Finally, attach to the given client
    client.registerAgent(runtime);
    elizaLogger.debug(
      `Started agent [${character.name}] as: ${runtime.agentId}`,
    );
    return runtime;
  } catch (error) {
    elizaLogger.error(`Error starting agent for [${character.name}]:`, error);
    if (db) {
      await db.close();
    }
    throw error;
  }
}

/**
 * Helper function to read user input from console, mainly for local debugging.
 */
export async function handleUserInput(input: string, agentId: string) {
  if (input.toLowerCase() === 'exit') {
    rlDefault.close();
    process.exit(0);
    return;
  }

  try {
    const serverPort = parseInt(settings.SERVER_PORT || '3000', 10);
    const response = await fetch(
      `http://localhost:${serverPort}/${agentId}/message`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: input,
          userId: 'user',
          userName: 'User',
        }),
      },
    );

    const data = await response.json();
    data.forEach((message: any) => {
      console.log(`Agent: ${message.text}`);
    });
  } catch (err) {
    elizaLogger.error('Error fetching agent response:', err);
  }
}

/**
 * Initialize the database adapter. Tries Postgres if POSTGRES_URL is set; otherwise, uses SQLite.
 */
export function initializeDatabase(dataDir: string): IDatabaseAdapter {
  if (process.env.POSTGRES_URL) {
    elizaLogger.info('Initializing PostgreSQL connection...');
    const pgAdapter = new PostgresDatabaseAdapter({
      connectionString: process.env.POSTGRES_URL,
      parseInputs: true,
    });
    // Test the connection
    pgAdapter
      .init()
      .then(() => {
        elizaLogger.success('Successfully connected to PostgreSQL');
      })
      .catch((error) => {
        elizaLogger.error('Failed to connect to PostgreSQL:', error);
      });
    return pgAdapter;
  }

  const dbFile = process.env.SQLITE_FILE || path.resolve(dataDir, 'db.sqlite');
  elizaLogger.info(`Using SQLite file: ${dbFile}`);
  return new SqliteDatabaseAdapter(new Database(dbFile));
}

/**
 * Decides which cache store to use based on env or config, then returns the appropriate CacheManager instance.
 */
export function initializeCache(
  cacheStore: string,
  character: Character,
  baseDir: string,
  db?: IDatabaseCacheAdapter,
): ICacheManager {
  switch (cacheStore) {
    case CacheStore.REDIS: {
      if (!process.env.REDIS_URL) {
        throw new Error('REDIS_URL is not set, but CACHE_STORE=REDIS.');
      }
      elizaLogger.info('Using Redis cache...');
      const redisClient = new RedisClient(process.env.REDIS_URL);
      if (!character.id) {
        throw new Error('CacheStore.REDIS requires character.id to be set.');
      }
      return new CacheManager(new DbCacheAdapter(redisClient, character.id));
    }
    case CacheStore.DATABASE: {
      elizaLogger.info('Using Database cache...');
      if (!db) {
        throw new Error(
          'Database adapter not provided for CacheStore.DATABASE.',
        );
      }
      return new CacheManager(new DbCacheAdapter(db, character.id!));
    }
    case CacheStore.FILESYSTEM: {
      elizaLogger.info('Using FileSystem cache...');
      if (!character.id) {
        throw new Error(
          'CacheStore.FILESYSTEM requires character.id to be set.',
        );
      }
      const cacheDir = path.resolve(baseDir, character.id, 'cache');
      return new CacheManager(new FsCacheAdapter(cacheDir));
    }
    default: {
      throw new Error(`Invalid CACHE_STORE: ${cacheStore}`);
    }
  }
}
