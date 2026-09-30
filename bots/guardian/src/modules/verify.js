// Verify gate: panel nút trong #xác-nhận → nhận ✅ Đã xác nhận, gỡ ⏳ Chờ xác nhận.
// Nếu cấu hình `roles.verifyPending`: thành viên mới vào server bị gán role chờ.
// Thiếu `channels.verify` / `roles.verify` → module tự bỏ qua (không kill bot).
//
// Panel lưu theo guild: data/guilds/<guildId>/verify-panel.json. `init` nhận
// `guildId` vì mỗi server một kênh xác nhận riêng — bản single-guild để một
// panel phẳng nên server thứ hai sẽ dùng lại (và đè) panel của server gốc.
const {
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { sendLog } = require('../core/log');
const store = require('../core/store');

/** Id verify của 1 guild. `pendingId` null thì không gán/gỡ role chờ. */
function idsOf(ctx, guildId) {
  const cfg = ctx.cfg(guildId);
  return {
    channelId: cfg.channels.verify,
    roleId: cfg.roles.verify,
    pendingId: cfg.roles.verifyPending || null,
  };
}

async function init(ctx, guildId) {
  const { channelId, roleId } = idsOf(ctx, guildId);
  if (!channelId || !roleId) {
    console.log(`Verify [${guildId}]: thiếu channels.verify/roles.verify — bỏ qua panel`);
    return;
  }

  // Panel đã tồn tại thì dùng lại (tránh spam mỗi lần restart)
  const saved = store.read(guildId, 'verify-panel');
  if (saved && saved.channelId === channelId) {
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
  store.write(guildId, 'verify-panel', { channelId: msg.channelId, messageId: msg.id });
  console.log(`Verify [${guildId}]: đã tạo panel mới`);
}

async function handleInteraction(interaction, ctx) {
  if (!interaction.isButton() || interaction.customId !== 'verify:agree') return false;

  const { roleId, pendingId } = idsOf(ctx, interaction.guildId);
  if (!roleId) {
    await interaction.reply({
      content: '⚠️ Module xác nhận chưa được cấu hình cho server này.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

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
      interaction.guildId,
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
        const { pendingId } = idsOf(ctx, member.guild.id);
        if (!pendingId || member.user.bot) return;
        try {
          await member.roles.add(pendingId);
        } catch (err) {
          console.error(`Verify [${member.guild.id}]: không gán được role chờ:`, err.message);
        }
      },
    },
  ],
};
