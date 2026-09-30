// Suggestions: thành viên gửi ý kiến → embed trong #góp-ý + nút 👍/👎.
// Staff duyệt/từ chối bằng `/suggest decide <link> <trạng thái>`.
// Storage: core/store → data/guilds/<guildId>/suggestions.json
//   { [id tin góp-ý]: { authorId, content, channelId, up[], down[], status, ... } }
//
// Mỗi record vẫn lưu `guildId` (dùng để dựng link jump) nhưng khoá store đã tách
// sẵn theo guild. `/suggest list` trước đây liệt kê MỌI record trong file nên
// ở server thứ hai sẽ lộ gợi ý của server gốc.
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
const store = require('../core/store');

const STATUS = {
  open: { label: '🟡 Đang xem xét', color: 0xf1c40f },
  accepted: { label: '🟢 Đã chấp nhận', color: 0x2ecc71 },
  rejected: { label: '🔴 Đã từ chối', color: 0xe74c3c },
  implemented: { label: '🔵 Đã triển khai', color: 0x3498db },
};

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

// Staff = người có quyền Discord, không phụ thuộc role trong config: quy mô
// kiểm soát đến từ role Discord sẵn có (Administrator/ManageGuild).
function isStaff(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

/** Rút id message ra từ link: https://discord.com/channels/<guild>/<channel>/<message> */
function parseMessageId(link) {
  const m = String(link).match(/\/channels\/(\d+)\/(\d+)\/(\d+)/);
  return m ? m[3] : null;
}

async function createSuggestion(interaction, ctx) {
  const channelId = ctx.cfg(interaction.guildId).channels.suggestions;
  if (!channelId) {
    await interaction.reply({
      content: '⚠️ Chưa cấu hình kênh gợi ý cho server này — module chưa hoạt động.',
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

  await store.updateAsync(interaction.guildId, 'suggestions', (all) => {
    all[sent.id] = item;
  });

  await interaction.editReply(`✅ Đã gửi gợi ý: ${sent.url}`);

  sendLog(
    ctx,
    interaction.guildId,
    new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('💡 Gợi ý mới')
      .setDescription(`${interaction.user} gửi gợi ý\n${sent.url}`)
      .setTimestamp()
  ).catch(() => {});
  return true;
}

async function listSuggestions(interaction) {
  const open = Object.values(store.read(interaction.guildId, 'suggestions'))
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
  if (!isStaff(interaction)) {
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

  const all = store.read(interaction.guildId, 'suggestions');
  const item = all[messageId];
  if (!item) {
    await interaction.reply({ content: 'Không tìm thấy gợi ý này trong database.', flags: MessageFlags.Ephemeral });
    return true;
  }
  // Record lưu `channelId` từ lúc tạo. Nếu server đã đổi tên/kênh bị xoá thì
  // `channels.fetch` ném — hoặc tệ hơn, trỏ sang kênh của server khác. Chặn
  // trước khi đụng record.
  const ch = interaction.guild.channels.cache.get(item.channelId);
  if (!ch) {
    await interaction.reply({
      content: 'Kênh chứa gợi ý này không còn trong server (đã xoá hoặc đổi chế độ xem) — cần cập nhật lại.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const next = interaction.options.getString('status');
  item.status = next;
  item.decidedBy = next === 'open' ? null : interaction.user.tag;
  item.decidedAt = next === 'open' ? null : new Date().toISOString();
  await store.updateAsync(interaction.guildId, 'suggestions', (a) => {
    a[messageId] = item;
  });

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
      interaction.guildId,
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
  const messageId = interaction.message.id;
  const userId = interaction.user.id;

  // Bấm nút trên embed cũ ở server đã rời đi: interaction vẫn có guildId nên
  // vẫn tìm thấy store — nhưng record đó không thuộc server này nữa.
  const item = await store.updateAsync(interaction.guildId, 'suggestions', (all) => {
    const it = all[messageId];
    if (!it) return null;
    const other = add ? 'down' : 'up';
    const side = add ? 'up' : 'down';
    const wasIn = it[side].includes(userId);
    it[other] = it[other].filter((id) => id !== userId);
    if (wasIn) it[side] = it[side].filter((id) => id !== userId);
    else it[side].push(userId);
    return it;
  });
  if (!item) {
    await interaction.reply({
      content: 'Gợi ý này không còn trong database.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const embed = buildEmbed(item, messageId);
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
