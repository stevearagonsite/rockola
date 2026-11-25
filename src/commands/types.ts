import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { Config } from '../config.js';
import type { SettingsStore } from '../db/settings.js';
import type { Locale } from '../i18n/index.js';
import type { PlayerManager } from '../player/manager.js';

export interface Context {
  interaction: ChatInputCommandInteraction<'cached'>;
  manager: PlayerManager;
  settings: SettingsStore;
  config: Config;
  locale: Locale;
}

export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** Needs the DJ role (when one is configured). */
  dj?: boolean;
  execute(ctx: Context): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction<'cached'>): Promise<void>;
}
