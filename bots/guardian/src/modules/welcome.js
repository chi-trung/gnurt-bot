// Welcome: auto-role 🌱 + embed chào trong #chào-mới khi có thành viên mới.
const { Events, EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'welcome',
  events: [
    {
      name: Events.GuildMemberAdd,
      handler: async (ctx, member) => {
        const { NEWBIE_ROLE_ID, WELCOME_CHANNEL_ID } = ctx.env;

        if (NEWBIE_ROLE_ID) {
          try {
            await member.roles.add(NEWBIE_ROLE_ID);
          } catch (err) {
            console.error(`Không auto-role được ${member.user.tag}:`, err.message);
          }
        }

        if (WELCOME_CHANNEL_ID) {
          try {
            const channel = await ctx.client.channels.fetch(WELCOME_CHANNEL_ID);
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
