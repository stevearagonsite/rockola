import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder } from 'discord.js';
import { BRAND_COLOR, trackLink } from '../discord/ui.js';
import type { GuildPlayer } from '../player/guildPlayer.js';
import type { LoopMode } from '../player/queue.js';
import type { Locale } from '../i18n/index.js';
import { t } from '../i18n/index.js';
import { formatDuration } from '../util/time.js';
import { activePlayer, command, ES, fail, msg, reply } from './helpers.js';
import type { Command, Context } from './types.js';

function queueEmbed(player: GuildPlayer, guildName: string, locale: Locale, page: number): { embed: EmbedBuilder; pages: number; page: number } {
  const q = player.queue;
  const p = q.page(page);
  const current = q.current;
  const lines = p.items.map((tr, i) => `\`${p.offset + i + 1}.\` ${trackLink(tr, 60)} · \`${formatDuration(tr.durationMs)}\``);
  const total = q.upcoming.reduce((sum, tr) => sum + (tr.durationMs ?? 0), 0);
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(t(locale, 'queue.title', { guild: guildName }))
    .addFields(
      {
        name: t(locale, 'queue.nowPlaying'),
        value: current ? `${trackLink(current)} · \`${formatDuration(player.positionMs)} / ${formatDuration(current.durationMs)}\`` : '—',
      },
      { name: t(locale, 'queue.upNext'), value: lines.length ? lines.join('\n') : t(locale, 'queue.nothingNext') },
    )
    .setFooter({ text: t(locale, 'queue.footer', { page: p.page, pages: p.pages, count: q.size, duration: formatDuration(total) }) });
  return { embed, pages: p.pages, page: p.page };
}

function pager(page: number, pages: number, id: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${id}:prev`).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`${id}:next`).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages),
  );
}

const queue: Command = {
  data: command('queue', 'Show the queue', 'Mostrá la cola')
    .addIntegerOption((o) => o.setName('page').setNameLocalizations(ES('pagina')).setDescription('Page').setDescriptionLocalizations(ES('Página')).setMinValue(1))
    .toJSON(),
  async execute(ctx) {
    const player = await activePlayer(ctx, false);
    if (!player) return;
    let page = ctx.interaction.options.getInteger('page') ?? 1;
    const id = `rk:queue:${ctx.interaction.id}`;
    const render = () => {
      const r = queueEmbed(player, ctx.interaction.guild.name, ctx.locale, page);
      page = r.page;
      return { embeds: [r.embed], components: r.pages > 1 ? [pager(r.page, r.pages, id)] : [], allowedMentions: { parse: [] } };
    };
    const message = await ctx.interaction.reply({ ...render(), withResponse: true });
    const sent = message.resource?.message;
    if (!sent) return;
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
    collector.on('collect', async (i) => {
      page += i.customId.endsWith(':next') ? 1 : -1;
      await i.update(render()).catch(() => undefined);
    });
    collector.on('end', () => void ctx.interaction.editReply({ components: [] }).catch(() => undefined));
  },
};

async function positionArg(ctx: Context, player: GuildPlayer, name: string): Promise<number | null> {
  const pos = ctx.interaction.options.getInteger(name, true);
  if (!player.queue.isValidPosition(pos)) {
    await fail(ctx, 'error.invalidPosition', { size: player.queue.size });
    return null;
  }
  return pos;
}

const posOption = (name: string, es: string, en: string, esDesc: string) => (o: import('discord.js').SlashCommandIntegerOption) =>
  o.setName(name).setNameLocalizations(ES(es)).setDescription(en).setDescriptionLocalizations(ES(esDesc)).setMinValue(1).setRequired(true);

const remove: Command = {
  data: command('remove', 'Remove a song from the queue', 'Quitá una canción de la cola')
    .addIntegerOption(posOption('position', 'posicion', 'Position in the queue', 'Posición en la cola'))
    .toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    const pos = await positionArg(ctx, player, 'position');
    if (pos === null) return;
    const removed = player.queue.remove(pos)!;
    await reply(ctx, msg(ctx, 'remove.done', { title: trackLink(removed) }));
  },
};

const move: Command = {
  data: command('move', 'Move a song in the queue', 'Mové una canción dentro de la cola')
    .addIntegerOption(posOption('from', 'desde', 'Current position', 'Posición actual'))
    .addIntegerOption(posOption('to', 'hasta', 'New position', 'Nueva posición'))
    .toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    const from = await positionArg(ctx, player, 'from');
    if (from === null) return;
    const to = await positionArg(ctx, player, 'to');
    if (to === null) return;
    const moved = player.queue.move(from, to)!;
    await reply(ctx, msg(ctx, 'move.done', { title: trackLink(moved), to }));
  },
};

const jump: Command = {
  data: command('jump', 'Skip to a position in the queue', 'Saltá a una posición de la cola')
    .addIntegerOption(posOption('position', 'posicion', 'Position in the queue', 'Posición en la cola'))
    .toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    const pos = await positionArg(ctx, player, 'position');
    if (pos === null) return;
    await ctx.interaction.deferReply();
    const target = await player.jump(pos);
    await reply(ctx, msg(ctx, 'jump.done', { title: target ? trackLink(target) : '?' }));
  },
};

const clear: Command = {
  data: command('clear', 'Clear the queue (keeps the current song)', 'Vaciá la cola (sigue la canción actual)').toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    player.queue.clear();
    await reply(ctx, msg(ctx, 'clear.done'));
  },
};

const shuffle: Command = {
  data: command('shuffle', 'Shuffle the queue', 'Mezclá la cola').toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    if (player.queue.size < 2) return void (await fail(ctx, 'error.queueEmpty'));
    player.queue.shuffle();
    await reply(ctx, msg(ctx, 'shuffle.done'));
  },
};

const loop: Command = {
  data: command('loop', 'Set the loop mode', 'Elegí el modo de repetición')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setNameLocalizations(ES('modo'))
        .setDescription('off / track / queue')
        .setRequired(true)
        .addChoices(
          { name: 'off', value: 'off', name_localizations: ES('desactivado') },
          { name: 'track', value: 'track', name_localizations: ES('canción') },
          { name: 'queue', value: 'queue', name_localizations: ES('cola') },
        ),
    )
    .toJSON(),
  dj: true,
  async execute(ctx) {
    const player = await activePlayer(ctx);
    if (!player) return;
    const mode = ctx.interaction.options.getString('mode', true) as LoopMode;
    player.queue.loop = mode;
    await player.refreshControls();
    await reply(ctx, msg(ctx, `loop.${mode}`));
  },
};

export const queueCommands: Command[] = [queue, remove, move, jump, clear, shuffle, loop];
