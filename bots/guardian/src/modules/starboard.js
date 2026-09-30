// Starboard: tin được >= ngưỡng reaction ⭐ → embed vào kênh starboard, tự update số.
// Cấu hình: config.json → starboard { threshold, emoji }; STARBOARD_CHANNEL_ID ở .env.
// Storage: core/store → data/guilds/<guildId>/starboard.json { [tin gốc]: [tin starboard] }.
const { Events, EmbedBuilder } = require('discord.js');
const store = require('../core/store');

/** So khớp emoji: config '⭐' → so với name; '<:ten:123>' / 'ten:123' → so name:id. */
function emojiMatches(configEmoji, emoji) {
  const cfg = String(configEmoji).trim();
  const custom = cfg.match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/) || cfg.match(/^([A-Za-z0-9_]+):(\d+)$/);
  const key = custom ? `${custom[1]}:${custom[2]}` : cfg;
  const actual = emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name;
  return key === actual;
}

function buildEmbed(msg, count, channelName) {
  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setAuthor({ name: msg.author.tag, iconURL: msg.author.displayAvatarURL({ size: 64 }) })
    .setFooter({ text: `${count} ⭐ • #${channelName}` })
    .setTimestamp(msg.createdAt);

  const content = msg.content || '';
  if (content) embed.setDescription(`${content.slice(0, 4000)}\n\n[Jump](${msg.url})`);
  else embed.setDescription(`[Jump](${msg.url})`);

  const img = [...msg.attachments.values()].find((a) => a.contentType?.startsWith('image/'));
  if (img) embed.setImage(img.url);

  return embed;
}

/** Đưa tin vào starboard (hoặc update nếu đã có). */
async function postOrUpdate(ctx, reaction) {
  const msg = reaction.message;
  if (!msg.guild || msg.author?.bot) return;

  // Cấu hình theo guild: mỗi server một kênh starboard riêng. Đọc SAU khi
  // check `msg.guild` vì `ctx.cfg(undefined)` trả shape rỗng.
  const c = ctx.cfg(msg.guildId).starboard;
  const channelId = ctx.cfg(msg.guildId).channels.starboard;
  if (!channelId) return;

  if (msg.channel.id === channelId) return;
  if (!emojiMatches(c.emoji, reaction.emoji)) return;
  if (reaction.count < c.threshold) return;

  try {
    const sbChannel = await ctx.client.channels.fetch(channelId);
    const map = store.read(msg.guildId, 'starboard');
    const existingId = map[msg.id];
    const embed = buildEmbed(msg, reaction.count, msg.channel.name);

    if (existingId) {
      try {
        const sbMsg = await sbChannel.messages.fetch(existingId);
        await sbMsg.edit({ embeds: [embed] });
        return;
      } catch {
        /* tin starboard bị xóa — gửi lại */
      }
    }

    const sbMsg = await sbChannel.send({ embeds: [embed] });
    await store.updateAsync(msg.guildId, 'starboard', (m) => {
      m[msg.id] = sbMsg.id;
    });
  } catch (err) {
    console.error('Starboard lỗi:', err.message);
  }
}

/** Update số sao khi bỏ reaction (không xóa bài — chỉ cập nhật count). */
async function updateCount(ctx, reaction) {
  const msg = reaction.message;
  if (!msg.guild) return;

  // Đọc SAU khi check `msg.guild` — `ctx.cfg(undefined)` trả shape rỗng.
  const c = ctx.cfg(msg.guildId).starboard;
  if (!emojiMatches(c.emoji, reaction.emoji)) return;

  // Không có kênh starboard thì không có gì để cập nhật — `channels.fetch(undefined)`
  // throw TypeError, chỉ chết trong try/catch nên im lắng mất dấu.
  const channelId = ctx.cfg(msg.guildId).channels.starboard;
  if (!channelId) return;

  const existingId = store.read(msg.guildId, 'starboard')[msg.id];
  if (!existingId) return; // chưa từng lên starboard → bỏ qua

  try {
    const sbChannel = await ctx.client.channels.fetch(channelId);
    const sbMsg = await sbChannel.messages.fetch(existingId);
    const count = reaction.count ?? 0;
    const embed = buildEmbed(msg, count, msg.channel.name);
    await sbMsg.edit({ embeds: [embed] });
  } catch (err) {
    console.error('Starboard update lỗi:', err.message);
  }
}

module.exports = {
  name: 'starboard',
  events: [
    {
      name: Events.MessageReactionAdd,
      handler: async (ctx, reaction, user) => {
        if (user.bot) return;
        if (reaction.partial) {
          try {
            await reaction.fetch();
          } catch {
            return;
          }
        }
        await postOrUpdate(ctx, reaction);
      },
    },
    {
      name: Events.MessageReactionRemove,
      handler: async (ctx, reaction, user) => {
        if (user.bot) return;
        if (reaction.partial) {
          try {
            await reaction.fetch();
          } catch {
            return;
          }
        }
        await updateCount(ctx, reaction);
      },
    },
  ],
};
