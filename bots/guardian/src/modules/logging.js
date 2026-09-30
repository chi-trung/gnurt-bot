// Logging: ghi vào #log-bot — tin xóa/sửa, vào/ra server, đổi role/ biệt danh.
const { Events, EmbedBuilder } = require('discord.js');
const { sendLog } = require('../core/log');

module.exports = {
  name: 'logging',
  events: [
    {
      name: Events.MessageDelete,
      handler: async (ctx, message) => {
        if (!message.guild) return;
        const parts = [`Kênh: ${message.channel}`];
        if (message.author) parts.push(`Tác giả: ${message.author}`);
        if (message.content) parts.push(`Nội dung: \`${message.content.slice(0, 500)}\``);
        if (message.attachments.size) parts.push(`Tệp: ${message.attachments.size} attachment(s)`);
        await sendLog(
          ctx,
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('🗑️ Tin nhắn bị xóa')
            .setDescription(parts.join('\n'))
            .setTimestamp()
        );
      },
    },
    {
      name: Events.MessageUpdate,
      handler: async (ctx, oldMessage, newMessage) => {
        if (!newMessage.guild || newMessage.author?.bot) return;
        const parts = [`Kênh: ${newMessage.channel}`, `Tác giả: ${newMessage.author}`];
        if (oldMessage.content && oldMessage.content !== newMessage.content) {
          parts.push(`Cũ: \`${oldMessage.content.slice(0, 300)}\``);
          parts.push(`Mới: \`${newMessage.content.slice(0, 300)}\``);
        }
        parts.push(`[Nhảy tới](${newMessage.url})`);
        await sendLog(
          ctx,
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('✏️ Tin nhắn bị sửa')
            .setDescription(parts.join('\n'))
            .setTimestamp()
        );
      },
    },
    {
      name: Events.GuildMemberAdd,
      handler: async (ctx, member) => {
        await sendLog(
          ctx,
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('📥 Vào server')
            .setDescription(`${member} (${member.user.tag})\nThành viên thứ ${member.guild.memberCount}`)
            .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
            .setTimestamp()
        );
      },
    },
    {
      name: Events.GuildMemberRemove,
      handler: async (ctx, member) => {
        await sendLog(
          ctx,
          new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('📤 Rời server')
            .setDescription(`${member.user} (${member.user.tag})`)
            .setThumbnail(member.user.displayAvatarURL({ size: 128 }))
            .setTimestamp()
        );
      },
    },
    {
      name: Events.GuildMemberUpdate,
      handler: async (ctx, oldMember, newMember) => {
        const changes = [];

        if (oldMember.nickname !== newMember.nickname) {
          changes.push(
            `Biệt danh: \`${oldMember.nickname || oldMember.user.username}\` → \`${newMember.nickname || newMember.user.username}\``
          );
        }

        const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
        const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
        if (added.size) changes.push(`Thêm role: ${added.map((r) => r).join(', ')}`);
        if (removed.size) changes.push(`Gỡ role: ${removed.map((r) => r).join(', ')}`);

        if (!changes.length) return;
        await sendLog(
          ctx,
          new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle('👤 Thành viên thay đổi')
            .setDescription(`${newMember}\n${changes.join('\n')}`)
            .setTimestamp()
        );
      },
    },
  ],
};
