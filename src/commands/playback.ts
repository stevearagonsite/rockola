import {
  ActionRowBuilder,
  ComponentType,
  StringSelectMenuBuilder,
  type AutocompleteInteraction,
  type SendableChannels,
} from 'discord.js';
import { nowPlayingEmbed, trackLink } from '../discord/ui.js';
import { resolveQuery, toTrack, UnsupportedError } from '../sources/resolver.js';
import type { Track, TrackInfo } from '../sources/types.js';
import { searchYouTube } from '../sources/youtube.js';
import { log } from '../util/logger.js';
import { formatDuration, parseTime } from '../util/time.js';
import { activePlayer, checkDj, command, ES, fail, memberVoice, msg, reply } from './helpers.js';
import type { Command, Context } from './types.js';

function requester(ctx: Context) {
  return { id: ctx.interaction.user.id, name: ctx.interaction.member.displayName };
}

/** Connects (if needed), queues and reports. Shared by /play and /search. */
async function queueTracks(ctx: Context, infos: TrackInfo[], playlistName: string | undefined, next = false): Promise<void> {
  const channel = ctx.interaction.member.voice.channel;
  if (!channel) {
    await fail(ctx, 'error.notInVoice');
    return;
  }
  const player = ctx.manager.getOrCreate(ctx.interaction.guildId);
  if (ctx.interaction.channel?.isSendable()) player.textChannel = ctx.interaction.channel as SendableChannels;
  try {
    await player.connect(channel);
  } catch {
    await fail(ctx, 'error.connectFailed');
    return;
  }
  const tracks: Track[] = infos.map((i) => toTrack(i, requester(ctx)));
  const startedNow = await player.enqueue(tracks, next ? 1 : undefined);
  const first = tracks[0]!;
  if (playlistName && tracks.length > 1) {
    await reply(ctx, msg(ctx, 'play.addedList', { count: tracks.length, name: playlistName }));
  } else {
    const key = startedNow ? 'play.addedTrackNow' : 'play.addedTrack';
    await reply(ctx, msg(ctx, key, { title: trackLink(first), duration: formatDuration(first.durationMs) }));
  }
}

const play: Command = {
  data: command('play', 'Play a song or playlist (search, YouTube, Spotify or Suno link)', 'Reproducí una canción o lista (búsqueda, link de YouTube, Spotify o Suno)')
    .addStringOption((o) =>
      o
        .setName('query')
        .setNameLocalizations(ES('busqueda'))
        .setDescription('Search text or URL')
        .setDescriptionLocalizations(ES('Texto a buscar o link'))
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addBooleanOption((o) =>
      o.setName('next').setNameLocalizations(ES('siguiente')).setDescription('Put it next in the queue').setDescriptionLocalizations(ES('Ponerla primera en la cola')),
    )
    .toJSON(),
  async execute(ctx) {
    const channel = await memberVoice(ctx);
    if (!channel) return;
    const query = ctx.interaction.options.getString('query', true);
    const next = ctx.interaction.options.getBoolean('next') ?? false;
    await ctx.interaction.deferReply();
    let result;
    try {
      result = await resolveQuery(query);
    } catch (e) {
      log.warn(`resolve failed for "${query}":`, (e as Error).message);
      const reason = e instanceof UnsupportedError ? e.message : (e as Error).message.slice(0, 180);
      await reply(ctx, `❌ ${msg(ctx, 'error.loadFailed', { reason })}`);
      return;
    }
    if (result.tracks.length === 0) {
      await reply(ctx, `❌ ${msg(ctx, 'error.notFound', { query: query.slice(0, 100) })}`);
      return;
    }
    await queueTracks(ctx, result.tracks, result.playlistName, next);
  },
  async autocomplete(interaction: AutocompleteInteraction<'cached'>) {
    const text = interaction.options.getFocused().trim();
    if (text.length < 2 || /^https?:\/\//i.test(text)) {
      await interaction.respond(text ? [{ name: text.slice(0, 100), value: text.slice(0, 100) }] : []);
      return;
    }
    try {
      const res = await fetch(
        `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(text)}`,
        { signal: AbortSignal.timeout(2000) },
      );
      const [, suggestions] = (await res.json()) as [string, string[]];
      const list = [text, ...suggestions.filter((s) => s !== text)].slice(0, 10);
      await interaction.respond(list.map((s) => ({ name: s.slice(0, 100), value: s.slice(0, 100) })));
    } catch {
      await interaction.respond([{ name: text.slice(0, 100), value: text.slice(0, 100) }]).catch(() => undefined);
    }
  },
};

const search: Command = {
  data: command('search', 'Search YouTube and pick a result', 'Buscá en YouTube y elegí un resultado')
    .addStringOption((o) =>
      o.setName('query').setNameLocalizations(ES('busqueda')).setDescription('What to search').setDescriptionLocalizations(ES('Qué buscar')).setRequired(true),
    )
    .toJSON(),
  async execute(ctx) {
    const channel = await memberVoice(ctx);
    if (!channel) return;
    const query = ctx.interaction.options.getString('query', true);
    await ctx.interaction.deferReply();
    const results = await searchYouTube(query, 10).catch(() => []);
    if (results.length === 0) {
      await reply(ctx, `❌ ${msg(ctx, 'error.notFound', { query: query.slice(0, 100) })}`);
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rk:search:${ctx.interaction.id}`)
      .setPlaceholder(msg(ctx, 'search.placeholder'))
      .addOptions(
        results.map((r, i) => ({
          label: r.title.slice(0, 100),
          description: `${r.author} · ${formatDuration(r.durationMs)}`.slice(0, 100),
          value: String(i),
        })),
      );
    const message = await ctx.interaction.editReply({
      content: msg(ctx, 'search.pick', { query: query.slice(0, 100) }),
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
    try {
      const choice = await message.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === ctx.interaction.user.id,
        time: 60_000,
      });
      await choice.deferUpdate();
      const picked = results[Number(choice.values[0])];
      await ctx.interaction.editReply({ components: [] });
      if (picked) await queueTracks(ctx, [picked], undefined);
    } catch {
      await ctx.interaction.editReply({ content: msg(ctx, 'search.timeout'), components: [] }).catch(() => undefined);
    }
  },
};

const pause: Command = {
  data: command('pause', 'Pause the music', 'Pausá la música').toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    if (player.isPaused) return void (await fail(ctx, 'player.alreadyPaused'));
    player.pause();
    await player.refreshControls();
    await reply(ctx, msg(ctx, 'player.paused'));
  },
};

const resume: Command = {
  data: command('resume', 'Resume the music', 'Reanudá la música').toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    if (!player.isPaused) return void (await fail(ctx, 'player.notPaused'));
    player.resume();
    await player.refreshControls();
    await reply(ctx, msg(ctx, 'player.resumed'));
  },
};

const skip: Command = {
  data: command('skip', 'Skip the current song', 'Saltá la canción actual').toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    const title = player.queue.current ? trackLink(player.queue.current) : '';
    player.skip();
    await reply(ctx, msg(ctx, 'player.skipped', { title }));
  },
};

const previous: Command = {
  data: command('previous', 'Play the previous song again', 'Volvé a la canción anterior').toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    if (player.queue.history.length === 0) return void (await fail(ctx, 'player.noPrevious'));
    await ctx.interaction.deferReply();
    const prev = await player.previous();
    await reply(ctx, prev ? msg(ctx, 'player.previous', { title: trackLink(prev) }) : msg(ctx, 'player.noPrevious'));
  },
};

const stop: Command = {
  data: command('stop', 'Stop the music, clear the queue and leave', 'Pará la música, vaciá la cola y salí del canal').toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    await player.stop();
    await reply(ctx, msg(ctx, 'player.stopped'));
  },
};

const seek: Command = {
  data: command('seek', 'Jump to a time in the current song', 'Adelantá o atrasá la canción actual')
    .addStringOption((o) =>
      o.setName('time').setNameLocalizations(ES('tiempo')).setDescription('e.g. 90, 1:30, 1m30s').setDescriptionLocalizations(ES('ej. 90, 1:30, 1m30s')).setRequired(true),
    )
    .toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    const ms = parseTime(ctx.interaction.options.getString('time', true));
    const current = player.queue.current!;
    if (ms === null) return void (await fail(ctx, 'error.invalidTime'));
    if (!current.durationMs) return void (await fail(ctx, 'error.notSeekable'));
    const target = Math.min(ms, Math.max(0, current.durationMs - 1000));
    await ctx.interaction.deferReply();
    await player.seek(target);
    await reply(ctx, msg(ctx, 'seek.done', { time: formatDuration(target) }));
  },
};

const volume: Command = {
  data: command('volume', 'Show or change the volume', 'Mostrá o cambiá el volumen')
    .addIntegerOption((o) =>
      o.setName('level').setNameLocalizations(ES('nivel')).setDescription('0-200').setMinValue(0).setMaxValue(200),
    )
    .toJSON(),
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    const level = ctx.interaction.options.getInteger('level');
    if (level === null) return void (await reply(ctx, msg(ctx, 'volume.current', { volume: player.volume })));
    if (!(await checkDj(ctx))) return;
    player.setVolume(level);
    await reply(ctx, msg(ctx, 'volume.set', { volume: level }));
  },
};

const nowplaying: Command = {
  data: command('nowplaying', 'Show the current song', 'Mostrá la canción que está sonando').toJSON(),
  async execute(ctx) {
    const player = await activePlayer(ctx, false);
    if (!player) return;
    const embed = nowPlayingEmbed(ctx.locale, player.state(player.queue.current!), true);
    await ctx.interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export const playbackCommands: Command[] = [play, search, pause, resume, skip, previous, stop, seek, volume, nowplaying];
