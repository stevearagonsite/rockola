import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { t, type Locale } from '../i18n/index.js';
import { FILTER_LABELS, type FilterName } from '../player/filters.js';
import type { LoopMode } from '../player/queue.js';
import type { Track } from '../sources/types.js';
import { formatDuration, progressBar } from '../util/time.js';

export const BRAND_COLOR = 0xe8590c;

export const BUTTON_IDS = {
  pause: 'rk:pause',
  skip: 'rk:skip',
  stop: 'rk:stop',
  loop: 'rk:loop',
} as const;

const SOURCE_LABEL: Record<Track['source'], string> = {
  youtube: 'YouTube',
  spotify: 'Spotify → YouTube',
  suno: 'Suno',
  url: 'Web',
};

export function trackLink(track: Track, max = 80): string {
  const title = track.title.length > max ? `${track.title.slice(0, max - 1)}…` : track.title;
  const safe = title.replace(/([[\]*_~`|])/g, '\\$1');
  // the URL comes from extractors: only real web links, and no ")" that would end the markdown link
  if (!/^https?:\/\//i.test(track.url)) return safe;
  return `[${safe}](${track.url.replace(/[()<>\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)})`;
}

export function loopName(locale: Locale, loop: LoopMode): string {
  return t(locale, `loopName.${loop}`);
}

export function filtersText(locale: Locale, filters: readonly FilterName[]): string {
  return filters.length ? filters.map((f) => FILTER_LABELS[f]).join(', ') : t(locale, 'np.none');
}

export interface NowPlayingState {
  track: Track;
  positionMs: number;
  volume: number;
  loop: LoopMode;
  filters: readonly FilterName[];
  autoplay: boolean;
  paused: boolean;
}

export function nowPlayingEmbed(locale: Locale, s: NowPlayingState, withProgress: boolean): EmbedBuilder {
  const { track } = s;
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setAuthor({ name: `${s.paused ? '⏸️' : '🎶'} ${t(locale, 'np.title')}` })
    .setDescription(
      `**${trackLink(track)}**${track.author ? `\n${track.author}` : ''}` +
        (withProgress
          ? `\n\n${progressBar(s.positionMs, track.durationMs)}\n\`${formatDuration(s.positionMs)} / ${formatDuration(track.durationMs)}\``
          : ''),
    )
    .addFields(
      { name: t(locale, 'np.duration'), value: formatDuration(track.durationMs), inline: true },
      { name: t(locale, 'np.requestedBy'), value: `<@${track.requester.id}>`, inline: true },
      { name: t(locale, 'np.source'), value: SOURCE_LABEL[track.source], inline: true },
      { name: t(locale, 'np.volume'), value: `${s.volume}%`, inline: true },
      { name: t(locale, 'np.loop'), value: loopName(locale, s.loop), inline: true },
      { name: t(locale, 'np.filters'), value: filtersText(locale, s.filters), inline: true },
    );
  if (track.thumbnail) embed.setThumbnail(track.thumbnail);
  return embed;
}

export function controlsRow(paused: boolean, loop: LoopMode): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_IDS.pause).setEmoji(paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BUTTON_IDS.skip).setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(BUTTON_IDS.stop).setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(BUTTON_IDS.loop)
      .setEmoji(loop === 'track' ? '🔂' : '🔁')
      .setStyle(loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
  );
}

export function infoEmbed(text: string): EmbedBuilder {
  return new EmbedBuilder().setColor(BRAND_COLOR).setDescription(text);
}
