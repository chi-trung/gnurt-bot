// Guardian — multi-bot core: load module, đăng ký lệnh chung, dispatch interaction.
// Mỗi module tự khai báo { name, commands[], events[], init(), handleInteraction() }.
// Module lỗi bị bỏ qua (isolation) — không kéo sập cả bot.
require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Events, REST, Routes, MessageFlags } = require('discord.js');
const configStore = require('./config');

const {
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  WELCOME_CHANNEL_ID,
  NEWBIE_ROLE_ID,
  TICKET_CHANNEL_ID,
  LOG_CHANNEL_ID,
} = process.env;

// Validate biến bắt buộc sớm — fail-fast thay vì login rồi mới lộ lỗi thiếu config
const required = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'GUILD_ID',
  'WELCOME_CHANNEL_ID',
  'NEWBIE_ROLE_ID',
  'TICKET_CHANNEL_ID',
  'LOG_CHANNEL_ID',
];
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
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction], // reaction/message không cache vẫn xử lý được
});

const ctx = { client, config, env: process.env };

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

  try {
    const rest = new REST().setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`Đã đăng ký ${commands.length} lệnh: ${commands.map((x) => '/' + x.name).join(', ')}`);
  } catch (err) {
    console.error('Lỗi đăng ký slash command:', err);
  }

  for (const m of loaded) {
    if (!m.init) continue;
    try {
      await m.init(ctx);
      console.log(`Module ${m.name}: init xong`);
    } catch (err) {
      console.error(`Lỗi init module ${m.name}:`, err);
    }
  }
});

client.login(DISCORD_TOKEN);
