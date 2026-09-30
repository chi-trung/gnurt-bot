// Gửi embed sự kiện vào #log-bot. Mọi module dùng chung đây.
const { EmbedBuilder } = require('discord.js');

async function sendLog(ctx, embed) {
  const id = ctx.env.LOG_CHANNEL_ID;
  if (!id) return;
  try {
    const channel = await ctx.client.channels.fetch(id);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Không gửi được log:', err.message);
  }
}

module.exports = { sendLog };
