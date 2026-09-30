// Cấu hình theo từng guild: `config/guilds/<guildId>.json`.
//
// Bản single-guild đọc thẳng `ctx.env.*` — một bộ `*_CHANNEL_ID` / `*_ROLE_ID`
// dùng cho mọi server. Bot vào server thứ hai thì: log đổ vào #log-bot của
// server gốc, panel verify/ticket ghi đè lên panel của server gốc, và
// `ADMIN_ROLE_ID` của server gốc quyết định ai được duyệt gợi ý ở server hai.
// `guildconfig` là chỗ duy nhất được đọc `process.env`; module chỉ hỏi `cfg(guildId)`.
//
// Ba đường đi của `load(guildId)`:
//   1. Có `config/guilds/<id>.json`        → dùng file đó (đa server)
//   2. Không có, nhưng là guild gốc        → dựng từ `config.json` + `.env` (tương thích ngược)
//   3. Không có, là guild lạ               → shape đầy đủ, ids rỗng → module tự bỏ qua
//
// (3) cố ý KHÔNG fallback về `.env`: server thứ hai không có binding riêng thì
// đọc env của server gốc còn tệ hơn là không cấu hình — im lặng dùng nhầm id
// khó phát hiện hơn là báo "thiếu cấu hình" ngay lúc boot.
const fs = require('fs');
const path = require('path');
const baseConfig = require('../config');

const GUILD_DIR = process.env.GUARDIAN_CONFIG_DIR
  ? path.resolve(process.env.GUARDIAN_CONFIG_DIR)
  : path.join(__dirname, '..', '..', 'config', 'guilds');

const GUILD_ID_RE = /^\d{15,25}$/;

// env key -> đường dẫn trong file config. Đúng 11 binding mà
// scripts/migrate-to-multiguild.js ghi, giữ hai danh sách khớp nhau.
const BINDINGS = [
  ['WELCOME_CHANNEL_ID', 'channels.welcome'],
  ['TICKET_CHANNEL_ID', 'channels.ticket'],
  ['TICKET_CATEGORY_ID', 'channels.ticketCategory'],
  ['LOG_CHANNEL_ID', 'channels.log'],
  ['VERIFY_CHANNEL_ID', 'channels.verify'],
  ['STARBOARD_CHANNEL_ID', 'channels.starboard'],
  ['SUGGESTIONS_CHANNEL_ID', 'channels.suggestions'],
  ['NEWBIE_ROLE_ID', 'roles.newbie'],
  ['ADMIN_ROLE_ID', 'roles.admin'],
  ['VERIFY_ROLE_ID', 'roles.verify'],
  ['VERIFY_PENDING_ROLE_ID', 'roles.verifyPending'],
];

function getDeep(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setDeep(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Dựng config guild gốc từ `config.json` + `.env` — dùng khi chưa migrate.
 * `roles.admin` luôn là mảng (migrate cũng vậy) để caller chỉ có một kiểu.
 */
function fromEnv() {
  const cfg = { ...baseConfig.load(), channels: {}, roles: {} };
  for (const [envKey, dotted] of BINDINGS) {
    const val = process.env[envKey];
    if (!val) continue;
    setDeep(cfg, dotted, dotted === 'roles.admin' ? [val] : val);
  }
  return cfg;
}

/** Shape rỗng cho guild chưa cấu hình — module thấy thiếu id thì tự bỏ qua. */
function emptyConfig(guildId) {
  return { ...baseConfig.load(), guildId, channels: {}, roles: {}, configured: false };
}

function readFile(guildId) {
  const file = path.join(GUILD_DIR, `${guildId}.json`);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[guildconfig] ${file} hỏng JSON, bỏ qua: ${err.message}`);
    return undefined;
  }
}

// Cache để mỗi event không đọc lại file. `null` = đã biết là không có.
const cache = new Map();

/**
 * Config của 1 guild. Luôn trả object — không bao giờ null/undefined, để module
 * không phải guard ở mọi chỗ.
 *
 * File đọc lại được: sửa `config/guilds/<id>.json` rồi gọi `clear()` (hoặc
 * restart bot) là có hiệu lực.
 */
function load(guildId) {
  if (!guildId || !GUILD_ID_RE.test(String(guildId))) return emptyConfig(guildId);

  const key = String(guildId);
  if (cache.has(key)) return cache.get(key);

  const file = readFile(key);
  if (file && typeof file === 'object') {
    // `channels`/`roles` có thể thiếu nếu file cũ hoặc bị sửa tay — bù shape rỗng
    // để `cfg.channels.log` không ném TypeError.
    const merged = { ...emptyConfig(key), ...file, channels: file.channels || {}, roles: file.roles || {} };
    if (!Array.isArray(merged.roles.admin)) {
      merged.roles.admin = merged.roles.admin ? [merged.roles.admin] : [];
    }
    merged.configured = true;
    cache.set(key, merged);
    return merged;
  }

  const home = process.env.GUILD_ID;
  if (home && String(home) === key) {
    const cfg = fromEnv();
    cfg.guildId = key;
    cfg.configured = true;
    cache.set(key, cfg);
    return cfg;
  }

  console.warn(`[guildconfig] Guild ${key} chưa có config/guilds/${key}.json — module sẽ tự bỏ qua.`);
  const cfg = emptyConfig(key);
  cache.set(key, cfg);
  return cfg;
}

/** Xoá cache — gọi sau khi sửa file config, hoặc trong test. */
function clear() {
  cache.clear();
}

module.exports = { load, clear, BINDINGS, GUILD_DIR };
