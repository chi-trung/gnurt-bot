// Ticket: panel nút trong #tạo-ticket, tạo kênh riêng, đóng ticket.
// Quyền: member (người mở) + bot + 🛡️ Admin thấy kênh; @everyone bị ẩn.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  EmbedBuilder,
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');
const { sendLog } = require('../core/log');
const store = require('../core/store');

// Bản cũ đọc `process.env` lúc NẠP MODULE — hằng số bị ghim cho cả vòng đời
// process, nên server thứ hai không có giá trị riêng được. Giờ đọc
// `ctx.cfg(guildId)` mỗi lần dùng; `ctx` đi kèm interaction/button nên luôn
// biết đang xử lý guild nào.

const MEMBER_VIEW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
];

const closeCommand = new SlashCommandBuilder()
  .setName('close')
  .setDescription('Đóng ticket hiện tại');

function panelPayload() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:create')
      .setLabel('Tạo ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫')
  );
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('🎫 Hỗ trợ')
    .setDescription(
      'Bấm nút bên dưới để mở kênh hỗ trợ **riêng** với admin.\n' +
        'Khi xong việc: `/close` hoặc nút **Đóng ticket**.'
    );
  return { embeds: [embed], components: [row] };
}

function closePayload() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Đóng ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒')
  );
  return { components: [row] };
}

/**
 * Gửi panel ticket nếu chưa có (idempotent — tránh lặp khi restart).
 *
 * Bản cũ quét 20 tin gần nhất để tìm panel. Panel trôi khỏi 20 tin là mất dấu
 * → mỗi lần restart lại đăng một panel mới, dần dày kênh. Giờ lưu id tin vào
 * store và kiểm tra đúng tin đó còn sống không, giống hệt cách `verify` làm.
 */
async function ensurePanel(ctx, guildId, channelId) {
  const saved = store.read(guildId, 'ticket-panel');
  if (saved && saved.channelId === channelId) {
    try {
      const ch = await ctx.client.channels.fetch(saved.channelId);
      await ch.messages.fetch(saved.messageId);
      return;
    } catch {
      /* mất rồi — tạo lại */
    }
  }

  const channel = await ctx.client.channels.fetch(channelId);
  const msg = await channel.send(panelPayload());
  store.write(guildId, 'ticket-panel', { channelId: msg.channelId, messageId: msg.id });
  console.log(`Ticket [${guildId}]: đã gửi panel`);
}

async function createTicket(interaction, ctx) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const cfg = ctx.cfg(interaction.guildId);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: MEMBER_VIEW },
    // Bot tự allow để thấy được kênh vừa tạo (nếu không, @everyone deny cũng chặn bot)
    { id: guild.members.me.id, allow: MEMBER_VIEW },
  ];
  // Mỗi role admin của guild đều thấy ticket — `roles.admin` là mảng nên thêm
  // role không cần sửa code.
  for (const adminId of cfg.roles.admin || []) {
    overwrites.push({ id: adminId, allow: MEMBER_VIEW });
  }

  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  const channel = await guild.channels.create({
    name: `ticket-${safeName}`,
    type: 0, // GUILD_TEXT
    parent: cfg.channels.ticketCategory || undefined,
    topic: `owner:${interaction.user.id}`,
    permissionOverwrites: overwrites,
  });

  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🎫 Ticket')
    .setDescription(
      `Chào ${interaction.user}, đây là kênh hỗ trợ riêng của bạn.\n` +
        'Admin sẽ trả lời sớm. Khi xong: `/close` hoặc nút bên dưới.'
    );

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [embed],
    ...closePayload(),
  });
  await interaction.editReply(`✅ Ticket đã mở: ${channel}`);

  sendLog(
    ctx,
    interaction.guildId,
    new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🎫 Ticket mở')
      .setDescription(`${interaction.user} → ${channel}`)
      .setTimestamp()
  ).catch(() => {});
}

async function closeTicket(interaction, ctx) {
  const channel = interaction.channel;
  if (!channel || !channel.isTextBased?.()) {
    await interaction.reply({ content: 'Chỉ dùng trong kênh ticket.', flags: MessageFlags.Ephemeral });
    return;
  }

  const ownerId = (channel.topic || '').startsWith('owner:')
    ? channel.topic.slice(6)
    : null;
  const isOwner = ownerId === interaction.user.id;
  // Chỉ dựa vào quyền Discord, không dùng role admin: staff có ManageChannels
  // thì đóng được ticket. Không cần `roles.admin` trong config.
  const isStaff = Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels));

  if (!isOwner && !isStaff) {
    await interaction.reply({
      content: 'Chỉ người mở ticket hoặc admin mới đóng được.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({ content: '🔒 Đang đóng ticket...', flags: MessageFlags.Ephemeral });
  const name = channel.name;
  await channel.delete('Ticket closed');

  sendLog(
    ctx,
    interaction.guildId,
    new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🔒 Ticket đóng')
      .setDescription(`${interaction.user} đóng \`#${name}\``)
      .setTimestamp()
  ).catch(() => {});
}

/** Trả về true nếu interaction này thuộc về module ticket. */
async function handleInteraction(interaction, ctx) {
  if (interaction.isChatInputCommand() && interaction.commandName === 'close') {
    await closeTicket(interaction, ctx);
    return true;
  }
  if (!interaction.isButton()) return false;

  if (interaction.customId === 'ticket:create') {
    await createTicket(interaction, ctx);
    return true;
  }
  if (interaction.customId === 'ticket:close') {
    await closeTicket(interaction, ctx);
    return true;
  }
  return false;
}

module.exports = {
  name: 'ticket',
  commands: [closeCommand],
  init: async (ctx, guildId) => {
    const channelId = ctx.cfg(guildId).channels.ticket;
    if (!channelId) return;
    await ensurePanel(ctx, guildId, channelId);
  },
  handleInteraction,
};
