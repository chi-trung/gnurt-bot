// Reaction-roles: /rr create đăng panel "bấm emoji nhận role", /rr delete gỡ panel.
// Lưu ở core/store → data/guilds/<guildId>/rr.json (mảng) — bot restart vẫn nhớ panel.
const { Events, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const store = require('../core/store');

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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

      await store.updateAsync(interaction.guildId, 'rr', (list) => {
        list.push({ channelId: msg.channelId, messageId: msg.id, emoji: emojiInput, roleId: role.id });
      });

      await interaction.editReply(`✅ Đã tạo panel tại ${channel} — ${emojiInput} → ${role}`);
    } catch (err) {
      console.error('RR create lỗi:', err.message);
      await interaction.editReply(`❌ Tạo thất bại: ${err.message} (emoji có hợp lệ không?)`);
    }
    return true;
  }

  if (sub === 'delete') {
    const link = interaction.options.getString('link');
    const m = link.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (!m) {
      await interaction.editReply('Link không hợp lệ — chuột phải tin nhắn → Copy Message Link.');
      return true;
    }
    // Dán link panel của server khác: m2 (channelId) đã thuộc server đó nên
    // `channels.fetch` sẽ trả về kênh server khác — bot gỡ nhầm panel bên đó.
    if (m[1] !== interaction.guildId) {
      await interaction.editReply('Link đó trỏ sang server khác — chỉ xoá được panel trong server này.');
      return true;
    }
    const messageId = m[3];
    const pair = store.read(interaction.guildId, 'rr').find((p) => p.messageId === messageId);
    if (!pair) {
      await interaction.editReply('Không tìm thấy panel nào có id đó (hoặc đã xóa trước đó).');
      return true;
    }
    try {
      const ch = await ctx.client.channels.fetch(pair.channelId);
      const msg = await ch.messages.fetch(messageId);
      await msg.delete();
    } catch {
      /* tin có thể đã bị xóa — vẫn gỡ record */
    }
    await store.updateAsync(interaction.guildId, 'rr', (list) => {
      const idx = list.findIndex((p) => p.messageId === messageId);
      if (idx !== -1) list.splice(idx, 1);
    });
    await interaction.editReply('🗑️ Đã xóa panel reaction-role.');
    return true;
  }

  return false;
}

async function grantOrRevoke(reaction, userId, add) {
  const message = reaction.message;
  if (!message.guild) return;
  const key = emojiKey(reaction.emoji);

  // Chỉ tra trong `rr` của đúng guild này.
  const pair = store
    .read(message.guild.id, 'rr')
    .find((p) => p.messageId === message.id && p.emoji === key);
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
