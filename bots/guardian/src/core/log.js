// Gửi embed sự kiện vào #log-bot. Mọi module dùng chung đây.
//
// Kênh log lấy từ `ctx.cfg(guildId).channels.log` — mỗi server một kênh.
// Bản single-guild đọc `ctx.env.LOG_CHANNEL_ID`, nên log của server thứ hai đổ
// vào #log-bot của server gốc (hoặc mất hẳn nếu bot không vào được kênh đó).
const { EmbedBuilder } = require('discord.js');

async function sendLog(ctx, guildId, embed) {
  if (!guildId) return;
  const id = ctx.cfg(guildId).channels.log;
  if (!id) return;
  try {
    const channel = await ctx.client.channels.fetch(id);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Không gửi được log:', err.message);
  }
}

module.exports = { sendLog };
