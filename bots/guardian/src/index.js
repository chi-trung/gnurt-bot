// Guardian — multi-bot core: load module, đăng ký lệnh chung, dispatch interaction.
// Mỗi module tự khai báo { name, commands[], events[], init(), handleInteraction() }.
// Module lỗi bị bỏ qua (isolation) — không kéo sập cả bot.
require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Events, REST, Routes, MessageFlags } = require('discord.js');
const configStore = require('./config');
const guildConfig = require('./core/guildconfig');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

// Validate biến bắt buộc sớm — fail-fast thay vì login rồi mới lộ lỗi thiếu config.
// Sau khi migrate, các `*_CHANNEL_ID`/`*_ROLE_ID` nằm trong `config/guilds/<id>.json`
// chứ không phải `.env` → chỉ còn 3 biến này là bắt buộc ở mọi guild.
const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Thiếu biến môi trường: ${missing.join(', ')} (kiểm tra file .env)`);
  process.exit(1);
}

const config = configStore.load();

// --- load modules (isolation: lỗi 1 module không giết bot) ---
const MODULE_PATHS = [
  './modules/welcome',
  './modules/verify',
  './modules/ticket',
  './modules/logging',
  './modules/automod',
  './modules/moderation',
  './modules/reactionroles',
  './modules/tags',
  './modules/starboard',
  './modules/suggestions',
  './modules/levels',
];
const loaded = [];
for (const p of MODULE_PATHS) {
  try {
    const m = require(p);
    if (config.modules[m.name] === false) {
      console.log(`Module ${m.name}: TẮT (config.json)`);
      continue;
    }
    loaded.push(m);
    console.log(`Module ${m.name}: OK`);
  } catch (err) {
    console.error(`Module ${p} load lỗi — bỏ qua:`, err);
  }
}
if (!loaded.length) {
  console.error('Không module nào được load — thoát.');
  process.exit(1);
}

// --- client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // cần bật MESSAGE CONTENT INTENT ở Portal
    GatewayIntentBits.GuildMessageReactions, // reaction-roles
    GatewayIntentBits.GuildVoiceStates, // levels: XP theo thời gian nghe voice
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction], // reaction/message không cache vẫn xử lý được
});

// `cfg(guildId)` = config riêng của server đó. Module CHỈ dùng `ctx.cfg(...)`,
// không đọc `ctx.env` — `env` giữ lại cho code đọc bot-wide (token, client id).
const ctx = { client, config, env: process.env, cfg: guildConfig.load };

// --- events ---
for (const m of loaded) {
  for (const ev of m.events || []) {
    client.on(ev.name, (...args) => {
      Promise.resolve(ev.handler(ctx, ...args)).catch((err) =>
        console.error(`Lỗi event ${ev.name} (module ${m.name}):`, err)
      );
    });
  }
}

// --- interactions: hỏi từng module, module nào "ăn" thì dừng ---
client.on(Events.InteractionCreate, (interaction) => {
  (async () => {
    for (const m of loaded) {
      if (!m.handleInteraction) continue;
      try {
        if (await m.handleInteraction(interaction, ctx)) return;
      } catch (err) {
        console.error(`Lỗi module ${m.name} interaction:`, err);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: '❌ Có lỗi khi xử lý.', flags: MessageFlags.Ephemeral });
          }
        } catch {
          /* đã reply rồi — bỏ qua */
        }
        return;
      }
    }
  })().catch((err) => console.error('Lỗi InteractionCreate:', err));
});

// --- ready: deploy lệnh + init modules ---
client.once(Events.ClientReady, async (c) => {
  console.log(`Guardian online: ${c.user.tag}`);

  const commands = loaded.flatMap((m) => (m.commands || []).map((cmd) => cmd.toJSON()));

  // Đăng ký lệnh GLOBAL (`applicationCommands`), không phải theo guild.
  //
  // Guild-scoped có lệnh hiện nhanh hơn (~1s vs ~1h) nhưng bị Discord giới hạn
  // 100 guild — vượt ngưỡng là phải đổi lại kiến trúc giữa chừng rồi xoá lệnh ở
  // 100 guild cũ. Global có trần 2000 guild nên không có ngõ cụt. Đổi lại độ
  // trễ ~1h, và ta chỉ trả độ trễ đó khi lệnh thay đổi LÚC bot vừa vào server
  // — lệnh của bot gần như không đổi nên gần như không phải chịu.
  //
  // LÁCH KHI DEV SỬA LỆNH (độ trễ ~1h rất khó chịu): PUT tạm vào guild nhà,
  // `client.guilds.cache.get(GUILD_ID).id`, để test tức thì. NHƯNG phải bỏ dòng
  // đó trước khi deploy thật — để cả hai cùng lúc thì lệnh guild-scoped của
  // server nhà sẽ CHE lệnh global ở chính server đó.
  const rest = new REST().setToken(DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`Đã đăng ký ${commands.length} lệnh (global)`);
  } catch (err) {
    console.error('Lỗi đăng ký slash command:', err);
  }
  if (commands.length) {
    console.log(`Danh sách lệnh: ${commands.map((x) => '/' + x.name).join(', ')}`);
  }

  // Mỗi guild một vòng init riêng: module đọc state theo guildId nên `init`
  // phải biết đang khởi tạo cho server nào. Module lỗi ở server này không
  // được làm hỏng server khác — vòng lặp bọc try/catch từng guild.
  for (const guild of c.guilds.cache.values()) {
    for (const m of loaded) {
      if (!m.init) continue;
      try {
        await m.init(ctx, guild.id);
        console.log(`Module ${m.name} [${guild.id}]: init xong`);
      } catch (err) {
        console.error(`Lỗi init module ${m.name} [${guild.id}]:`, err);
      }
    }
  }
});

client.login(DISCORD_TOKEN);
