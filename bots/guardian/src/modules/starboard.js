// Starboard: tin được >= ngưỡng reaction ⭐ → embed vào kênh starboard, tự update số.
// Cấu hình: config.json → starboard { threshold, emoji }; STARBOARD_CHANNEL_ID ở .env.
// Storage: src/data/starboard.json { [tin gốc]: [tin starboard] }.
const fs = require('fs');
const path = require('path');
const { Events, EmbedBuilder } = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SB_FILE = path.join(DATA_DIR, 'starboard.json');

function loadMap() {
  try {
    const j = JSON.parse(fs.readFileSync(SB_FILE, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}
function saveMap(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SB_FILE, JSON.stringify(data, null, 2));
}

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
  const c = ctx.config.starboard;
  const channelId = ctx.env.STARBOARD_CHANNEL_ID;
  if (!channelId) return;

  const msg = reaction.message;
  if (!msg.guild || msg.author?.bot) return;
  if (msg.channel.id === channelId) return;
  if (!emojiMatches(c.emoji, reaction.emoji)) return;
  if (reaction.count < c.threshold) return;

  try {
    const sbChannel = await ctx.client.channels.fetch(channelId);
    const map = loadMap();
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
    map[msg.id] = sbMsg.id;
    saveMap(map);
  } catch (err) {
    console.error('Starboard lỗi:', err.message);
  }
}

/** Update số sao khi bỏ reaction (không xóa bài — chỉ cập nhật count). */
async function updateCount(ctx, reaction) {
  const c = ctx.config.starboard;
  if (!emojiMatches(c.emoji, reaction.emoji)) return;
  const msg = reaction.message;
  if (!msg.guild) return;

  const map = loadMap();
  const existingId = map[msg.id];
  if (!existingId) return; // chưa từng lên starboard → bỏ qua

  try {
    const sbChannel = await ctx.client.channels.fetch(ctx.env.STARBOARD_CHANNEL_ID);
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
