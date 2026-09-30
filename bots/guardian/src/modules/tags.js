// Tags: trả lời nhanh bằng nội dung đã lưu — /tag create|delete|list|show.
// Storage: src/data/tags.json { name: content }.
// Root /tag visible cho mọi người; create/delete check ManageGuild trong code.
const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
} = require('discord.js');
const { sendLog } = require('../core/log');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TAGS_FILE = path.join(DATA_DIR, 'tags.json');

function loadTags() {
  try {
    const j = JSON.parse(fs.readFileSync(TAGS_FILE, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}
function saveTags(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TAGS_FILE, JSON.stringify(data, null, 2));
}

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
  // autocomplete cho tên tag
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== 'tag') return false;
    const focused = interaction.options.getFocused().toLowerCase();
    const names = Object.keys(loadTags())
      .filter((n) => n.startsWith(focused))
      .slice(0, 25)
      .map((n) => ({ name: n, value: n }));
    await interaction.respond(names);
    return true;
  }

  if (!interaction.isChatInputCommand() || interaction.commandName !== 'tag') return false;

  const sub = interaction.options.getSubcommand();
  const tags = loadTags();

  if (sub === 'list') {
    const names = Object.keys(tags);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`📚 Tag (${names.length})`)
          .setDescription(names.length ? names.map((n) => `\`${n}\``).join(', ') : 'Chưa có tag nào.'),
      ],
      ephemeral: true,
    });
    return true;
  }

  if (sub === 'show') {
    const name = interaction.options.getString('name').toLowerCase();
    const content = tags[name];
    if (!content) {
      await interaction.reply({ content: `Không có tag \`${name}\`. Dùng \`/tag list\` để xem.`, ephemeral: true });
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
    await interaction.reply({ content: 'Bạn cần quyền **Manage Server** để dùng lệnh này.', ephemeral: true });
    return true;
  }

  const name = interaction.options.getString('name').toLowerCase().trim();

  if (sub === 'create') {
    if (!NAME_RE.test(name)) {
      await interaction.reply({
        content: 'Tên tag chỉ được dùng a-z, 0-9, `-`, tối đa 50 ký tự.',
        ephemeral: true,
      });
      return true;
    }
    const content = interaction.options.getString('content');
    if (content.length > 2000) {
      await interaction.reply({ content: 'Nội dung tối đa 2000 ký tự.', ephemeral: true });
      return true;
    }
    if (tags[name]) {
      await interaction.reply({ content: `Tag \`${name}\` đã tồn tại — dùng \`/tag delete\` trước nếu muốn thay.`, ephemeral: true });
      return true;
    }
    tags[name] = content;
    saveTags(tags);
    await interaction.reply({ content: `✅ Đã tạo tag \`${name}\`.`, ephemeral: true });
    await sendLog(
      ctx,
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
      await interaction.reply({ content: `Không có tag \`${name}\`.`, ephemeral: true });
      return true;
    }
    delete tags[name];
    saveTags(tags);
    await interaction.reply({ content: `🗑️ Đã xóa tag \`${name}\`.`, ephemeral: true });
    await sendLog(
      ctx,
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
