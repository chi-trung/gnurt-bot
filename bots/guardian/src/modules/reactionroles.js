// Reaction-roles: /rr create đăng panel "bấm emoji nhận role", /rr delete gỡ panel.
// Lưu ở src/data/rr.json — bot restart vẫn nhớ panel.
const fs = require('fs');
const path = require('path');
const { Events, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const RR_FILE = path.join(DATA_DIR, 'rr.json');

function loadPairs() {
  try {
    const j = JSON.parse(fs.readFileSync(RR_FILE, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
function savePairs(list) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RR_FILE, JSON.stringify(list, null, 2));
}

/** '👍' → '👍', '<:ten:123>' / 'ten:123' → 'ten:123' (định dạng msg.react). */
function parseEmoji(input) {
  const s = String(input).trim();
  const custom = s.match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/) || s.match(/^([A-Za-z0-9_]+):(\d+)$/);
  if (custom) return `${custom[1]}:${custom[2]}`;
  return s; // unicode
}
/** Khóa so khớp giữa storage và MessageReaction. */
function emojiKey(emoji) {
  return emoji.id ? `${emoji.name}:${emoji.id}` : emoji.name;
}

const rrCommand = new SlashCommandBuilder()
  .setName('rr')
  .setDescription('Quản lý reaction-role')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Đăng panel reaction-role')
      .addChannelOption((o) => o.setName('channel').setDescription('Kênh đăng panel').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role nhận khi bấm').setRequired(true))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji (vd: 👍 hoặc <:ten:123>)').setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Xóa panel reaction-role (dán link tin nhắn)')
      .addStringOption((o) =>
        o.setName('link').setDescription('Link tin nhắn panel (chuột phải → Copy Message Link)').setRequired(true)
      )
  );

async function handleInteraction(interaction, ctx) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'rr') return false;

  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });

  if (sub === 'create') {
    const channel = interaction.options.getChannel('channel');
    const role = interaction.options.getRole('role');
    const emojiInput = parseEmoji(interaction.options.getString('emoji'));

    if (role.position >= interaction.guild.members.me.roles.highest.position) {
      await interaction.editReply('Role đó bằng/cao hơn role của bot — không cấp được.');
      return true;
    }

    try {
      const msg = await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('🎮 Reaction-role')
            .setDescription(`React ${emojiInput} để nhận ${role}`),
        ],
      });
      await msg.react(emojiInput);

      const list = loadPairs();
      list.push({ channelId: msg.channelId, messageId: msg.id, emoji: emojiInput, roleId: role.id });
      savePairs(list);

      await interaction.editReply(`✅ Đã tạo panel tại ${channel} — ${emojiInput} → ${role}`);
    } catch (err) {
      console.error('RR create lỗi:', err.message);
      await interaction.editReply(`❌ Tạo thất bại: ${err.message} (emoji có hợp lệ không?)`);
    }
    return true;
  }

  if (sub === 'delete') {
    const link = interaction.options.getString('link');
    const m = link.match(/channels\/\d+\/(\d+)\/(\d+)/);
    if (!m) {
      await interaction.editReply('Link không hợp lệ — chuột phải tin nhắn → Copy Message Link.');
      return true;
    }
    const messageId = m[2];
    const list = loadPairs();
    const idx = list.findIndex((p) => p.messageId === messageId);
    if (idx === -1) {
      await interaction.editReply('Không tìm thấy panel nào có id đó (hoặc đã xóa trước đó).');
      return true;
    }
    try {
      const ch = await ctx.client.channels.fetch(list[idx].channelId);
      const msg = await ch.messages.fetch(messageId);
      await msg.delete();
    } catch {
      /* tin có thể đã bị xóa — vẫn gỡ record */
    }
    list.splice(idx, 1);
    savePairs(list);
    await interaction.editReply('🗑️ Đã xóa panel reaction-role.');
    return true;
  }

  return false;
}

async function grantOrRevoke(reaction, userId, add) {
  const message = reaction.message;
  if (!message.guild) return;
  const key = emojiKey(reaction.emoji);

  const pair = loadPairs().find((p) => p.messageId === message.id && p.emoji === key);
  if (!pair) return;

  try {
    const member = await message.guild.members.fetch(userId);
    if (member.user.bot) return;
    if (add) await member.roles.add(pair.roleId);
    else await member.roles.remove(pair.roleId);
  } catch (err) {
    console.error(`RR ${add ? 'add' : 'remove'} lỗi:`, err.message);
  }
}

module.exports = {
  name: 'reactionroles',
  commands: [rrCommand],
  handleInteraction,
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
        await grantOrRevoke(reaction, user.id, true);
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
        await grantOrRevoke(reaction, user.id, false);
      },
    },
  ],
};
