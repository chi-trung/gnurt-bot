// Verify gate: panel nút trong #xác-nhận → nhận ✅ Đã xác nhận, gỡ ⏳ Chờ xác nhận.
// Nếu cấu hình VERIFY_PENDING_ROLE_ID: thành viên mới vào server bị gán role chờ.
// Thiếu VERIFY_CHANNEL_ID / VERIFY_ROLE_ID → module tự bỏ qua (không kill bot).
const fs = require('fs');
const path = require('path');
const {
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { sendLog } = require('../core/log');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PANEL_FILE = path.join(DATA_DIR, 'verify-panel.json');

function loadPanel() {
  try {
    return JSON.parse(fs.readFileSync(PANEL_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function savePanel(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PANEL_FILE, JSON.stringify(data, null, 2));
}

function envIds(ctx) {
  return {
    channelId: ctx.env.VERIFY_CHANNEL_ID,
    roleId: ctx.env.VERIFY_ROLE_ID,
    pendingId: ctx.env.VERIFY_PENDING_ROLE_ID || null,
  };
}

async function init(ctx) {
  const { channelId, roleId } = envIds(ctx);
  if (!channelId || !roleId) {
    console.log('Verify: thiếu VERIFY_CHANNEL_ID/VERIFY_ROLE_ID — bỏ qua panel');
    return;
  }

  // Panel đã tồn tại thì dùng lại (tránh spam mỗi lần restart)
  const saved = loadPanel();
  if (saved) {
    try {
      const ch = await ctx.client.channels.fetch(saved.channelId);
      await ch.messages.fetch(saved.messageId);
      return; // còn tin → ok
    } catch {
      /* mất rồi — tạo lại */
    }
  }

  const ch = await ctx.client.channels.fetch(channelId);
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🛡️ Xác nhận thành viên')
    .setDescription(
      'Chào mừng bạn đến với server!\n\nBấm nút bên dưới để xác nhận bạn đã đọc nội quy và nhận role thành viên.'
    )
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify:agree')
      .setLabel('✅ Tôi đồng ý')
      .setStyle(ButtonStyle.Success)
  );
  const msg = await ch.send({ embeds: [embed], components: [row] });
  savePanel({ channelId: msg.channelId, messageId: msg.id });
  console.log('Verify: đã tạo panel mới');
}

async function handleInteraction(interaction, ctx) {
  if (!interaction.isButton() || interaction.customId !== 'verify:agree') return false;

  const { roleId, pendingId } = envIds(ctx);
  if (!roleId) return false; // env thiếu — module đã bị bỏ qua

  const member = interaction.member;
  if (!member || !member.roles) {
    await interaction.reply({ content: 'Không tìm thấy thành viên của bạn.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (member.roles.cache.has(roleId)) {
    await interaction.reply({ content: 'Bạn đã xác nhận rồi ✅', flags: MessageFlags.Ephemeral });
    return true;
  }

  try {
    await member.roles.add(roleId);
    if (pendingId && member.roles.cache.has(pendingId)) {
      await member.roles.remove(pendingId);
    }
    await interaction.reply({ content: '✅ Xác nhận thành công — chúc bạn vui vẻ trong server!', flags: MessageFlags.Ephemeral });
    await sendLog(
      ctx,
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('✅ Thành viên đã xác nhận')
        .setDescription(`${member.user} (${member.user.tag})`)
        .setTimestamp()
    );
  } catch (err) {
    console.error('Verify lỗi:', err.message);
    await interaction.reply({ content: `❌ Không xác nhận được: ${err.message}`, flags: MessageFlags.Ephemeral });
  }
  return true;
}

module.exports = {
  name: 'verify',
  init,
  handleInteraction,
  events: [
    {
      // thành viên mới vào → gán role chờ (nếu cấu hình)
      name: Events.GuildMemberAdd,
      handler: async (ctx, member) => {
        const { pendingId } = envIds(ctx);
        if (!pendingId || member.user.bot) return;
        try {
          await member.roles.add(pendingId);
        } catch (err) {
          console.error('Verify: không gán được role chờ:', err.message);
        }
      },
    },
  ],
};
