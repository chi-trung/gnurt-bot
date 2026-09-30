// Tầng lưu trữ theo guild. Mọi state chạy được nằm ở
//   <GUARDIAN_DATA_DIR>/guilds/<guildId>/<name>.json
//
// Vì sao cần tầng này thay vì mỗi module tự `readFileSync`/`writeFileSync`:
//   1. Khoá theo guild. Bản single-guild dùng file phẳng khoá theo `userId` —
//      cùng một người ở 2 server sẽ dùng chung XP, warn, tag, strike.
//   2. Mutex. Bản cũ mọi module làm `load -> sửa -> save` không khoá: hai
//      MessageCreate gần nhau đọc cùng file rồi ghi đè, mất XP của lần trước.
//   3. Ghi trễ 1 tick, gộp nhiều thay đổi. Tin nhắn liên tục = 1 lần ghi.
//   4. Ghi atomic. `writeFileSync` thẳng vào file đích cắt cụt file khi crash.
const path = require('path');
const { readJson, writeJsonAtomic } = require('./jsonfile');

// Ghi đè được khi test (Phase 5) để dữ liệu thật không bao giờ bị test chạm vào.
const ROOT = process.env.GUARDIAN_DATA_DIR
  ? path.resolve(process.env.GUARDIAN_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const GUILD_ID_RE = /^\d{15,25}$/;
const NAME_RE = /^[a-z][a-z0-9-]{0,30}$/;

/**
 * Kiểu mặc định của từng file. `rr` là mảng, phần còn lại là object — cứ để mỗi
 * module tự chế `Array.isArray(j) ? j : []` thì sớm có chỗ quên và file bị đọc
 * sai kiểu mà không ai báo. Khai báo tập trung ở đây.
 */
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

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Thư mục data của 1 guild, hoặc null nếu id không hợp lệ. */
function guildDir(guildId) {
  if (!GUILD_ID_RE.test(String(guildId))) return null;
  return path.join(ROOT, 'guilds', String(guildId));
}

function filePath(guildId, name) {
  const dir = guildDir(guildId);
  if (!dir) throw new Error(`guildId không hợp lệ: ${guildId}`);
  if (!NAME_RE.test(name)) throw new Error(`tên store không hợp lệ: ${name}`);
  if (!(name in FALLBACK)) throw new Error(`store chưa khai báo fallback: ${name}`);
  return path.join(dir, `${name}.json`);
}

function fallbackFor(name) {
  return FALLBACK[name]();
}

function checkFor(name) {
  return name === 'rr' ? Array.isArray : isObject;
}

// --- Ghi trễ ---------------------------------------------------------------
// key -> { value, file }. `value` là snapshot mới nhất để đọc đồng bộ trong
// cùng tick không phải chờ đĩa.
const cache = new Map(); // key -> value (đã parse)
const dirty = new Map(); // key -> file
let flushScheduled = false;

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  setImmediate(() => {
    flushScheduled = false;
    try {
      flush();
    } catch (err) {
      console.error('Store flush lỗi:', err.message);
    }
  });
}

/** Ghi hết file đang bẩn ra đĩa. Đồng bộ — dùng ở test và lúc tắt. */
function flush() {
  for (const [key, file] of dirty) {
    const value = cache.get(key);
    if (value === undefined) continue;
    writeJsonAtomic(file, value);
  }
  dirty.clear();
}

// Windows: `taskkill` không gửi SIGTERM nên handler SIGTERM không bao giờ chạy.
// `exit` là chốt chặn cuối, và chỉ chạy được việc đồng bộ — `writeJsonAtomic`
// dùng `fs.*Sync` nên hợp lệ ở đây.
process.on('exit', () => {
  try {
    flush();
  } catch (err) {
    console.error('Store flush khi exit lỗi:', err.message);
  }
});

// --- Mutex theo khoá ------------------------------------------------------
// Chuỗi promise: `tail[key]` là promise của lần ghi trước đó. Lần sau nối vào
// sau nó. `catch(() => {})` chỉ để giữ chuỗi không bị đứt — lỗi vẫn ném về
// caller, không bị nuốt, và không làm nghẽn những lần sau.
const tail = new Map();

function withLock(key, fn) {
  const prev = tail.get(key) || Promise.resolve();
  const run = prev.then(fn, fn); // bỏ qua lần trước đã lỗi
  tail.set(
    key,
    run.then(
      () => {},
      () => {}
    )
  );
  return run;
}

const keyOf = (guildId, name) => `${guildId}/${name}`;

// --- Đọc / ghi ------------------------------------------------------------

/**
 * Đọc 1 file của guild. Trả bản trong cache nếu có (đọc nhiều lần trong cùng
 * tick chỉ đọc đĩa một lần), nếu không thì đọc đĩa.
 *
 * Fallback legacy: bản single-guild để file phẳng ở `<ROOT>/<name>.json`.
 * Nếu file theo guild chưa có mà đây là guild gốc, đọc file phẳng — nhờ vậy
 * khi triển khai tầng này, dữ liệu đang chạy không bị đọc rỗng. Ghi luôn
 * xuống đường dẫn mới.
 */
function read(guildId, name) {
  const file = filePath(guildId, name);
  const key = keyOf(guildId, name);
  if (cache.has(key)) return cache.get(key);

  const value = readJson(file, undefined, checkFor(name));
  if (value !== undefined) {
    cache.set(key, value);
    return value;
  }

  const legacy = legacyPath(guildId, name);
  const fallback = fallbackFor(name);
  if (!legacy) {
    cache.set(key, fallback);
    return fallback;
  }
  const old = readJson(legacy, undefined, checkFor(name));
  if (old === undefined) {
    cache.set(key, fallback);
    return fallback;
  }
  warnLegacy(name, guildId);
  cache.set(key, old);
  return old;
}

/** Ghi 1 giá trị đã biết. Đánh dấu bẩn, ghi ở tick sau. */
function write(guildId, name, value) {
  const file = filePath(guildId, name);
  const key = keyOf(guildId, name);
  cache.set(key, value);
  dirty.set(key, file);
  scheduleFlush();
  return value;
}

/**
 * Đọc -> sửa -> ghi dưới khoá, không mất cập nhật.
 *
 * Đây là hàm duy nhất module nên dùng khi cần sửa file.
 *
 * `fn` nhận giá trị hiện tại và sửa **tại chỗ** (object/array truyền vào được
 * dùng lại để ghi). Giá trị `fn` trả về là kết quả cho caller — KHÔNG phải
 * nội dung sẽ ghi: caller thường cần thứ gì đó khác (`{ before, after }` chẳng
 * hạn) và nếu ghi cái đó xuống file thì hỏng.
 *
 * Nếu `fn` ném lỗi thì không ghi gì cả.
 */
function updateAsync(guildId, name, fn) {
  const key = keyOf(guildId, name);
  return withLock(key, async () => {
    const current = read(guildId, name);
    const result = await fn(current);
    write(guildId, name, current);
    return result;
  });
}

// --- Legacy flat files ----------------------------------------------------
// Bản single-guild để file phẳng ở `<ROOT>/<name>.json`, không có thư mục
// guild. Chỉ guild gốc (`GUILD_ID`) được đọc từ đó — server khác không có dữ
// liệu cũ nên đọc vào chỉ tạo dữ liệu bịa ra.
const warned = new Set();

function legacyPath(guildId, name) {
  const home = process.env.GUILD_ID;
  if (!home || String(home) !== String(guildId)) return null;
  return path.join(ROOT, `${name}.json`);
}

function warnLegacy(name, guildId) {
  const key = `${guildId}/${name}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[store] ${name}.json đang đọc từ file phẳng cũ (${ROOT}/${name}.json) cho guild ${guildId}. ` +
      'Chạy `node scripts/migrate-to-multiguild.js --apply` để chốt dữ liệu vào thư mục guild.'
  );
}

/** Chỉ dùng cho test: nạp dữ liệu vào sẵn, không cần đi qua đĩa. */
function _seed(guildId, name, value) {
  cache.set(keyOf(guildId, name), value);
}

module.exports = { read, write, updateAsync, flush, filePath, guildDir, _seed, ROOT };
