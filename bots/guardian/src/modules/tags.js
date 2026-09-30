// Tags: trả lời nhanh bằng nội dung đã lưu — /tag create|delete|list|show.
// Storage: core/store → data/guilds/<guildId>/tags.json { name: content }.
// Mỗi server một namespace tag riêng: tag `rules` của server này không tự động
// xuất hiện ở server khác.
// Root /tag visible cho mọi người; create/delete check ManageGuild trong code.
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');
const { sendLog } = require('../core/log');
const store = require('../core/store');

const NAME_RE = /^[a-z0-9\-]{1,50}$/;

const tagCommand = new SlashCommandBuilder()
  .setName('tag')
  .setDescription('Thẻ trả lời nhanh')
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Tạo tag (cần Manage Server)')
      .addStringOption((o) =>
        o.setName('name').setDescription('Tên tag (a-z, 0-9, -, tối đa 50)').setRequired(true)
      )
      .addStringOption((o) => o.setName('content').setDescription('Nội dung').setRequired(true))
  )
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Xóa tag (cần Manage Server)')
      .addStringOption((o) => o.setName('name').setDescription('Tên tag').setRequired(true))
  )
  .addSubcommand((s) => s.setName('list').setDescription('Liệt kê tất cả tag'))
  .addSubcommand((s) =>
    s
      .setName('show')
      .setDescription('Xem/gọi một tag')
      .addStringOption((o) => o.setName('name').setDescription('Tên tag').setRequired(true).setAutocomplete(true))
  );

function canManage(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function handleInteraction(interaction, ctx) {
  const guildId = interaction.guildId;

  // autocomplete cho tên tag
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== 'tag') return false;
    const focused = interaction.options.getFocused().toLowerCase();
    const names = Object.keys(store.read(guildId, 'tags'))
      .filter((n) => n.startsWith(focused))
      .slice(0, 25)
      .map((n) => ({ name: n, value: n }));
    await interaction.respond(names);
    return true;
  }

  if (!interaction.isChatInputCommand() || interaction.commandName !== 'tag') return false;

  const sub = interaction.options.getSubcommand();
  const tags = store.read(guildId, 'tags');

  if (sub === 'list') {
    const names = Object.keys(tags);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`📚 Tag (${names.length})`)
          .setDescription(names.length ? names.map((n) => `\`${n}\``).join(', ') : 'Chưa có tag nào.'),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (sub === 'show') {
    const name = interaction.options.getString('name').toLowerCase();
    const content = tags[name];
    if (!content) {
      await interaction.reply({ content: `Không có tag \`${name}\`. Dùng \`/tag list\` để xem.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply({
      embeds: [
        new EmbedBuilder().setColor(0x2ecc71).setDescription(content).setFooter({ text: `tag: ${name}` }),
      ],
    });
    return true;
  }

  // create / delete — cần Manage Server
  if (!canManage(interaction)) {
    await interaction.reply({ content: 'Bạn cần quyền **Manage Server** để dùng lệnh này.', flags: MessageFlags.Ephemeral });
    return true;
  }

  // `list` không có option `name`; subcommand lạ cũng có thể tới đây. Guard trước
  // khi .toLowerCase() để trả về false (bỏ qua interaction) thay vì throw.
  const rawName = interaction.options.getString('name');
  if (rawName === null || rawName === undefined) return false;
  const name = rawName.toLowerCase().trim();

  if (sub === 'create') {
    if (!NAME_RE.test(name)) {
      await interaction.reply({
        content: 'Tên tag chỉ được dùng a-z, 0-9, `-`, tối đa 50 ký tự.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const content = interaction.options.getString('content');
    if (content.length > 2000) {
      await interaction.reply({ content: 'Nội dung tối đa 2000 ký tự.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (tags[name]) {
      await interaction.reply({ content: `Tag \`${name}\` đã tồn tại — dùng \`/tag delete\` trước nếu muốn thay.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    await store.updateAsync(guildId, 'tags', (t) => {
      t[name] = content;
    });
    await interaction.reply({ content: `✅ Đã tạo tag \`${name}\`.`, flags: MessageFlags.Ephemeral });
    await sendLog(
      ctx,
      guildId,
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('🏷️ Tag mới')
        .setDescription(`**Tên:** \`${name}\`\n**Người tạo:** ${interaction.user}`)
        .setTimestamp()
    );
    return true;
  }

  if (sub === 'delete') {
    if (!tags[name]) {
      await interaction.reply({ content: `Không có tag \`${name}\`.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    await store.updateAsync(guildId, 'tags', (t) => {
      delete t[name];
    });
    await interaction.reply({ content: `🗑️ Đã xóa tag \`${name}\`.`, flags: MessageFlags.Ephemeral });
    await sendLog(
      ctx,
      guildId,
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏷️ Tag bị xóa')
        .setDescription(`**Tên:** \`${name}\`\n**Người xóa:** ${interaction.user}`)
        .setTimestamp()
    );
    return true;
  }

  return false;
}

module.exports = {
  name: 'tags',
  commands: [tagCommand],
  handleInteraction,
};
