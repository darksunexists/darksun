import {
  startAgent,
  loadCharacters,
  loadCharacterFromOnchain,
} from '../helpers.ts';
import { elizaLogger } from '@elizaos/core';
import type { Character } from '@elizaos/core';
import { DEFAULT_OPTIONS } from './default.ts';
import { InvestigateClient } from '@elizaos/client-investigate';

interface InvestigateStartArgs {
  characters?: string;
  port?: number;
  withTwitter?: boolean;
  useIqRPC?: boolean;
}

export async function start(args: InvestigateStartArgs) {
  try {
    elizaLogger.debug('Initializing InvestigateClient...');
    const investigateClient = new InvestigateClient({
      withTwitter: args.withTwitter ?? false,
      useIqRPC: args.useIqRPC ?? false,
    });
    elizaLogger.debug('InvestigateClient initialized successfully');

    if (!args.characters) {
      throw new Error('No characters specified for investigate-api mode.');
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
      throw new Error('No characters found to load for investigate-api mode.');
    }

    elizaLogger.info(`Starting ${characters.length} agent(s)...`);
    for (const character of characters) {
      elizaLogger.debug(`Starting agent: ${character.name}`);
      await startAgent(character, investigateClient, DEFAULT_OPTIONS);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));

    investigateClient.start(args.port || 3010);
    elizaLogger.info('investigate-api mode is now running...');
  } catch (error) {
    elizaLogger.error('Error in investigate-api mode:', error);
    throw error;
  }
}
