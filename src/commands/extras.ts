import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { BRAND_COLOR } from '../discord/ui.js';
import { isLocale, t } from '../i18n/index.js';
import { FILTER_LABELS, FILTER_NAMES, isFilterName, toggleFilter } from '../player/filters.js';
import { cleanTitle, findLyrics } from '../sources/lyrics.js';
import { activePlayer, command, ES, memberVoice, msg, reply } from './helpers.js';
import type { Command } from './types.js';

export const REPO_URL = 'https://github.com/stevearagonsite/rockola';

const filters: Command = {
  data: command('filters', 'Toggle an audio filter', 'Activá o desactivá un filtro de audio')
    .addStringOption((o) =>
      o
        .setName('filter')
        .setNameLocalizations(ES('filtro'))
        .setDescription('Filter to toggle')
        .setDescriptionLocalizations(ES('Filtro a activar/desactivar'))
        .setRequired(true)
        .addChoices(
          ...FILTER_NAMES.map((f) => ({ name: FILTER_LABELS[f], value: f })),
          { name: 'off', value: 'off', name_localizations: ES('desactivar todos') },
        ),
    )
    .toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    const choice = ctx.interaction.options.getString('filter', true);
    const next = choice === 'off' || !isFilterName(choice) ? [] : toggleFilter(player.filters, choice);
    await ctx.interaction.deferReply();
    await player.setFilters(next);
    await reply(
      ctx,
      next.length ? msg(ctx, 'filters.set', { filters: next.map((f) => FILTER_LABELS[f]).join(', ') }) : msg(ctx, 'filters.off'),
    );
  },
};

const autoplay: Command = {
  data: command('autoplay', 'Keep playing similar songs when the queue ends', 'Seguí con canciones parecidas cuando termine la cola').toJSON(),
  dj: true,
  async execute(ctx) {
    const guildId = ctx.interaction.guildId;
    const value = !ctx.settings.get(guildId).autoplay;
    ctx.settings.update(guildId, { autoplay: value });
    const player = ctx.manager.get(guildId);
    if (player) player.autoplay = value;
    await reply(ctx, msg(ctx, value ? 'autoplay.on' : 'autoplay.off'));
  },
};

const stay: Command = {
  data: command('247', 'Stay in the voice channel 24/7', 'Quedate en el canal de voz 24/7').toJSON(),
  dj: true,
  async execute(ctx) {
    const guildId = ctx.interaction.guildId;
    const value = !ctx.settings.get(guildId).stay247;
    let channelId: string | null = null;
    if (value) {
      const channel = await memberVoice(ctx);
      if (!channel) return;
      const player = ctx.manager.getOrCreate(guildId);
      player.stay247 = true;
      if (ctx.interaction.channel?.isSendable()) player.textChannel ??= ctx.interaction.channel;
      await player.connect(channel).catch(() => undefined);
      player.clearIdleTimer();
      channelId = channel.id;
    } else {
      const player = ctx.manager.get(guildId);
      if (player) {
        player.stay247 = false;
        if (!player.queue.current) player.startIdleTimer();
      }
    }
    ctx.settings.update(guildId, { stay247: value, stayChannelId: channelId });
    await reply(ctx, msg(ctx, value ? 'stay.on' : 'stay.off'));
  },
};

const lyrics: Command = {
  data: command('lyrics', 'Show the lyrics of the current (or another) song', 'Mostrá la letra de la canción actual (u otra)')
    .addStringOption((o) =>
      o.setName('query').setNameLocalizations(ES('busqueda')).setDescription('Song and artist').setDescriptionLocalizations(ES('Canción y artista')),
    )
    .toJSON(),
  async execute(ctx) {
    const current = ctx.manager.get(ctx.interaction.guildId)?.queue.current;
    const given = ctx.interaction.options.getString('query');
    const query = given ?? (current ? cleanTitle(`${current.source === 'youtube' ? '' : current.author} ${current.title}`) : null);
    if (!query) return void (await reply(ctx, `❌ ${msg(ctx, 'lyrics.needQuery')}`, true));
    await ctx.interaction.deferReply();
    const found = await findLyrics(query).catch(() => null);
    if (!found?.text) return void (await reply(ctx, `❌ ${msg(ctx, 'lyrics.notFound', { query: query.slice(0, 100) })}`));
    const text = found.text.length > 4000 ? `${found.text.slice(0, 3990)}\n…` : found.text;
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(`${found.title}${found.artist ? ` · ${found.artist}` : ''}`.slice(0, 256))
      .setDescription(text)
      .setFooter({ text: msg(ctx, 'lyrics.footer') });
    await ctx.interaction.editReply({ embeds: [embed] });
  },
};

const settings: Command = {
  data: command('settings', 'Server settings for Rockola', 'Configuración de Rockola en este servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName('language')
        .setNameLocalizations(ES('idioma'))
        .setDescription('Bot language')
        .setDescriptionLocalizations(ES('Idioma del bot'))
        .addChoices({ name: 'Español', value: 'es' }, { name: 'English', value: 'en' }),
    )
    .addIntegerOption((o) =>
      o
        .setName('volume')
        .setNameLocalizations(ES('volumen'))
        .setDescription('Default volume (0-200)')
        .setDescriptionLocalizations(ES('Volumen por defecto (0-200)'))
        .setMinValue(0)
        .setMaxValue(200),
    )
    .addRoleOption((o) =>
      o.setName('dj_role').setNameLocalizations(ES('rol_dj')).setDescription('Role allowed to control playback').setDescriptionLocalizations(ES('Rol que puede controlar la música')),
    )
    .addChannelOption((o) =>
      o
        .setName('music_channel')
        .setNameLocalizations(ES('canal_musica'))
        .setDescription('Only text channel for commands and notifications')
        .setDescriptionLocalizations(ES('Único canal de texto para comandos y avisos'))
        .addChannelTypes(ChannelType.GuildText),
    )
    .addBooleanOption((o) =>
      o
        .setName('clear_music_channel')
        .setNameLocalizations(ES('quitar_canal_musica'))
        .setDescription('Allow commands in any channel again')
        .setDescriptionLocalizations(ES('Permitir comandos en cualquier canal')),
    )
    .addBooleanOption((o) =>
      o.setName('clear_dj_role').setNameLocalizations(ES('quitar_rol_dj')).setDescription('Remove the DJ role restriction').setDescriptionLocalizations(ES('Quitar la restricción de rol DJ')),
    )
    .toJSON(),
  async execute(ctx) {
    const o = ctx.interaction.options;
    const guildId = ctx.interaction.guildId;
    const patch: Parameters<typeof ctx.settings.update>[1] = {};
    const language = o.getString('language');
    if (isLocale(language)) patch.locale = language;
    const vol = o.getInteger('volume');
    if (vol !== null) patch.defaultVolume = vol;
    const role = o.getRole('dj_role');
    if (role) patch.djRoleId = role.id;
    if (o.getBoolean('clear_dj_role')) patch.djRoleId = null;
    const musicChannel = o.getChannel('music_channel');
    if (musicChannel) patch.musicChannelId = musicChannel.id;
    if (o.getBoolean('clear_music_channel')) patch.musicChannelId = null;
    const changed = Object.keys(patch).length > 0;
    const s = changed ? ctx.settings.update(guildId, patch) : ctx.settings.get(guildId);
    const locale = s.locale;
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(t(locale, 'settings.title'))
      .addFields(
        { name: t(locale, 'settings.language'), value: s.locale === 'es' ? 'Español' : 'English', inline: true },
        { name: t(locale, 'settings.defaultVolume'), value: `${s.defaultVolume}%`, inline: true },
        { name: t(locale, 'settings.djRole'), value: s.djRoleId ? `<@&${s.djRoleId}>` : t(locale, 'np.none'), inline: true },
        {
          name: t(locale, 'settings.musicChannel'),
          value: s.musicChannelId ? `<#${s.musicChannelId}>` : t(locale, 'settings.anyChannel'),
          inline: true,
        },
        { name: 'Autoplay', value: t(locale, s.autoplay ? 'np.on' : 'np.off'), inline: true },
        { name: '24/7', value: t(locale, s.stay247 ? 'np.on' : 'np.off'), inline: true },
      );
    await ctx.interaction.reply({
      content: changed ? t(locale, 'settings.saved') : undefined,
      embeds: [embed],
      allowedMentions: { parse: [] },
      flags: MessageFlags.Ephemeral,
    });
  },
};

const HELP: Record<'es' | 'en', [string, string][]> = {
  es: [
    ['/play', 'Reproducí una búsqueda o un link (YouTube, Spotify, Suno)'],
    ['/search', 'Buscá y elegí entre 10 resultados'],
    ['/pause · /resume', 'Pausá o reanudá'],
    ['/skip · /previous', 'Siguiente o anterior'],
    ['/stop', 'Pará, vaciá la cola y salí'],
    ['/queue · /nowplaying', 'Mirá la cola o lo que suena'],
    ['/volume · /seek', 'Volumen (0-200) y adelantar'],
    ['/loop · /shuffle', 'Repetición y mezcla'],
    ['/remove · /move · /jump · /clear', 'Editá la cola'],
    ['/filters', 'Bass boost, nightcore, vaporwave, 8D'],
    ['/autoplay · /247', 'Canciones parecidas al terminar · quedarse en el canal'],
    ['/lyrics', 'Letra de la canción'],
    ['/settings', 'Idioma, volumen, rol DJ y canal de música'],
  ],
  en: [
    ['/play', 'Play a search or a link (YouTube, Spotify, Suno)'],
    ['/search', 'Search and pick from 10 results'],
    ['/pause · /resume', 'Pause or resume'],
    ['/skip · /previous', 'Next or previous'],
    ['/stop', 'Stop, clear the queue and leave'],
    ['/queue · /nowplaying', 'See the queue or the current song'],
    ['/volume · /seek', 'Volume (0-200) and seek'],
    ['/loop · /shuffle', 'Loop and shuffle'],
    ['/remove · /move · /jump · /clear', 'Edit the queue'],
    ['/filters', 'Bass boost, nightcore, vaporwave, 8D'],
    ['/autoplay · /247', 'Similar songs when the queue ends · stay in the channel'],
    ['/lyrics', 'Song lyrics'],
    ['/settings', 'Language, volume, DJ role and music channel'],
  ],
};

const help: Command = {
  data: command('help', 'How to use Rockola', 'Cómo usar Rockola').toJSON(),
  async execute(ctx) {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(msg(ctx, 'help.title'))
      .setDescription(msg(ctx, 'help.description'))
      .addFields(HELP[ctx.locale].map(([name, value]) => ({ name, value })))
      .setFooter({ text: msg(ctx, 'help.footer', { repo: REPO_URL }) });
    await ctx.interaction.reply({ embeds: [embed] });
  },
};

export const extraCommands: Command[] = [filters, autoplay, stay, lyrics, settings, help];

