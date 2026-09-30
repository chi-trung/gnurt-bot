// Ticket: panel nút trong #tạo-ticket, tạo kênh riêng, đóng ticket.
// Quyền: member (người mở) + bot + 🛡️ Admin thấy kênh; @everyone bị ẩn.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { sendLog } = require('../core/log');

const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID;
const TICKET_CATEGORY_ID = process.env.TICKET_CATEGORY_ID;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID;

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

/** Gửi panel ticket nếu kênh chưa có (idempotent — tránh lặp khi restart). */
async function ensurePanel(client, channelId) {
  const channel = await client.channels.fetch(channelId);
  const recent = await channel.messages.fetch({ limit: 20 });
  const hasPanel = recent.some((m) =>
    m.components.some((row) => row.components.some((c) => c.customId === 'ticket:create'))
  );
  if (!hasPanel) {
    await channel.send(panelPayload());
    console.log('Đã gửi panel ticket');
  }
}

async function createTicket(interaction, ctx) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: MEMBER_VIEW },
    // Bot tự allow để thấy được kênh vừa tạo (nếu không, @everyone deny cũng chặn bot)
    { id: guild.members.me.id, allow: MEMBER_VIEW },
  ];
  if (ADMIN_ROLE_ID) overwrites.push({ id: ADMIN_ROLE_ID, allow: MEMBER_VIEW });

  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  const channel = await guild.channels.create({
    name: `ticket-${safeName}`,
    type: 0, // GUILD_TEXT
    parent: TICKET_CATEGORY_ID || undefined,
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
    await interaction.reply({ content: 'Chỉ dùng trong kênh ticket.', ephemeral: true });
    return;
  }

  const ownerId = (channel.topic || '').startsWith('owner:')
    ? channel.topic.slice(6)
    : null;
  const isOwner = ownerId === interaction.user.id;
  const isStaff =
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ||
    (ADMIN_ROLE_ID && interaction.member?.roles?.cache?.has(ADMIN_ROLE_ID));

  if (!isOwner && !isStaff) {
    await interaction.reply({
      content: 'Chỉ người mở ticket hoặc admin mới đóng được.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({ content: '🔒 Đang đóng ticket...', ephemeral: true });
  const name = channel.name;
  await channel.delete('Ticket closed');

  sendLog(
    ctx,
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
  init: async (ctx) => {
    if (!TICKET_CHANNEL_ID) return;
    await ensurePanel(ctx.client, TICKET_CHANNEL_ID);
  },
  handleInteraction,
};
