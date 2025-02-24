import { DirectClient } from '@elizaos/client-direct';
import { startAgent, loadCharacters, AgentOptions } from '../helpers.ts';
import { elizaLogger } from '@elizaos/core';
import type { Character } from '@elizaos/core';

export const DEFAULT_OPTIONS: AgentOptions = {
  services: [],
  plugins: [],
  evaluators: [],
  actions: [],
  managers: [],
  providers: [],
};

export async function start(args: { characters?: string }) {
  try {
    elizaLogger.debug('Initializing DirectClient...');
    const directClient = new DirectClient();
    elizaLogger.debug('DirectClient initialized successfully');

    if (!args.characters) {
      elizaLogger.warn('No characters specified. Exiting default mode.');
      return;
    }

    elizaLogger.info('Loading characters...', {
      charactersArg: args.characters,
    });
    const characters: Character[] = await loadCharacters(args.characters);
    if (characters.length === 0) {
      elizaLogger.warn('No characters loaded for default mode.');
      return;
    }

    elizaLogger.info(`Starting ${characters.length} agent(s)...`);
    for (const character of characters) {
      elizaLogger.debug(`Starting agent: ${character.name}`);
      await startAgent(character, directClient, DEFAULT_OPTIONS);
    }

    elizaLogger.info('darksun-twitter (default) mode started successfully.');
  } catch (error) {
    elizaLogger.error('Failed to start default (darksun-twitter) mode:', error);
    throw error;
  }
}
