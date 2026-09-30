// Lệnh quản trị: /kick /ban /timeout /warn — mặc định ẩn với user không đủ quyền
// (Discord default_member_permissions), đồng thời check lại phía server.
// Warn lưu ở core/store → data/guilds/<guildId>/warns.json, khoá theo userId.
// Bản single-guild để file phẳng: cùng một người bị warn 3 lần ở server A thì
// sang server B lệnh /warn báo "tổng 3" dù chưa ai bị warn lần nào.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { sendLog } = require('../core/log');
const store = require('../core/store');

const kickCmd = new SlashCommandBuilder()
  .setName('kick')
  .setDescription('Kick thành viên khỏi server')
  .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
  .addUserOption((o) => o.setName('user').setDescription('Thành viên').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Lý do'));

const banCmd = new SlashCommandBuilder()
  .setName('ban')
  .setDescription('Ban thành viên khỏi server')
  .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
  .addUserOption((o) => o.setName('user').setDescription('Thành viên').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Lý do'));

const timeoutCmd = new SlashCommandBuilder()
  .setName('timeout')
  .setDescription('Timeout thành viên (phút)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName('user').setDescription('Thành viên').setRequired(true))
  .addIntegerOption((o) =>
    o.setName('minutes').setDescription('Số phút (1-40320)').setRequired(true).setMinValue(1).setMaxValue(40320)
  )
  .addStringOption((o) => o.setName('reason').setDescription('Lý do'));

const warnCmd = new SlashCommandBuilder()
  .setName('warn')
  .setDescription('Warning thành viên')
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
  .addUserOption((o) => o.setName('user').setDescription('Thành viên').setRequired(true))
  .addStringOption((o) => o.setName('reason').setDescription('Lý do').setRequired(true));

/** Trả về true nếu interaction thuộc module này (đã xử lý hoặc đã trả lời lỗi). */
async function handleInteraction(interaction, ctx) {
  if (!interaction.isChatInputCommand()) return false;
  const name = interaction.commandName;
  if (!['kick', 'ban', 'timeout', 'warn'].includes(name)) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const target = interaction.options.getMember('user') || interaction.options.getUser('user');
  const targetUser = target.user || target;
  const reason = interaction.options.getString('reason') || '(không có lý do)';
  const guild = interaction.guild;
  const me = guild.members.me;

  // không tự xử lý mình / owner / role cao hơn bot
  if (targetUser.id === interaction.user.id) {
    await interaction.editReply('Không tự áp dụng lên mình.');
    return true;
  }
  if (targetUser.id === guild.ownerId) {
    await interaction.editReply('Không đụng được owner server.');
    return true;
  }
  if (target.roles && target.roles.highest.comparePositionTo(me.roles.highest) >= 0) {
    await interaction.editReply('Role của người này bằng/cao hơn bot — không xử lý được.');
    return true;
  }

  try {
    if (name === 'kick') {
      if (!target.kick) {
        await interaction.editReply('Không tìm thấy thành viên trong server.');
        return true;
      }
      await target.kick(reason);
      await interaction.editReply(`✅ Đã kick ${targetUser}.\nLý do: ${reason}`);
      await logAction(ctx, interaction.guildId, '👢 Kick', 0xe67e22, interaction.user, targetUser, reason);
    } else if (name === 'ban') {
      await guild.members.ban(targetUser.id, { reason });
      await interaction.editReply(`✅ Đã ban ${targetUser}.\nLý do: ${reason}`);
      await logAction(ctx, interaction.guildId, '🔨 Ban', 0xe74c3c, interaction.user, targetUser, reason);
    } else if (name === 'timeout') {
      if (!target.timeout) {
        await interaction.editReply('Không tìm thấy thành viên trong server.');
        return true;
      }
      const minutes = interaction.options.getInteger('minutes');
      await target.timeout(minutes * 60_000, reason);
      await interaction.editReply(`✅ Đã timeout ${targetUser} **${minutes} phút**.\nLý do: ${reason}`);
      await logAction(
        ctx,
        interaction.guildId,
        '🔇 Timeout',
        0x9b59b6,
        interaction.user,
        targetUser,
        `${reason} (${minutes} phút)`
      );
    } else if (name === 'warn') {
      const total = await store.updateAsync(interaction.guildId, 'warns', (warns) => {
        const list = warns[targetUser.id] || [];
        list.push({ reason, by: interaction.user.id, at: new Date().toISOString() });
        warns[targetUser.id] = list;
        return list.length;
      });

      await interaction.editReply(`⚠️ Đã warn ${targetUser} (tổng **${total}** warn).\nLý do: ${reason}`);
      try {
        await targetUser.send(`⚠️ Bạn bị warn trong **${guild.name}** (tổng ${total}).\nLý do: ${reason}`);
      } catch {
        /* user chặn DM — bỏ qua */
      }
      await logAction(
        ctx,
        interaction.guildId,
        '⚠️ Warn',
        0xf1c40f,
        interaction.user,
        targetUser,
        `${reason} (tổng ${total})`
      );
    }
  } catch (err) {
    console.error(`Lỗi lệnh ${name}:`, err.message);
    await interaction.editReply(`❌ Lệnh thất bại: ${err.message}`);
  }
  return true;
}

async function logAction(ctx, guildId, title, color, moderator, targetUser, reason) {
  await sendLog(
    ctx,
    guildId,
    new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(`**Mod:** ${moderator}\n**Đối tượng:** ${targetUser}\n**Lý do:** ${reason}`)
      .setTimestamp()
  );
}

module.exports = {
  name: 'moderation',
  commands: [kickCmd, banCmd, timeoutCmd, warnCmd],
  handleInteraction,
};
