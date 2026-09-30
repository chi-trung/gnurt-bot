// Nạp config.json (bật/tắt module + cấu hình automod), merge với defaults.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  modules: {
    welcome: true,
    verify: true,
    ticket: true,
    logging: true,
    automod: true,
    moderation: true,
    reactionroles: true,
    tags: true,
    starboard: true,
    suggestions: true,
  },
  automod: {
    invites: true,
    badwords: [],
    spam: { messages: 6, windowMs: 5000, timeoutSeconds: 300 },
    mentions: { max: 6 },
  },
  starboard: { threshold: 3, emoji: '⭐' },
};

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function load() {
  const p = path.join(__dirname, '..', 'config.json');
  let user = {};
  if (fs.existsSync(p)) {
    user = JSON.parse(fs.readFileSync(p, 'utf8'));
  } else {
    console.log('Không có config.json — dùng defaults');
  }
  return deepMerge(DEFAULTS, user);
}

module.exports = { load };
