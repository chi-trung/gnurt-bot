// Welcome: auto-role 🌱 + embed chào trong #chào-mới khi có thành viên mới.
const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'welcome',
  events: [
    {
      name: Events.GuildMemberAdd,
      handler: async (ctx, member) => {
        // Cấu hình theo guild: server thứ hai có role/kênh riêng, không dùng
        // chung với server gốc.
        const cfg = ctx.cfg(member.guild.id);
        const newbieRoleId = cfg.roles.newbie;
        const welcomeChannelId = cfg.channels.welcome;

        if (newbieRoleId) {
          try {
            await member.roles.add(newbieRoleId);
          } catch (err) {
            console.error(`Không auto-role được ${member.user.tag}:`, err.message);
          }
        }

        if (welcomeChannelId) {
          try {
            const channel = await ctx.client.channels.fetch(welcomeChannelId);
            const embed = new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle('👋 Chào mừng mới!')
              .setDescription(
                `Chào mừng ${member} đến với **${member.guild.name}**!\n` +
                  `Bạn là thành viên thứ **${member.guild.memberCount}**.\n` +
                  `Đọc #quy-tắc và tự giới thiệu ở #giới-thiệu nhé.`
              )
              .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
              .setTimestamp();
            await channel.send({ embeds: [embed] });
          } catch (err) {
            console.error('Lỗi gửi welcome:', err.message);
          }
        }
      },
    },
  ],
};
