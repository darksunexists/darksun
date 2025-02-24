import {
  startAgent,
  loadCharacters,
  loadCharacterFromOnchain,
} from '../helpers.ts';
import { elizaLogger } from '@elizaos/core';
import type { Character } from '@elizaos/core';
import { BackroomClient } from '@elizaos/client-backroom';
import { DEFAULT_OPTIONS } from './default.ts';

interface BackroomStartArgs {
  characters?: string;
  port?: number;
  withTwitter?: boolean;
  useIqRPC?: boolean;
}

export async function start(args: BackroomStartArgs) {
  try {
    elizaLogger.debug('Initializing BackroomClient...');
    const backroomClient = new BackroomClient({
      withTwitter: args.withTwitter ?? false,
      useIqRPC: args.useIqRPC ?? false,
    });
    elizaLogger.debug('BackroomClient initialized successfully');

    if (!args.characters) {
      throw new Error('No characters specified for backroom-api mode.');
    }

    let characters: Character[] = [];
    let combinedCharactersArg = args.characters.concat(
      ',agents/src/characters/darksun-backroom-investigate.ts',
      ',agents/src/characters/metadata-analyzer.ts',
      ',agents/src/characters/darksun-articles.ts',
    );

    elizaLogger.info('Loading characters...', { combinedCharactersArg });
    characters = await loadCharacters(combinedCharactersArg);

    if (process.env.IQ_LOAD_CHARACTER === 'true') {
      elizaLogger.info('Loading on-chain characters...');
      const onchainCharacters = await loadCharacterFromOnchain();
      characters = characters.concat(onchainCharacters);
    }

    if (characters.length === 0) {
      throw new Error('No characters found to load for backroom-api mode.');
    }

    // Start the agent(s)
    elizaLogger.info(`Starting ${characters.length} agent(s)...`);
    for (const character of characters) {
      elizaLogger.debug(`Starting agent: ${character.name}`);
      await startAgent(character, backroomClient, DEFAULT_OPTIONS);
    }

    // Wait briefly for registration
    await new Promise((resolve) => setTimeout(resolve, 1000));

    backroomClient.start(args.port || 3006);
    elizaLogger.info('backroom-api mode is now running...');
  } catch (error) {
    elizaLogger.error('Error in backroom-api mode:', error);
    throw error;
  }
}
