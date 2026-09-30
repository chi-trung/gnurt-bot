// Suggestions: thành viên gửi ý kiến → embed trong #góp-ý + nút 👍/👎.
// Staff duyệt/từ chối bằng `/suggest decide <link> <trạng thái>`.
// Storage: src/data/suggestions.json { [id tin góp-ý]: { authorId, content, channelId,
//   up: [userId], down: [userId], status, createdAt, decidedBy, decidedAt } }.
const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');
const { sendLog } = require('../core/log');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SUG_FILE = path.join(DATA_DIR, 'suggestions.json');

const STATUS = {
  open: { label: '🟡 Đang xem xét', color: 0xf1c40f },
  accepted: { label: '🟢 Đã chấp nhận', color: 0x2ecc71 },
  rejected: { label: '🔴 Đã từ chối', color: 0xe74c3c },
  implemented: { label: '🔵 Đã triển khai', color: 0x3498db },
};

function loadSuggestions() {
  try {
    const j = JSON.parse(fs.readFileSync(SUG_FILE, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}
function saveSuggestions(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SUG_FILE, JSON.stringify(data, null, 2));
}

function voteRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('suggest:up')
      .setLabel('Đồng ý')
      .setStyle(ButtonStyle.Success)
      .setEmoji('👍'),
    new ButtonBuilder()
      .setCustomId('suggest:down')
      .setLabel('Không đồng ý')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('👎')
  );
}

function buildEmbed(item, messageId) {
  const st = STATUS[item.status] || STATUS.open;
  const embed = new EmbedBuilder()
    .setColor(st.color)
    .setAuthor({
      name: item.authorTag || 'Unknown',
      iconURL: item.authorAvatar || undefined,
    })
    .setFooter({ text: `${st.label} • 👍 ${item.up.length} • 👎 ${item.down.length}` })
    // item.createdAt lưu dạng string ISO trong JSON; EmbedBuilder.setTimestamp
    // chỉ nhận Date | number → phải ép lại Date, nếu không sẽ throw.
    .setTimestamp(new Date(item.createdAt || Date.now()));

  const url = `https://discord.com/channels/${item.guildId}/${item.channelId}/${messageId}`;
  return embed.setDescription(`${item.content}\n\n[Gợi ý này](${url})`);
}

const suggestCommand = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Gửi và quản lý gợi ý')
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Gửi một gợi ý mới')
      .addStringOption((o) =>
        o.setName('content').setDescription('Nội dung gợi ý (tối đa 1000 ký tự)').setRequired(true)
      )
  )
  .addSubcommand((s) => s.setName('list').setDescription('Xem các gợi ý đang mở'))
  .addSubcommand((s) =>
    s
      .setName('decide')
      .setDescription('Staff duyệt / từ chối gợi ý')
      .addStringOption((o) => o.setName('link').setDescription('Link tin gợi ý').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('status')
          .setDescription('Trạng thái mới')
          .setRequired(true)
          .addChoices(
            { name: '🟢 Chấp nhận', value: 'accepted' },
            { name: '🔴 Từ chối', value: 'rejected' },
            { name: '🔵 Đã triển khai', value: 'implemented' },
            { name: '🟡 Mở lại', value: 'open' }
          )
      )
  );

function isStaff(interaction, ctx) {
  const adminId = ctx.env.ADMIN_ROLE_ID;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return Boolean(adminId && interaction.member?.roles?.cache?.has(adminId));
}

/** Rút id message ra từ link: https://discord.com/channels/<guild>/<channel>/<message> */
function parseMessageId(link) {
  const m = String(link).match(/\/channels\/(\d+)\/(\d+)\/(\d+)/);
  return m ? m[3] : null;
}

async function createSuggestion(interaction, ctx) {
  const channelId = ctx.env.SUGGESTIONS_CHANNEL_ID;
  if (!channelId) {
    await interaction.reply({
      content: '⚠️ Chưa cấu hình `SUGGESTIONS_CHANNEL_ID` — module chưa hoạt động.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const content = interaction.options.getString('content').trim();
  if (!content) {
    await interaction.reply({ content: 'Nội dung rỗng.', flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = await ctx.client.channels.fetch(channelId);
  const item = {
    authorId: interaction.user.id,
    authorTag: interaction.user.tag,
    authorAvatar: interaction.user.displayAvatarURL({ size: 64 }),
    content: content.slice(0, 1000),
    channelId,
    guildId: interaction.guild.id,
    up: [],
    down: [],
    status: 'open',
    createdAt: new Date().toISOString(),
    decidedBy: null,
    decidedAt: null,
  };

  const sent = await channel.send({ embeds: [buildEmbed(item, '0')], components: [voteRow()] });
  item.messageId = sent.id;
  // embed lúc gửi chưa có id thật → sửa lại 1 lần cho link jump đúng
  await sent.edit({ embeds: [buildEmbed(item, sent.id)] });

  const all = loadSuggestions();
  all[sent.id] = item;
  saveSuggestions(all);

  await interaction.editReply(`✅ Đã gửi gợi ý: ${sent.url}`);

  sendLog(
    ctx,
    new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('💡 Gợi ý mới')
      .setDescription(`${interaction.user} gửi gợi ý\n${sent.url}`)
      .setTimestamp()
  ).catch(() => {});
  return true;
}

async function listSuggestions(interaction) {
  const all = loadSuggestions();
  const open = Object.values(all)
    .filter((s) => s.status === 'open')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 15);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`💡 Gợi ý đang mở (${open.length})`)
        .setDescription(
          open.length
            ? open
                .map(
                  (s) =>
                    `**${s.authorTag}** — 👍 ${s.up.length} / 👎 ${s.down.length}\n` +
                    `> ${s.content.slice(0, 120)}\n` +
                    `[link](https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId})`
                )
                .join('\n\n')
            : 'Chưa có gợi ý nào đang mở.'
        ),
    ],
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function decideSuggestion(interaction, ctx) {
  if (!isStaff(interaction, ctx)) {
    await interaction.reply({ content: 'Chỉ staff mới quyết định được gợi ý.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const messageId = parseMessageId(interaction.options.getString('link'));
  if (!messageId) {
    await interaction.reply({
      content: 'Link không hợp lệ — cần dạng `https://discord.com/channels/.../<id>`.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const all = loadSuggestions();
  const item = all[messageId];
  if (!item) {
    await interaction.reply({ content: 'Không tìm thấy gợi ý này trong database.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const next = interaction.options.getString('status');
  item.status = next;
  item.decidedBy = next === 'open' ? null : interaction.user.tag;
  item.decidedAt = next === 'open' ? null : new Date().toISOString();
  saveSuggestions(all);

  try {
    const channel = await ctx.client.channels.fetch(item.channelId);
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ embeds: [buildEmbed(item, messageId)], components: [voteRow()] });
  } catch (err) {
    console.error('Suggestions: không sửa được embed —', err.message);
  }

  await interaction.reply({
    content: `✅ Đã chuyển gợi ý sang **${STATUS[next].label}**.`,
    flags: MessageFlags.Ephemeral,
  });

  if (next !== 'open') {
    sendLog(
      ctx,
      new EmbedBuilder()
        .setColor(STATUS[next].color)
        .setTitle('💡 Gợi ý được xử lý')
        .setDescription(
          `${interaction.user} đặt trạng thái **${STATUS[next].label}**\n` +
            `<https://discord.com/channels/${item.guildId}/${item.channelId}/${messageId}>`
        )
        .setTimestamp()
    ).catch(() => {});
  }
  return true;
}

async function handleVote(interaction, ctx) {
  const add = interaction.customId === 'suggest:up';
  const all = loadSuggestions();
  const item = all[interaction.message.id];
  if (!item) {
    await interaction.reply({
      content: 'Gợi ý này không còn trong database.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const other = add ? 'down' : 'up';
  const wasIn = item[add ? 'up' : 'down'].includes(interaction.user.id);

  item[other] = item[other].filter((id) => id !== interaction.user.id);
  if (wasIn) item[add ? 'up' : 'down'] = item[add ? 'up' : 'down'].filter((id) => id !== interaction.user.id);
  else item[add ? 'up' : 'down'].push(interaction.user.id);

  saveSuggestions(all);

  const embed = buildEmbed(item, interaction.message.id);
  const row = voteRow();
  await interaction.update({ embeds: [embed], components: [row] });
  return true;
}

async function handleInteraction(interaction, ctx) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'suggest') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return createSuggestion(interaction, ctx);
    if (sub === 'list') return listSuggestions(interaction);
    if (sub === 'decide') return decideSuggestion(interaction, ctx);
    return false;
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'suggest:up' || interaction.customId === 'suggest:down') {
      return handleVote(interaction, ctx);
    }
    return false;
  }

  return false;
}

module.exports = {
  name: 'suggestions',
  commands: [suggestCommand],
  handleInteraction,
};
