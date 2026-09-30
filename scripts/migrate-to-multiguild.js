// Gộp dữ liệu single-guild (file phẳng) + config vào cấu trúc theo guild.
//
//   node scripts/migrate-to-multiguild.js              # dry-run — chỉ in kế hoạch
//   node scripts/migrate-to-multiguild.js --apply      # thực thi
//
// KHÔNG gọi Discord API. Không tự chọn giá trị khi có va chạm — phần chỉ có ở
// nguồn được tách ra `<dest>.legacy-unmerged.json` kèm số lượng, để người quyết
// định. Ba cổng chống chạy lại:
//   1. file đích đã tồn tại            -> in "đã migrate", không đụng
//   2. nguồn bị `rename` thành `.migrated.bak` (KHÔNG xoá)
//   3. marker `schema: 2` trong file đích
//
// Phase 2/6: `config/guilds/<id>.json` được git track (chứa 9 role rank + 8
// binding), `src/data/guilds/<id>/` bị .gitignore loại (state lúc chạy).
const fs = require('fs');
const path = require('path');

// Ghim gốc để test chạy trên thư mục tạm thay vì dữ liệu thật. Không set thì
// hành vi y hệt chạy tay — biến này chỉ tồn tại cho `test-migration.js`.
const ROOT = process.env.GUARDIAN_MIGRATE_ROOT
  ? path.resolve(process.env.GUARDIAN_MIGRATE_ROOT)
  : path.join(__dirname, '..');
const GUARD = path.join(ROOT, 'bots/guardian');
const DATA = path.join(GUARD, 'src/data');
const GUILD_DIR = path.join(GUARD, 'config/guilds');

const SCHEMA = 2;
const APPLY = process.argv.includes('--apply');

// --- store: phải khớp `src/core/store.js`, kèm marker schema để lần sau biết đã gộp
const FALLBACK = {
  levels: () => ({}),
  warns: () => ({}),
  rr: () => [],
  starboard: () => ({}),
  suggestions: () => ({}),
  tags: () => ({}),
  'verify-panel': () => null,
  'ticket-panel': () => null,
};
// Thứ tự = thứ tự bảng kế hoạch. `ticket-panel` không có nguồn (bản cũ quét 20 tin
// gần nhất, không lưu id) — nhưng bot đã chạy Phase 1 và đã tạo file này, nên
// nếu có thì copy, không thì để `null` cho `ensurePanel` tự dò.
const STORES = ['levels', 'warns', 'rr', 'starboard', 'suggestions', 'tags', 'verify-panel', 'ticket-panel'];

/**
 * `.env` -> object. KHÔNG log giá trị của DISCORD_TOKEN/CLIENT_ID ở bất kỳ
 * chỗ nào — chỉ in tên biến. `split('=')` giữ nguyên phần sau dấu = để token
 * dạng `BotName <token>` (không có =) không bị cắt sai.
 */
function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

/** 8 binding: key trong config mới <- biến .env. 7 trong số nằm ở `.env`. */
const BINDINGS = [
  ['channels.welcome', 'WELCOME_CHANNEL_ID'],
  ['roles.newbie', 'NEWBIE_ROLE_ID'],
  ['channels.ticket', 'TICKET_CHANNEL_ID'],
  ['channels.ticketCategory', 'TICKET_CATEGORY_ID'],
  ['channels.log', 'LOG_CHANNEL_ID'],
  ['roles.admin', 'ADMIN_ROLE_ID'],
  ['channels.verify', 'VERIFY_CHANNEL_ID'],
  ['channels.starboard', 'STARBOARD_CHANNEL_ID'],
  ['channels.suggestions', 'SUGGESTIONS_CHANNEL_ID'],
];
// Riêng verify còn 2 role: pending + role xác nhận — không nằm trong danh sách 8
// binding của plan vì chúng đi kèm `channels.verify`, nhưng thiếu thì gate
// không hoạt động. Ghi riêng để không bị sót.
const VERIFY_ROLES = [
  ['roles.verify', 'VERIFY_ROLE_ID'],
  ['roles.verifyPending', 'VERIFY_PENDING_ROLE_ID'],
];

function setDeep(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function readJsonFile(f) {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return undefined;
  }
}

/** File đích đã có `schema: 2` -> lần migrate trước đã chạy. */
function alreadyMigrated(f) {
  const v = readJsonFile(f);
  return v !== undefined && v && v.schema === SCHEMA;
}

/** Nội dung file phẳng có dữ liệu thật không (so với fallback rỗng). */
function hasContent(name, v) {
  const fb = FALLBACK[name]();
  if (fb === null) return Boolean(v && (v.channelId || v.messageId));
  if (Array.isArray(fb)) return Array.isArray(v) && v.length > 0;
  return v !== null && typeof v === 'object' && Object.keys(v).length > 0;
}

function countOf(name, v) {
  if (v === null || v === undefined) return 0;
  if (Array.isArray(v)) return v.length;
  return Object.keys(v).length;
}

// --- plan -------------------------------------------------------------------

const env = readEnv(path.join(GUARD, '.env'));
const configJson = readJsonFile(path.join(GUARD, 'config.json')) || {};
const GUILD_ID = env.GUILD_ID;

if (!/^\d{15,25}$/.test(String(GUILD_ID || ''))) {
  console.error('Thiếu/sai GUILD_ID trong .env — cần id 15–25 chữ số để biết migrate cho guild nào.');
  process.exit(1);
}

const destDir = path.join(DATA, 'guilds', GUILD_ID);
const plan = []; // { store, src, dest, action, note }

// 1. State: file phẳng -> file theo guild
for (const name of STORES) {
  const src = path.join(DATA, `${name}.json`);
  const dest = path.join(destDir, `${name}.json`);
  const srcVal = readJsonFile(src);
  const destVal = readJsonFile(dest);

  if (!fs.existsSync(src)) {
    plan.push({ store: name, dest, action: 'skip', note: 'không có file nguồn' });
    continue;
  }
  if (alreadyMigrated(dest)) {
    plan.push({ store: name, dest, action: 'done', note: 'đã migrate (schema:2)' });
    continue;
  }
  if (destVal !== undefined && srcVal !== undefined) {
    // Cả hai đều có dữ liệu: KHÔNG tự chọn, KHÔNG ghi đè. Báo cáo đủ 3 nhóm để
    // người quyết định — khoá chỉ có ở nguồn, khoá chỉ có ở đích, và khoá có ở
    // cả hai nhưng GIÁ TRỊ khác. Nhóm cuối mới là chỗ dễ bỏ sót: cùng key,
    // nên script cũ báo "0 mục chỉ ở nguồn" và trông như không có gì để xử lý,
    // trong khi thực tế XP đang lệch.
    const onlyInSource = {};
    const onlyInDest = {};
    const valueDiff = {};
    const srcIsArr = Array.isArray(srcVal);
    if (srcIsArr || Array.isArray(destVal)) {
      const a = srcIsArr ? srcVal : [];
      const b = Array.isArray(destVal) ? destVal : [];
      const keyOf = (x) => (x && (x.id || x.messageId)) || JSON.stringify(x);
      const bKeys = new Set(b.map(keyOf));
      const aKeys = new Set(a.map(keyOf));
      const srcOnly = a.filter((x) => !bKeys.has(keyOf(x)));
      const destOnly = b.filter((x) => !aKeys.has(keyOf(x)));
      const changed = a.filter((x) => bKeys.has(keyOf(x)) &&
        JSON.stringify(x) !== JSON.stringify(b.find((y) => keyOf(y) === keyOf(x))));
      if (srcOnly.length) onlyInSource.items = srcOnly;
      if (destOnly.length) onlyInDest.items = destOnly;
      if (changed.length) valueDiff.items = changed;
    } else {
      const s = srcVal || {};
      const d = destVal || {};
      for (const [k, v] of Object.entries(s)) {
        if (!(k in d)) onlyInSource[k] = v;
        else if (JSON.stringify(v) !== JSON.stringify(d[k])) valueDiff[k] = { source: v, dest: d[k] };
      }
      for (const k of Object.keys(d)) if (!(k in s)) onlyInDest[k] = d[k];
    }
    const nSrc = Object.keys(onlyInSource).length;
    const nDest = Object.keys(onlyInDest).length;
    const nDiff = Object.keys(valueDiff).length;
    const extra = {};
    if (nSrc) extra.onlyInSource = onlyInSource;
    if (nDiff) extra.valueDiffers = valueDiff;
    const extraFile = nSrc || nDiff ? `${dest}.legacy-unmerged.json` : null;
    plan.push({
      store: name,
      src,
      dest,
      action: 'conflict',
      counts: { src: countOf(name, srcVal), dest: countOf(name, destVal) },
      nSrc,
      nDest,
      nDiff,
      extraFile,
      extra,
      note: `nguồn ${countOf(name, srcVal)} mục, đích ${countOf(name, destVal)} mục`,
    });
    continue;
  }
  if (!hasContent(name, srcVal)) {
    plan.push({ store: name, dest, action: 'skip', note: 'file rỗng (chỉ có fallback)' });
    continue;
  }
  plan.push({
    store: name,
    src,
    dest,
    action: 'copy',
    count: countOf(name, srcVal),
    note: name === 'verify-panel'
      ? 'copy NGUYÊN BYTE — verify.init tự kiểm panel còn sống, tạo lại nếu chết'
      : name === 'ticket-panel'
        ? 'bản cũ không lưu id panel; copy nếu bot Phase 1 đã tạo'
        : 'chuyển sang thư mục guild',
  });
}

// 2. Config: config.json + .env -> config/guilds/<id>.json
const cfgDest = path.join(GUILD_DIR, `${GUILD_ID}.json`);
const cfgDone = alreadyMigrated(cfgDest);
const cfg = { ...configJson };
cfg.schema = SCHEMA;
cfg.guildId = GUILD_ID;
cfg.modules = cfg.modules || {};

const bindingRows = [];
for (const [dotted, envKey] of [...BINDINGS, ...VERIFY_ROLES]) {
  const val = env[envKey];
  if (val === undefined) {
    bindingRows.push({ dotted, envKey, status: 'THIẾU trong .env', value: null });
    continue;
  }
  if (!val) {
    bindingRows.push({ dotted, envKey, status: 'rỗng — để bot không bật', value: null });
    continue;
  }
  setDeep(cfg, dotted, val);
  bindingRows.push({ dotted, envKey, status: 'ok', value: val });
}
cfg.roles = cfg.roles || {};
cfg.roles.admin = Array.isArray(cfg.roles.admin) ? cfg.roles.admin : cfg.roles.admin ? [cfg.roles.admin] : [];
cfg.configured = true;

// --- in kế hoạch ------------------------------------------------------------

const line = '─'.repeat(74);
console.log(`\nMIGRATE GUARDIAN → MULTI-GUILD${APPLY ? '  (--apply)' : '  (dry-run — KHÔNG ghi gì)'}`);
console.log(`guild: ${GUILD_ID}`);
console.log(line);
console.log('\nSTATE  src/data/*.json  →  src/data/guilds/' + GUILD_ID + '/');
console.log(line);
for (const p of plan) {
  const tag = { copy: 'COPY   ', done: 'ĐÃ CÓ  ', skip: 'bỏ qua ', conflict: 'XUNG ĐỘT' }[p.action];
  console.log(`${tag} ${p.store.padEnd(14)} ${p.note}`);
  if (p.action === 'copy') console.log(`         → ${p.dest}${p.count !== undefined ? `  (${p.count} mục)` : ''}`);
  if (p.action === 'conflict') {
    const parts = [];
    if (p.nSrc) parts.push(`${p.nSrc} chỉ ở file phẳng`);
    if (p.nDiff) parts.push(`${p.nDiff} có ở cả hai nhưng GIÁ TRỊ KHÁC`);
    if (p.nDest) parts.push(`${p.nDest} chỉ ở thư mục guild`);
    console.log(`         ⚠ ${parts.join(' · ') || 'hai file giống nhau hoàn toàn'}`);
    console.log(`         → giữ nguyên cả hai, KHÔNG tự gộp (đặc biệt: không tự lấy max)`);
    if (p.extraFile) {
      console.log(`         → phần cần xem tách ra: ${p.extraFile}`);
    }
  }
}

console.log(`\nCONFIG  .env + config.json  →  config/guilds/${GUILD_ID}.json`);
console.log(line);
if (cfgDone) console.log('ĐÃ CÓ  config đích đã có schema:2 — sẽ KHÔNG ghi lại (chống chạy lại)\n');
for (const r of bindingRows) {
  const mark = r.status === 'ok' ? 'ok  ' : '⚠   ';
  // Không in DISCORD_TOKEN/CLIENT_ID — chúng không nằm trong danh sách này,
  // nhưng chốt chặn phòng khi ai đó thêm binding sau này.
  const shown = /TOKEN|SECRET|PASSWORD/i.test(r.envKey) ? '<không in>' : r.value;
  console.log(`${mark} ${r.envKey.padEnd(26)} → ${r.dotted.padEnd(26)} ${r.status}${r.value ? ` = ${shown}` : ''}`);
}
const rankCount = (configJson.levels?.roles || []).length;
console.log(`\n  config.json giữ nguyên verbatim: levels.roles (${rankCount} role rank), automod, modules`);
console.log(`  roles.admin đóng thành mảng: [${cfg.roles.admin.join(', ')}]`);

if (!APPLY) {
  console.log(`\n${line}`);
  console.log('DRY-RUN: chưa ghi gì. Kiểm bảng trên, chạy lại với --apply để thực thi.');
  console.log(line + '\n');
  process.exit(0);
}

// --- apply ------------------------------------------------------------------

console.log(`\n${line}`);
console.log('APPLY');
console.log(line);

fs.mkdirSync(destDir, { recursive: true });
let copied = 0;

for (const p of plan) {
  if (p.action === 'copy') {
    // Copy NGUYÊN BYTE — không parse/stringify lại. `verify-panel.json` giữ đúng
    // id tin; stringify lại có thể đổi thứ tự key, mà lần parse sau vẫn ra cùng
    // object nên về mặt dữ liệu là tương đương — nhưng byte-identical giúp đối
    // chiếu trong test và giữ nguyên định dạng người đã viết tay.
    fs.copyFileSync(p.src, p.dest);
    // Nguồn KHÔNG xoá: đổi tên thành .migrated.bak để bot không đọc nhầm nữa,
    // vẫn còn để quay lui.
    fs.renameSync(p.src, `${p.src}.migrated.bak`);
    console.log(`  copy   ${p.store.padEnd(14)} → ${p.dest}`);
    copied++;
  } else if (p.action === 'conflict') {
    if (p.extraFile) {
      fs.writeFileSync(p.extraFile, JSON.stringify(p.extra, null, 2), 'utf8');
      console.log(`  ⚠ XUNG ĐỘT ${p.store.padEnd(14)} → ${p.extraFile} (cần người quyết định)`);
    }
    console.log(`  ⚠ XUNG ĐỘT ${p.store.padEnd(14)} giữ nguyên cả hai, KHÔNG ghi đè, KHÔNG xoá nguồn`);
  }
}

let wroteCfg = false;
if (cfgDone) {
  console.log(`  bỏ qua config/guilds/${GUILD_ID}.json — đã có schema:2, không ghi đè`);
} else {
  fs.mkdirSync(GUILD_DIR, { recursive: true });
  fs.writeFileSync(cfgDest, JSON.stringify(cfg, null, 2), 'utf8');
  console.log(`  write  config/guilds/${GUILD_ID}.json`);
  wroteCfg = true;
}

console.log(`\nXong: ${copied} file state, ${wroteCfg ? 1 : 0} file config.`);

// Khối revert — sinh từ chính những gì vừa chạy, không phải viết tay.
const reverted = plan.filter((p) => p.action === 'copy');
const conflicts = plan.filter((p) => p.action === 'conflict' && p.extraFile);
console.log(`\n${line}`);
console.log('REVERT (nếu cần — chạy đúng thứ tự này):');
for (const p of reverted) {
  console.log(`  mv "${p.dest}" "${p.src}"`);
}
if (wroteCfg) console.log(`  rm "${cfgDest}"`);
for (const p of conflicts) {
  console.log(`  # xung đột: file phẳng "${p.src}" VẪN CÒN — xem ${p.extraFile} rồi tự quyết định, KHÔNG xoá tự động`);
}
// `rmdir` (không phải `rm -rf`): chỉ xoá được khi thư mục rỗng. Nếu còn file
// nào khác — ví dụ guild khác đã dùng — lệnh fail thay vì xoá sạch.
console.log(`  rmdir "${destDir}"  # chỉ chạy được khi thư mục rỗng; fail thay vì xoá cả thư mục guilds/`);
console.log(`${line}\n`);
