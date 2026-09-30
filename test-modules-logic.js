// Kiểm thử logic 10 module Guardian còn lại bằng mock interaction/event.
// (suggestions đã có test riêng ở test-suggestions-logic.js)
//
// KHÔNG gọi Discord API. Chỉ nạp module rồi bơm dữ liệu giả vào handler,
// kiểm tra kết quả.
//
// Dữ liệu thật KHÔNG thể bị test này chạm vào: `GUARDIAN_DATA_DIR` trỏ vào một
// thư mục tạm, đặt TRƯỚC mọi `require` vì `core/store` đọc biến này lúc nạp module.
// Bản cũ xoá `src/data/*.json` thật rồi restore — đã từng làm mất `rr.json`
// không phục hồi được, vì `.gitignore` loại trừ `data/` nên git không cứu được.
const fs = require('fs');
const os = require('os');
const path = require('path');

const GUARD = 'C:/Users/Gnurt/Desktop/bot-discord/bots/guardian';
const DJ = path.join(GUARD, 'node_modules/discord.js');
const { Collection, PermissionFlagsBits, MessageFlags } = require(DJ);

// Snowflake thật — parse regex trong module yêu cầu \d+, dùng chữ sẽ che bug.
// Khai ở đây vì `process.env.GUILD_ID` bên dưới cần nó TRƯỚC mọi require.
const GUILD = '1554742286598803526';

process.env.GUARDIAN_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-test-'));
// `core/guildconfig` đọc `config/guilds/` thật → ghim vào thư mục tạm để test
// không phụ thuộc file config của server thật (và không đọc nhầm config khi
// thêm server mới).
process.env.GUARDIAN_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-cfg-'));

// `guildconfig.fromEnv()` chỉ dựng config khi `GUILD_ID` khớp guild được hỏi —
// ghim vào GUILD test để nhánh fallback chạy đúng như lúc chạy thật.
process.env.GUILD_ID = GUILD;
// `fromEnv` đọc các biến này thành `channels.*` / `roles.*`; ticket/verify/
// welcome/starboard/suggestions đều lấy id từ đó nên phải set.
process.env.WELCOME_CHANNEL_ID = '1554748465232351263';
process.env.NEWBIE_ROLE_ID = '1554748071747788870';
process.env.TICKET_CHANNEL_ID = '1554748500045070419';
process.env.TICKET_CATEGORY_ID = '1554748338262384720';
process.env.ADMIN_ROLE_ID = '1554748061077737475';
process.env.LOG_CHANNEL_ID = '1554748461461540896';
process.env.VERIFY_CHANNEL_ID = '1554771434549678131';
process.env.VERIFY_ROLE_ID = '1554771429889802241';
process.env.VERIFY_PENDING_ROLE_ID = '1554771432305860629';
process.env.STARBOARD_CHANNEL_ID = '1554777506169491527';
process.env.SUGGESTIONS_CHANNEL_ID = '1554782911142694934';

const store = require(path.join(GUARD, 'src/core/store'));
const guildConfig = require(path.join(GUARD, 'src/core/guildconfig'));

const welcome = require(path.join(GUARD, 'src/modules/welcome'));
const verify = require(path.join(GUARD, 'src/modules/verify'));
const ticket = require(path.join(GUARD, 'src/modules/ticket'));
const logging = require(path.join(GUARD, 'src/modules/logging'));
const automod = require(path.join(GUARD, 'src/modules/automod'));
const moderation = require(path.join(GUARD, 'src/modules/moderation'));
const reactionroles = require(path.join(GUARD, 'src/modules/reactionroles'));
const tags = require(path.join(GUARD, 'src/modules/tags'));
const starboard = require(path.join(GUARD, 'src/modules/starboard'));
const levels = require(path.join(GUARD, 'src/modules/levels'));

// ---------------------------------------------------------------- hạ tầng test
// `resetData`/`readData` đi thẳng qua `core/store` chứ không đụng đĩa: cache
// trong RAM của store là nguồn đọc, nên test thấy đúng thứ module vừa ghi mà
// không cần chờ flush. Thư mục tạm đã ghim ở trên nên kể cả khi có ghi xuống
// đĩa thật thì cũng không chạm `src/data`.
const resetData = (name, obj) => store.write(GUILD, name.replace(/\.json$/, ''), obj);
const readData = (name) => store.read(GUILD, name.replace(/\.json$/, ''));

// Dọn thư mục tạm khi kết thúc. Không còn lý do backup/restore: dữ liệu thật
// không nằm trong đây nữa.
const restore = () => {
  for (const dir of [process.env.GUARDIAN_DATA_DIR, process.env.GUARDIAN_CONFIG_DIR]) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* thư mục tạm, không ghi được thì cũng không sao */
    }
  }
};

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra !== undefined ? ' — ' + extra : ''}`);
  }
}

/** EmbedBuilder giữ dữ liệu ở .data; đã serialize thì lấy thẳng. */
function emb(p, i = 0) {
  const e = p?.embeds?.[i];
  if (!e) return {};
  return e.data || e;
}

// Snowflake thật — parse regex trong module yêu cầu \d+, dùng chữ sẽ che bug.
const CHAN = '1554748500045070419';
const BOT = '1554756064182804560';
// Server thứ hai (dùng để test cô lập). Cần khai ở đây vì mock client phải
// biết từ đầu — có guild sai nằm trước GUILD trong Collection.
const GUILD2 = '900000000000000002';

// Kênh giả, tra cứu THEO ID.
//
// `fetch` trả về một kênh cố định cho mọi id là sai ở đúng chỗ đáng sợ nhất:
// module so `panel.channelId === channelId` để tái dùng panel, và `starboard`
// so msg đã đăng còn sống hay không. Một kênh cố định làm mọi lỗi "đăng nhầm
// kênh server khác" vô hình. Mỗi id giờ là một kênh riêng, id không có thì
// `fetch` ném như Discord thật.
//
// `live` là registry tin nhắn CỐ Ý tách khỏi `rec.sends`: `clearRec()` xoá lịch
// sử để test đo lại, nhưng tin đã gửi trên Discord vẫn còn sống — gộp hai thứ
// lại thì mọi bài "sửa tin cũ" đều hỏng.
const rec = { sends: [], edits: [], deletes: [] };
const live = new Map(); // messageId -> channelId
const channels = new Map();
let msgSeq = 0;

const mkChannel = (id, name = 'test-chan') => ({
  id,
  name,
  isTextBased: () => true,
  messages: {
    fetch: async (mid) => {
      if (live.get(mid) !== id) throw new Error('Unknown Message');
      return {
        id: mid,
        channelId: id,
        edit: async (q) => rec.edits.push(q),
        delete: async () => rec.deletes.push('starboard-msg'),
        react: async () => {},
      };
    },
  },
  // `send` nhận cả string lẫn payload — module khác nhau gọi kiểu khác nhau
  // (automod gửi string, starboard gửi `{embeds}`), nên chuẩn hoá về `{content}`.
  send: async (p) => {
    const mid = String(++msgSeq) + '0000';
    const payload = typeof p === 'string' ? { content: p } : { ...p };
    live.set(mid, id);
    rec.sends.push({ ...payload, __msgId: mid, __chanId: id });
    return {
      id: mid,
      channelId: id,
      url: `https://discord.com/channels/${GUILD}/${id}/${mid}`,
      react: async (e) => rec.sends.push({ __react: e }),
      edit: async (q) => rec.edits.push(q),
      delete: async () => rec.deletes.push('sent-msg'),
    };
  },
  delete: async () => rec.deletes.push('channel'),
});

const fakeChannel = mkChannel(CHAN);

// Mọi kênh mà config/env trỏ tới. `OTHER` là kênh của guild KHÁC — mọi
// `channels.fetch` vào nó đều bị ghi lại, để test bắt được "đăng nhầm server".
const OTHER = '900000000000000009';
const otherChannel = mkChannel(OTHER, 'kenh-server-khac');
for (const id of [
  CHAN, OTHER,
  '1554748461461540896', // LOG
  '1554748465232351263', // WELCOME
  '1554777506169491527', // STARBOARD
  '1554782911142694934', // SUGGESTIONS
  '1554771434549678131', // VERIFY_CHANNEL
]) {
  if (id !== CHAN) channels.set(id, mkChannel(id, 'k-' + id));
}
channels.set(OTHER, otherChannel);

const clearRec = () => { rec.sends.length = 0; rec.edits.length = 0; rec.deletes.length = 0; };
const logSends = () => rec.sends.filter((s) => emb(s).title);
/** Tin gửi đi kênh nào — dùng để chứng minh module không đăng nhầm server. */
const sentTo = (chanId) => rec.sends.filter((s) => s && s.__chanId === chanId);

const ctxBase = {
  client: {
    channels: {
      fetch: async (id) => {
        if (id === undefined) throw new TypeError('Cannot read properties of undefined (reading \'id\')');
        if (!channels.has(id)) throw new Error('Unknown Channel: ' + id);
        return channels.get(id);
      },
    },
  },
  config: {
    modules: {},
    automod: {
      invites: true,
      badwords: ['fuck', 'shit'],
      spam: { messages: 6, windowMs: 5000, timeoutSeconds: 300 },
      mentions: { max: 6 },
    },
    starboard: { threshold: 3, emoji: '⭐' },
  },
  // `ctx.cfg(guildId)` — module gọi cái này thay cho `ctx.env`.
  // Dùng loader THẬT (`core/guildconfig`) với thư mục config tạm + `GUILD_ID`
  // trỏ vào GUILD: `load()` thấy không có file thì fallback dựng từ
  // `process.env` (`fromEnv`), nên chỉ cần set các biến ở trên. Không tự viết
  // lại logic fallback — mock khác hành vi thật thì test xanh giả.
  cfg: (guildId) => guildConfig.load(guildId),
};

function mkIface(over = {}) {
  const out = { captured: null, replied: 0, edited: null, responded: null };
  out.i = {
    isChatInputCommand: () => false,
    isButton: () => false,
    isAutocomplete: () => false,
    commandName: 'x',
    guildId: GUILD,
    guild: { id: GUILD, name: 'server g n u r t', ownerId: '100000000000000001' },
    channel: null,
    user: { id: '200000000000000001', tag: 'Tester#0001', toString: () => '@Tester' },
    member: { roles: { cache: new Collection() } },
    memberPermissions: { has: () => false },
    reply: async (p) => { out.replied++; out.captured = p; },
    deferReply: async () => {},
    editReply: async (p) => { out.edited = p; out.captured = p; },
    update: async (p) => { out.captured = p; },
    respond: async (p) => { out.responded = p; },
    ...over,
  };
  return out;
}
/** Slash command mock. `cmd` là commandName — module kiểm tra nó trước khi xử lý. */
const sub = (cmd, name, opts = {}, over = {}) =>
  mkIface({
    isChatInputCommand: () => true,
    commandName: cmd,
    options: { getSubcommand: () => name, getString: (k) => opts[k] },
    ...over,
  });

/** Tìm handler theo tên event để gọi trực tiếp. */
const ev = (mod, name) => mod.events.find((e) => e.name === name).handler;

(async () => {
  // ═══════════════════════════════ AUTOMOD ═══════════════════════════════
  console.log('\n=== AUTOMOD ===');
  const mkMsg = (authorId, content, mentionCount = 0) => {
    const timedOut = [];
    const m = {
      guildId: GUILD,
      guild: { id: GUILD },
      content,
      author: { id: authorId, bot: false, toString: () => '@U' + authorId },
      memberPermissions: { has: () => false },
      mentions: { users: { size: mentionCount } },
      member: {
        timeout: async (ms, reason) => { timedOut.push({ ms, reason }); },
      },
      channel: fakeChannel,
      delete: async () => rec.deletes.push('msg'),
    };
    m.__timedOut = timedOut;
    return m;
  };
  const onMsg = ev(automod, 'messageCreate');

  console.log('-- bypass --');
  clearRec();
  let m = { guild: { id: GUILD }, author: { bot: true }, memberPermissions: { has: () => false } };
  await onMsg(ctxBase, m);
  check('bỏ qua tin của bot', rec.sends.length === 0);
  m = mkMsg('1', 'fuck discord.gg/abc');
  m.memberPermissions = { has: (p) => p === PermissionFlagsBits.ManageMessages };
  await onMsg(ctxBase, m);
  check('bỏ qua người có ManageMessages', rec.sends.length === 0);
  m = mkMsg('1', 'fuck');
  m.memberPermissions = { has: (p) => p === PermissionFlagsBits.Administrator };
  await onMsg(ctxBase, m);
  check('bỏ qua người có Administrator', rec.sends.length === 0);
  m = { guild: null, author: { bot: false }, memberPermissions: { has: () => false } };
  await onMsg(ctxBase, m);
  check('bỏ qua tin DM (không có guild)', rec.sends.length === 0);

  console.log('-- link mời --');
  clearRec();
  m = mkMsg('10', 'mời bạn vào https://discord.gg/abc123 nhé');
  await onMsg(ctxBase, m);
  check('xóa tin vi phạm', rec.deletes.includes('msg'));
  check('báo trong kênh', sentTo(CHAN).some((s) => s.content?.includes('link mời server')));
  check('ghi log automod', logSends().some((s) => emb(s).title === '🛡️ Auto-mod'));
  check('chưa timeout ở strike 1', m.__timedOut.length === 0);

  // INVITE_RE yêu cầu protocol:// — link viết tắt "discord.gg/abc" cố ý KHÔNG bắt
  // (dò domain trong text thuần sẽ khớp nhầm "example.com/discord.gg").
  for (const link of [
    'https://discord.gg/abc', 'http://discord.io/x', 'https://www.discord.me/x',
    'https://discord.com/invite/x', 'https://discordapp.com/invite/x',
  ]) {
    clearRec();
    m = mkMsg('11', link);
    await onMsg(ctxBase, m);
    check(`bắt ${link}`, rec.deletes.includes('msg'));
  }
  for (const clean of [
    'https://example.com/discord.gg', 'a.discord.gg/y',
    'https://notdiscord.gg/x', 'https://mydiscord.com/invite',
  ]) {
    clearRec();
    m = mkMsg('12', `xem ${clean} nhé`);
    await onMsg(ctxBase, m);
    check(`KHÔNG chặn nhầm: ${clean}`, !rec.deletes.includes('msg'));
  }

  console.log('-- từ ngữ xấu --');
  clearRec();
  m = mkMsg('20', 'FUCK this');
  await onMsg(ctxBase, m);
  check('không phân biệt hoa thường', rec.deletes.includes('msg'));
  clearRec();
  m = mkMsg('21', 'bình thường');
  await onMsg(ctxBase, m);
  check('không chặn tin sạch', !rec.deletes.includes('msg'));

  console.log('-- tag mass --');
  clearRec();
  m = mkMsg('30', 'xem', 7);
  await onMsg(ctxBase, m);
  check('tag 7 người (> max 6) bị chặn', rec.deletes.includes('msg'));
  check('ghi rõ số người bị tag', logSends().some((s) => emb(s).description.includes('7 người')));
  clearRec();
  m = mkMsg('31', 'ok', 6);
  await onMsg(ctxBase, m);
  check('tag đúng 6 người thì qua', !rec.deletes.includes('msg'));
  clearRec();
  m = mkMsg('32', 'x', 0);
  await onMsg(ctxBase, m);
  check('không tag thì qua', !rec.deletes.includes('msg'));

  console.log('-- spam: 6 tin / 5s --');
  clearRec();
  const spamUser = '40';
  for (let i = 0; i < 6; i++) await onMsg(ctxBase, mkMsg(spamUser, 'a' + i));
  check('6 tin chưa vượt ngưỡng (6 > 6 là false)', !rec.deletes.includes('msg'));
  const m7 = mkMsg(spamUser, 'a6');
  await onMsg(ctxBase, m7);
  check('tin thứ 7 bị coi là spam', rec.deletes.includes('msg'));
  check('spam lần đầu chỉ xóa, chưa timeout', m7.__timedOut.length === 0);

  console.log('-- strike 2 -> timeout --');
  clearRec();
  const u = '50';
  const a1 = mkMsg(u, 'fuck');
  await onMsg(ctxBase, a1);
  check('strike 1: xóa, không timeout', rec.deletes.includes('msg') && a1.__timedOut.length === 0);
  const a2 = mkMsg(u, 'fuck');
  await onMsg(ctxBase, a2);
  check('strike 2: có timeout', a2.__timedOut.length === 1, JSON.stringify(a2.__timedOut));
  check('timeout đúng 300s', a2.__timedOut[0]?.ms === 300000, String(a2.__timedOut[0]?.ms));
  check('log ghi "timeout"', logSends().some((s) => emb(s).description.includes('timeout')));
  clearRec();
  const a3 = mkMsg(u, 'fuck');
  await onMsg(ctxBase, a3);
  check('sau timeout strike reset về 0', a3.__timedOut.length === 0);

  console.log('-- lỗi khi xóa/timeout/gửi --');
  clearRec();
  const bad = mkMsg('60', 'fuck');
  bad.delete = async () => { throw new Error('Missing Permissions'); };
  await onMsg(ctxBase, bad);
  check('xóa lỗi không làm crash handler', logSends().length > 0);
  clearRec();
  const bad2 = mkMsg('61', 'fuck');
  bad2.member.timeout = async () => { throw new Error('Cannot timeout'); };
  await onMsg(ctxBase, bad2);
  check('timeout lỗi không làm crash handler', logSends().length > 0);

  // ═════════════════════════════════ TAGS ═════════════════════════════════
  console.log('\n=== TAGS ===');
  resetData('tags.json', {});
  const mkAutocomplete = (focused) =>
    mkIface({ isAutocomplete: () => true, commandName: 'tag', options: { getFocused: () => focused } });
  let t = mkAutocomplete('');
  check('autocomplete trả về true', (await tags.handleInteraction(t.i, ctxBase)) === true);
  check('kho rỗng -> không gợi ý', (t.responded || []).length === 0);
  resetData('tags.json', { welcome: 'chào mừng', rules: 'nội quy', 'web-dev': 'react' });
  t = mkAutocomplete('wel');
  await tags.handleInteraction(t.i, ctxBase);
  check('lọc theo tiền tố "we"', JSON.stringify(t.responded) === JSON.stringify([{ name: 'welcome', value: 'welcome' }]), JSON.stringify(t.responded));
  t = mkAutocomplete('WEB-');
  await tags.handleInteraction(t.i, ctxBase);
  check('autocomplete không phân biệt hoa thường', (t.responded || []).some((o) => o.name === 'web-dev'));
  t = mkIface({ isAutocomplete: () => true, commandName: 'khac' });
  check('autocomplete lệnh khác -> false', (await tags.handleInteraction(t.i, ctxBase)) === false);
  t = mkIface({ isAutocomplete: () => true, commandName: 'tag' });
  t.i.options = { getFocused: () => '' };
  await tags.handleInteraction(t.i, ctxBase);
  check('giới hạn 25 gợi ý', (t.responded || []).length <= 25, String((t.responded || []).length));

  t = sub('tag', 'list');
  check('/tag list -> true', (await tags.handleInteraction(t.i, ctxBase)) === true);
  // discord.js 14.27 đã bỏ key `ephemeral` (deprecated) → phải dùng flags bitmask.
  check('list ephemeral (flags bitmask)', t.captured?.flags === MessageFlags.Ephemeral, JSON.stringify(t.captured?.flags));
  check('đếm đúng 3 tag', (emb(t.captured).title || '').includes('(3)'), emb(t.captured).title);

  t = sub('tag', 'show', { name: 'welcome' });
  await tags.handleInteraction(t.i, ctxBase);
  check('/tag show trả nội dung', emb(t.captured).description === 'chào mừng', emb(t.captured).description);
  check('show có footer tên tag', (emb(t.captured).footer?.text || '').includes('welcome'));
  t = sub('tag', 'show', { name: 'WELCOME' });
  await tags.handleInteraction(t.i, ctxBase);
  check('show không phân biệt hoa thường', emb(t.captured).description === 'chào mừng');
  t = sub('tag', 'show', { name: 'khong-ton-tai' });
  await tags.handleInteraction(t.i, ctxBase);
  check('show tag rỗng báo lỗi', /Không có tag/.test(t.captured?.content || ''), t.captured?.content);

  t = sub('tag', 'create', { name: 'new1', content: 'x' });
  check('create không quyền bị chặn', (await tags.handleInteraction(t.i, ctxBase)) === true);
  check('báo cần Manage Server', /Manage Server/.test(t.captured?.content || ''), t.captured?.content);
  check('không ghi vào DB', readData('tags.json').new1 === undefined);

  const asMaster = { memberPermissions: { has: (p) => p === PermissionFlagsBits.ManageGuild } };
  // tên được hạ chữ thường TRƯỚC khi validate (tags.js:114) → 'Upper' thành 'upper' hợp lệ
  for (const [name, why] of [['co khoang', 'chứa space'], ['a'.repeat(51), 'dài 51'], ['a_b', 'có gạch dưới']]) {
    t = sub('tag', 'create', { name, content: 'x' }, asMaster);
    await tags.handleInteraction(t.i, ctxBase);
    check(`tên tag sai: ${why}`, /a-z/.test(t.captured?.content || ''), t.captured?.content);
  }
  t = sub('tag', 'create', { name: 'ok-tag', content: 'x'.repeat(2001) }, asMaster);
  await tags.handleInteraction(t.i, ctxBase);
  check('nội dung > 2000 bị chặn', /2000/.test(t.captured?.content || ''), t.captured?.content);
  t = sub('tag', 'create', { name: 'welcome', content: 'y' }, asMaster);
  await tags.handleInteraction(t.i, ctxBase);
  check('tạo trùng tên bị chặn', /đã tồn tại/.test(t.captured?.content || ''), t.captured?.content);
  check('nội dung cũ KHÔNG bị ghi đè', readData('tags.json').welcome === 'chào mừng');

  clearRec();
  t = sub('tag', 'create', { name: 'Mixed-Case', content: 'ok' }, asMaster);
  await tags.handleInteraction(t.i, ctxBase);
  check('tên hỗn hợp -> hạ chữ thường', readData('tags.json')['mixed-case'] === 'ok', JSON.stringify(Object.keys(readData('tags.json'))));
  check('ghi log tag mới', logSends().some((s) => emb(s).title === '🏷️ Tag mới'));
  t = sub('tag', 'create', { name: 'a'.repeat(50), content: 'x' }, asMaster);
  await tags.handleInteraction(t.i, ctxBase);
  check('tên đúng 50 ký tự được chấp nhận', readData('tags.json')['a'.repeat(50)] === 'x');

  clearRec();
  t = sub('tag', 'delete', { name: 'khong-ton-tai' }, asMaster);
  await tags.handleInteraction(t.i, ctxBase);
  check('xoá tag không có bị báo', /Không có tag/.test(t.captured?.content || ''), t.captured?.content);
  t = sub('tag', 'delete', { name: 'rules' }, { memberPermissions: { has: () => false } });
  await tags.handleInteraction(t.i, ctxBase);
  check('xoá không quyền bị chặn', /Manage Server/.test(t.captured?.content || ''), JSON.stringify(t.captured));
  clearRec();
  t = sub('tag', 'delete', { name: 'rules' }, asMaster);
  await tags.handleInteraction(t.i, ctxBase);
  check('xoá thành công', readData('tags.json').rules === undefined);
  check('ghi log tag bị xoá', logSends().some((s) => emb(s).title === '🏷️ Tag bị xóa'));
  t = sub('tag', 'khong-ton-tai', { name: 'x' }, asMaster);
  check('subcommand lạ -> false', (await tags.handleInteraction(t.i, ctxBase)) === false);
  t = sub('tag', 'khong-ton-tai', {}, asMaster);
  check('subcommand lạ + thiếu option name -> false, KHÔNG crash', (await tags.handleInteraction(t.i, ctxBase)) === false);
  t = sub('tag', 'list', {}, {});
  check('list đi qua guard quyền (không cần name)', (await tags.handleInteraction(t.i, ctxBase)) === true);

  // ══════════════════════════════ MODERATION ══════════════════════════════
  console.log('\n=== MODERATION (/kick /ban /timeout /warn) ===');
  resetData('warns.json', {});
  const roleCache = (...ids) => new Collection(ids.map((id) => [id, { id, toString: () => '@role' + id }]));
  const mkMember = (id, highestPos, opts = {}) => ({
    id,
    user: { id, tag: 'T#0002', toString: () => '@T' + id, send: opts.dmSend || (async () => {}) },
    // so sánh với guild.members.me.roles.highest (dùng field `position`)
    roles: { highest: { position: highestPos, comparePositionTo: (o) => highestPos - o.position } },
    kick: opts.kick,
    timeout: opts.timeout,
  });
  const guildMock = (mePos = 50) => {
    const g = {
      id: GUILD,
      name: 'server g n u r t',
      ownerId: '100000000000000001',
      members: { me: { id: BOT, roles: { highest: { position: mePos } } } },
      bans: [],
    };
    // ghi vào chính object này để test đọc lại được (trước đó ghi vào biến factory
    // nên mỗi lần gọi guildMock() lại mất dấu vết)
    g.members.ban = async (id, o) => { g.bans.push({ id, reason: o?.reason }); };
    return g;
  };
  const run = async (name, opts, target, over = {}) => {
    const g = over.guild || guildMock();
    const i = sub(name, name, opts, { guild: g, ...over });
    i.i.options.getMember = () => target;
    i.i.options.getUser = () => target?.user;
    i.i.options.getInteger = (k) => opts[k];
    const handled = await moderation.handleInteraction(i.i, ctxBase);
    return { i, handled, g };
  };

  let r = await run('kick', {}, null, { isChatInputCommand: () => false });
  check('interaction không phải chat input -> false', r.handled === false);
  r = await run('close', {}, null);
  check('lệnh của module khác -> false', r.handled === false);

  r = await run('warn', { user: '200000000000000001' }, mkMember('200000000000000001', 10));
  check('tự warn mình bị chặn', /Không tự áp dụng/.test(r.i.edited || ''), r.i.edited);

  r = await run('warn', { user: '100000000000000001' }, mkMember('100000000000000001', 10));
  check('warn owner bị chặn', /owner server/.test(r.i.edited || ''), r.i.edited);

  r = await run('kick', { user: '300', reason: 'x' }, mkMember('300', 50));
  check('role bằng bot bị chặn', /bằng\/cao hơn bot/.test(r.i.edited || ''), r.i.edited);
  r = await run('kick', { user: '301', reason: 'x' }, mkMember('301', 80));
  check('role cao hơn bot bị chặn', /bằng\/cao hơn bot/.test(r.i.edited || ''), r.i.edited);

  r = await run('kick', { user: '302', reason: 'x' }, mkMember('302', 10));
  check('role thấp hơn bot thì qua', !/bằng\/cao hơn bot/.test(r.i.edited || ''), r.i.edited);
  check('báo không tìm thấy thành viên (target không có .kick)', /Không tìm thấy thành viên/.test(r.i.edited || ''), r.i.edited);

  let kicked = false;
  clearRec();
  r = await run('kick', { user: '303', reason: 'spam' }, mkMember('303', 10, { kick: async () => { kicked = true; } }));
  check('kick thành công', kicked === true);
  check('reply báo lý do', /Lý do: spam/.test(r.i.edited || ''), r.i.edited);
  check('ghi log kick', logSends().some((s) => emb(s).title === '👢 Kick'));

  clearRec();
  r = await run('ban', { user: '304', reason: 'gian lận' }, mkMember('304', 10));
  check('ban thành công', r.g.bans?.[0]?.id === '304', JSON.stringify(r.g.bans));
  check('ban truyền lý do', r.g.bans?.[0]?.reason === 'gian lận', JSON.stringify(r.g.bans));
  check('ghi log ban', logSends().some((s) => emb(s).title === '🔨 Ban'));

  let toMs = null;
  clearRec();
  r = await run('timeout', { user: '305', minutes: 15, reason: 'mút' }, mkMember('305', 10, { timeout: async (ms) => { toMs = ms; } }));
  check('timeout đúng 15 phút', toMs === 900000, String(toMs));
  check('reply có số phút', /15 phút/.test(r.i.edited || ''), r.i.edited);

  const dmMsg = [];
  clearRec();
  r = await run('warn', { user: '306', reason: 'lần 1' }, mkMember('306', 10, { dmSend: async (m) => dmMsg.push(m) }));
  check('warn lưu vào DB', (readData('warns.json')['306'] || []).length === 1, JSON.stringify(readData('warns.json')['306']));
  check('warn lưu đúng lý do', readData('warns.json')['306'][0].reason === 'lần 1');
  check('warn ghi người xử lý', readData('warns.json')['306'][0].by === '200000000000000001');
  check('warn có timestamp ISO', !isNaN(Date.parse(readData('warns.json')['306'][0].at)));
  check('reply đếm tổng warn', /tổng \*\*1\*\*/.test(r.i.edited || ''), r.i.edited);
  check('DM cho user', dmMsg.length === 1 && /bị warn/.test(dmMsg[0]));
  r = await run('warn', { user: '306', reason: 'lần 2' }, mkMember('306', 10, { dmSend: async (m) => dmMsg.push(m) }));
  check('warn lần 2 cộng dồn', (readData('warns.json')['306'] || []).length === 2);
  check('reply báo tổng 2', /tổng \*\*2\*\*/.test(r.i.edited || ''), r.i.edited);

  r = await run('warn', { user: '307', reason: 'x' }, mkMember('307', 10, { dmSend: async () => { throw new Error('Cannot send DM'); } }));
  check('DM bị chặn vẫn ghi warn', (readData('warns.json')['307'] || []).length === 1);
  check('DM lỗi không làm hỏng lệnh', /Đã warn/.test(r.i.edited || ''), r.i.edited);

  clearRec();
  r = await run('kick', { user: '308', reason: 'x' }, mkMember('308', 10, { kick: async () => { throw new Error('Missing Permissions'); } }));
  check('API lỗi -> báo thất bại, không crash', /❌ Lệnh thất bại: Missing Permissions/.test(r.i.edited || ''), r.i.edited);

  // ═════════════════════════════ STARBOARD ═══════════════════════════════
  console.log('\n=== STARBOARD (postOrUpdate / updateCount) ===');
  resetData('starboard.json', {});
  const SB = '1554777506169491527';
  const onReactAdd = ev(starboard, 'messageReactionAdd');
  const onReactRemove = ev(starboard, 'messageReactionRemove');
  const mkReaction = (msg, count, emoji = { id: null, name: '⭐' }) => ({
    message: msg,
    emoji,
    count,
    partial: false,
  });
  const mkSbMsg = (id, over = {}) => ({
    id,
    guildId: GUILD,
    guild: { id: GUILD },
    author: { bot: false, tag: 'A#0003', displayAvatarURL: () => 'https://x/a.png' },
    content: 'nội dung hay',
    channel: { id: CHAN, name: 'chat' },
    createdAt: new Date('2026-09-30T00:00:00Z'),
    url: `https://discord.com/channels/${GUILD}/${CHAN}/${id}`,
    attachments: new Collection(),
    ...over,
  });

  clearRec();
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('900'), 2), { bot: false });
  check('dưới ngưỡng -> không đăng', rec.sends.length === 0);
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('901'), 3), { bot: true });
  check('người bấm là bot -> bỏ qua', rec.sends.length === 0);
  const botAuthor = { bot: true, tag: 'B#1', displayAvatarURL: () => 'https://x/av.png' };
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('902', { author: botAuthor }), 9), { bot: false });
  check('tác giả tin là bot -> bỏ qua', rec.sends.length === 0);
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('903', { channel: { id: SB, name: 'star' } }), 9), { bot: false });
  check('tin nằm trong chính kênh starboard -> bỏ qua', rec.sends.length === 0);
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('904', { guild: null }), 9), { bot: false });
  check('tin không có guild -> bỏ qua', rec.sends.length === 0);
  clearRec();
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('905'), 9, { id: null, name: '❤️' }), { bot: false });
  check('sai emoji -> bỏ qua', rec.sends.length === 0);
  // Guild chưa có `config/guilds/<id>.json` thì `cfg()` trả shape rỗng → thiếu
  // kênh starboard. Dùng guild lạ (không phải GUILD) để kích hoạt đúng nhánh
  // "chưa cấu hình" thay vì giả lập bằng cách xoá biến env.
  const ctxNoSb = { ...ctxBase, cfg: () => ({ channels: {}, roles: {}, starboard: { threshold: 3, emoji: '⭐' } }) };
  await onReactAdd(ctxNoSb, mkReaction(mkSbMsg('906')), 9, { bot: false });
  check('guild chưa cấu hình -> bỏ qua, không crash', rec.sends.length === 0);

  clearRec();
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('910'), 3), { bot: false });
  check('đạt ngưỡng -> đăng starboard', rec.sends.length === 1, String(rec.sends.length));
  // id tin starboard do kênh giả sinh ra — so với id thật vừa nhận chứ không
  // hardcode, nếu không test vừa khớp nhầm vừa hỏng mỗi lần đổi mock.
  const sb910 = rec.sends[0].__msgId;
  check('đăng vào kênh starboard', rec.sends[0].__chanId === SB, rec.sends[0].__chanId);
  check('lưu map tin gốc -> tin starboard', readData('starboard.json')['910'] === sb910, JSON.stringify(readData('starboard.json')));
  check('embed có màu vàng', emb(rec.sends[0]).color === 0xffd700);
  check('footer có số sao + tên kênh', /3 ⭐ • #chat/.test(emb(rec.sends[0]).footer?.text || ''), emb(rec.sends[0]).footer?.text);
  check('mô tả có nội dung + link jump', emb(rec.sends[0]).description.includes('nội dung hay') && emb(rec.sends[0]).description.includes('[Jump]'));
  check('timestamp lấy từ tin gốc', emb(rec.sends[0]).timestamp === '2026-09-30T00:00:00.000Z', String(emb(rec.sends[0]).timestamp));

  clearRec();
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('911', { content: '' }), 5), { bot: false });
  check('tin rỗng vẫn đăng, chỉ có Jump', emb(rec.sends[0]).description === `[Jump](https://discord.com/channels/${GUILD}/${CHAN}/911)`, emb(rec.sends[0]).description);

  clearRec();
  const withImg = mkSbMsg('912');
  withImg.attachments = new Collection([['a1', { contentType: 'image/png', url: 'https://x/i.png' }]]);
  await onReactAdd(ctxBase, mkReaction(withImg, 3), { bot: false });
  check('có ảnh -> setImage', emb(rec.sends[0]).image?.url === 'https://x/i.png', JSON.stringify(emb(rec.sends[0]).image));
  clearRec();
  const withFile = mkSbMsg('913');
  withFile.attachments = new Collection([['a1', { contentType: 'application/pdf', url: 'https://x/f.pdf' }]]);
  await onReactAdd(ctxBase, mkReaction(withFile, 3), { bot: false });
  check('file không phải ảnh -> không setImage', emb(rec.sends[0]).image === undefined, JSON.stringify(emb(rec.sends[0]).image));

  clearRec();
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('910'), 7), { bot: false });
  check('tăng sao -> SỬA bài cũ, không tạo bài mới', rec.sends.length === 0 && rec.edits.length === 1, `sends=${rec.sends.length} edits=${rec.edits.length}`);
  check('số sao cập nhật', /7 ⭐/.test(emb(rec.edits[0]).footer?.text || ''), emb(rec.edits[0]).footer?.text);
  check('map không nhân bản', Object.keys(readData('starboard.json')).length === 4, String(Object.keys(readData('starboard.json')).length));

  console.log('-- bài starboard bị xoá -> gửi lại --');
  // Xoá tin khỏi registry `live` để mô phỏng người dùng tự xoá bài starboard.
  live.delete(sb910);
  clearRec();
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('910'), 8), { bot: false });
  check('fetch lỗi -> gửi lại bài mới', rec.sends.length === 1, String(rec.sends.length));
  check('gửi lại -> map trỏ tin MỚI', readData('starboard.json')['910'] !== sb910, JSON.stringify(readData('starboard.json')));

  console.log('-- bỏ reaction (updateCount) --');
  clearRec();
  await onReactRemove(ctxBase, mkReaction(mkSbMsg('950'), 5), { bot: false });
  check('tin chưa từng lên starboard -> bỏ qua', rec.edits.length === 0 && rec.sends.length === 0);
  await onReactRemove(ctxBase, mkReaction(mkSbMsg('910', { author: { bot: true, tag: 'B#1', displayAvatarURL: () => 'https://x/av.png' } }), 5), { bot: false });
  check('updateCount KHÔNG chặn tác giả bot (khác postOrUpdate)', rec.edits.length === 1, String(rec.edits.length));
  clearRec();
  await onReactRemove(ctxBase, mkReaction(mkSbMsg('910'), 5, { id: null, name: '❤️' }), { bot: false });
  check('bỏ sai emoji -> bỏ qua', rec.edits.length === 0);
  clearRec();
  await onReactRemove(ctxBase, mkReaction(mkSbMsg('910'), 2), { bot: false });
  check('giảm sao -> cập nhật số, KHÔNG xoá bài', rec.edits.length === 1 && rec.sends.length === 0);
  check('số sao giảm đúng', /2 ⭐/.test(emb(rec.edits[0]).footer?.text || ''), emb(rec.edits[0]).footer?.text);

  // ═══════════════════════════ REACTION-ROLES ═════════════════════════════
  console.log('\n=== REACTION-ROLES ===');
  resetData('rr.json', []);
  const ROLES = {
    below: { id: '1554749000000000001', position: 5, toString: () => '@below' },
    above: { id: '1554749000000000002', position: 99, toString: () => '@above' },
  };
  const rrCtx = {
    ...ctxBase,
    client: { channels: { fetch: async () => fakeChannel } },
  };
  const runRr = async (name, opts) => {
    const i = sub('rr', name, opts, {
      guild: { id: GUILD, members: { me: { id: BOT, roles: { highest: { position: 50 } } } } },
    });
    i.i.options.getChannel = () => fakeChannel;
    i.i.options.getRole = () => opts.__role;
    const handled = await reactionroles.handleInteraction(i.i, rrCtx);
    return { i, handled };
  };

  r = await runRr('create', { channel: 1, role: 1, emoji: '👍', __role: ROLES.above });
  check('role cao hơn bot bị từ chối', /không cấp được/.test(r.i.edited || ''), r.i.edited);
  check('không ghi DB', readData('rr.json').length === 0);

  clearRec();
  r = await runRr('create', { channel: 1, role: 1, emoji: '👍', __role: ROLES.below });
  check('tạo panel thành công', /Đã tạo panel/.test(r.i.edited || ''), r.i.edited);
  check('bot tự react emoji', rec.sends.some((s) => s && s.__react === '👍'));
  check('lưu 1 pair', readData('rr.json').length === 1, JSON.stringify(readData('rr.json')));
  check('pair lưu đúng role/emoji', readData('rr.json')[0].roleId === ROLES.below.id && readData('rr.json')[0].emoji === '👍');

  for (const [input, want] of [
    ['<:star:12345>', 'star:12345'], ['<a:star:12345>', 'star:12345'],
    ['star:12345', 'star:12345'], ['  👍  ', '👍'], ['⭐', '⭐'],
  ]) {
    resetData('rr.json', []);
    r = await runRr('create', { channel: 1, role: 1, emoji: input, __role: ROLES.below });
    check(`parseEmoji("${input}") -> "${want}"`, readData('rr.json')[0]?.emoji === want, readData('rr.json')[0]?.emoji);
  }

  clearRec();
  resetData('rr.json', []);
  // Emoji lạ: msg.react() của Discord.js ném lỗi. Mock phải mô phỏng điều đó,
  // nếu không test sẽ tưởng module đã xử lý lỗi khi thực ra chưa từng thấy lỗi nào.
  const goodReact = fakeChannel.send;
  fakeChannel.send = async (p) => {
    const m = await goodReact(p);
    m.react = async (e) => { if (!/^(<a?:)?[A-Za-z0-9_]+(:\d+)?>?$/u.test(e) && e.length > 8) throw new Error('Unknown Emoji'); rec.sends.push({ __react: e }); };
    return m;
  };
  r = await runRr('create', { channel: 1, role: 1, emoji: 'khong-ton-tai-emoji', __role: ROLES.below });
  fakeChannel.send = goodReact;
  check('react lỗi -> báo thất bại, không crash', /❌ Tạo thất bại/.test(r.i.edited || ''), r.i.edited);
  check('lỗi KHÔNG ghi pair', readData('rr.json').length === 0, JSON.stringify(readData('rr.json')));

  r = await runRr('delete', { link: 'không phải link' });
  check('link sai -> báo lỗi', /không hợp lệ/i.test(r.i.edited || ''), r.i.edited);
  r = await runRr('delete', { link: `https://discord.com/channels/${GUILD}/${CHAN}/999999999999999999` });
  check('id không có trong DB -> báo', /Không tìm thấy panel/.test(r.i.edited || ''), r.i.edited);

  // Link trỏ server khác: nếu không chặn, bot sẽ xoá panel của server đó.
  resetData('rr.json', [{ channelId: CHAN, messageId: '1554782911142694935', emoji: '👍', roleId: ROLES.below.id }]);
  clearRec();
  r = await runRr('delete', { link: `https://discord.com/channels/900000000000000001/${CHAN}/1554782911142694935` });
  check('link server khác -> từ chối, KHÔNG xoá', /server khác/i.test(r.i.edited || ''), r.i.edited);
  check('link server khác -> record còn nguyên', readData('rr.json').length === 1, JSON.stringify(readData('rr.json')));
  check('link server khác -> không xoá tin nào', rec.deletes.length === 0, JSON.stringify(rec.deletes));

  resetData('rr.json', [{ channelId: CHAN, messageId: '1554782911142694935', emoji: '👍', roleId: ROLES.below.id }]);
  clearRec();
  r = await runRr('delete', { link: `https://discord.com/channels/${GUILD}/${CHAN}/1554782911142694935` });
  check('xoá panel thành công', /Đã xóa panel/.test(r.i.edited || ''), r.i.edited);
  check('gỡ khỏi DB', readData('rr.json').length === 0);
  r = await runRr('khong-ton-tai', {});
  check('subcommand lạ -> false', r.handled === false);

  console.log('-- grant / revoke role --');
  resetData('rr.json', [{ channelId: CHAN, messageId: '1554782911142694935', emoji: '👍', roleId: ROLES.below.id }]);
  const onRRAdd = ev(reactionroles, 'messageReactionAdd');
  const onRRRemove = ev(reactionroles, 'messageReactionRemove');
  const added = [];
  // guild phải có `id`: `grantOrRevoke` tra store theo `message.guild.id`.
  const rrGuild = (fetch) => ({ id: GUILD, members: { fetch } });
  const rrFetch = async (uid) => ({ user: { bot: false }, roles: { add: async (r) => added.push(['add', uid, r]), remove: async (r) => added.push(['rm', uid, r]) } });
  const mkRRReaction = (emoji, count = 1) => ({
    message: { id: '1554782911142694935', guild: rrGuild(rrFetch) },
    emoji,
    count,
    partial: false,
  });
  await onRRAdd(rrCtx, mkRRReaction({ id: null, name: '👍' }), { id: 'u1', bot: false });
  check('react unicode khớp -> gán role', added.some((a) => a[0] === 'add' && a[2] === ROLES.below.id), JSON.stringify(added));
  await onRRRemove(rrCtx, mkRRReaction({ id: null, name: '👍' }), { id: 'u1', bot: false });
  check('bỏ react -> gỡ role', added.some((a) => a[0] === 'rm' && a[2] === ROLES.below.id), JSON.stringify(added));
  added.length = 0;
  await onRRAdd(rrCtx, mkRRReaction({ id: null, name: '❤️' }), { id: 'u1', bot: false });
  check('sai emoji -> không gán', added.length === 0);
  resetData('rr.json', [{ channelId: CHAN, messageId: '999', emoji: 'star:1', roleId: ROLES.below.id }]);
  added.length = 0;
  await onRRAdd(rrCtx, { ...mkRRReaction({ id: '1', name: 'star' }), message: { id: '999', guild: rrGuild(async () => ({ user: { bot: false }, roles: { add: async () => added.push('x') } })) } }, { id: 'u1', bot: false });
  check('emoji custom so name:id', added.length === 1, String(added.length));
  added.length = 0;
  await onRRAdd(rrCtx, { ...mkRRReaction({ id: '1', name: 'other' }), message: { id: '999', guild: rrGuild(async () => ({ user: { bot: false }, roles: { add: async () => added.push('x') } })) } }, { id: 'u1', bot: false });
  check('emoji custom sai tên -> không gán', added.length === 0);
  await onRRAdd(rrCtx, mkRRReaction({ id: null, name: '👍' }), { id: 'u1', bot: true });
  check('người bấm là bot -> bỏ qua', added.length === 0);
  await onRRAdd(rrCtx, { ...mkRRReaction({ id: null, name: '👍' }), message: { id: '1', guild: null } }, { id: 'u1', bot: false });
  check('reaction ngoài guild -> bỏ qua', added.length === 0);
  await onRRAdd(rrCtx, { ...mkRRReaction({ id: null, name: '👍' }), partial: true, fetch: async () => {} }, { id: 'u1', bot: false });
  check('partial fetch lỗi -> bỏ qua, không crash', true);

  // ═══════════════════════════════ VERIFY ════════════════════════════════
  console.log('\n=== VERIFY ===');
  resetData('verify-panel.json', null);
  const onMemberAdd = ev(verify, 'guildMemberAdd');
  const mkMemberAdd = (id, bot) => ({
    // `member.guild.id` — verify gọi `idsOf(ctx, member.guild.id)` để lấy config
    // đúng guild; thiếu field này thì crash trước khi tới assert.
    guild: { id: GUILD },
    user: { id, bot, tag: 'N#0004' },
    roles: { add: async (r) => added.push(['madd', id, r]) },
  });
  added.length = 0;
  await onMemberAdd(ctxBase, mkMemberAdd('400', false));
  check('thành viên mới -> gán role chờ', added.some((a) => a[2] === ctxBase.cfg(GUILD).roles.verifyPending), JSON.stringify(added));
  added.length = 0;
  await onMemberAdd(ctxBase, mkMemberAdd('401', true));
  check('bot mới vào -> không gán role', added.length === 0);
  added.length = 0;
  // Guild chưa cấu hình → `roles.verifyPending` rỗng → bỏ qua.
  await onMemberAdd({ ...ctxBase, cfg: () => ({ channels: {}, roles: {} }) }, mkMemberAdd('402', false));
  check('thiếu roles.verifyPending -> bỏ qua', added.length === 0);

  const agree = (roles) => mkIface({
    isButton: () => true,
    customId: 'verify:agree',
    member: { user: { id: 'u5', tag: 'U#5' }, roles: { cache: new Collection(roles.map((r) => [r, { id: r }])), add: async (r) => added.push(['vadd', r]), remove: async (r) => added.push(['vrm', r]) } },
  });
  t = mkIface({ isButton: () => true, customId: 'verify:xxx' });
  check('nút khác -> false', (await verify.handleInteraction(t.i, ctxBase)) === false);
  t = agree([]);
  // Guild chưa cấu hình → `roles.verify` rỗng. `guildconfig` CACHE theo guildId
  // nên phải trả config rỗng từ `cfg` override, không sửa `process.env` (sửa thì
  // cache cũ vẫn còn giá trị và test xanh giả).
  const ctxNoRole = { ...ctxBase, cfg: () => ({ channels: { verify: '1554771434549678131' }, roles: {} }) };
  // Server thứ hai chưa cấu hình role: phải BÁO, không im lặng. Im lặng thì
  // admin tưởng nút hỏng. (Bản cũ trả false — người dùng thấy gì cũng không.)
  check('thiếu VERIFY_ROLE_ID -> báo chứ không im lặng',
    (await verify.handleInteraction(t.i, ctxNoRole)) === true && /chưa được cấu hình/.test(t.captured?.content || ''),
    t.captured?.content);
  check('thiếu VERIFY_ROLE_ID -> không gán role', added.length === 0);

  added.length = 0;
  t = mkIface({ isButton: () => true, customId: 'verify:agree', member: null });
  await verify.handleInteraction(t.i, ctxBase);
  check('không lấy được member -> báo lỗi', /Không tìm thấy thành viên/.test(t.captured?.content || ''), t.captured?.content);

  added.length = 0;
  t = agree([ctxBase.cfg(GUILD).roles.verify]);
  await verify.handleInteraction(t.i, ctxBase);
  check('đã có role -> báo đã xác nhận', /đã xác nhận rồi/.test(t.captured?.content || ''), t.captured?.content);
  check('không gán lại role', added.length === 0);

  clearRec();
  added.length = 0;
  t = agree([ctxBase.cfg(GUILD).roles.verifyPending]);
  await verify.handleInteraction(t.i, ctxBase);
  check('gán role ✅', added.some((a) => a[0] === 'vadd' && a[1] === ctxBase.cfg(GUILD).roles.verify), JSON.stringify(added));
  check('gỡ role ⏳', added.some((a) => a[0] === 'vrm' && a[1] === ctxBase.cfg(GUILD).roles.verifyPending), JSON.stringify(added));
  check('ghi log xác nhận', logSends().some((s) => emb(s).title === '✅ Thành viên đã xác nhận'));

  added.length = 0;
  t = agree([ctxBase.cfg(GUILD).roles.verifyPending]);
  t.i.member.roles.add = async () => { throw new Error('Missing Permissions'); };
  await verify.handleInteraction(t.i, ctxBase);
  check('gán role lỗi -> báo ❌, không crash', /❌ Không xác nhận được: Missing Permissions/.test(t.captured?.content || ''), t.captured?.content);

  console.log('-- init: tạo & tái dùng panel --');
  const VCHAN = ctxBase.cfg(GUILD).channels.verify;
  clearRec();
  resetData('verify-panel.json', null);
  await verify.init(ctxBase, GUILD);
  check('chưa có panel -> tạo mới', rec.sends.length === 1);
  const vPanel = readData('verify-panel.json');
  check('lưu vị trí panel', vPanel?.messageId === rec.sends[0].__msgId && vPanel.channelId === VCHAN, JSON.stringify(vPanel));
  check('đăng đúng kênh xác nhận', rec.sends[0].__chanId === VCHAN, rec.sends[0].__chanId);
  check('panel có nút verify:agree', JSON.stringify(rec.sends[0]).includes('verify:agree'));
  clearRec();
  await verify.init(ctxBase, GUILD);
  check('panel còn -> không tạo lại', rec.sends.length === 0);
  clearRec();
  await verify.init({ ...ctxBase, cfg: () => ({ channels: {}, roles: {} }) }, GUILD);
  check('thiếu VERIFY_CHANNEL_ID -> bỏ qua, không crash', rec.sends.length === 0);
  // Panel trỏ sang kênh KHÁC (đổi cấu hình) -> phải dựng lại ở kênh mới.
  resetData('verify-panel.json', { channelId: '1554771434549678999', messageId: rec.sends[0]?.__msgId });
  clearRec();
  await verify.init(ctxBase, GUILD);
  check('panel ở kênh khác -> dựng lại ở kênh đúng', rec.sends.length === 1 && rec.sends[0].__chanId === VCHAN, JSON.stringify(rec.sends.map((s) => s.__chanId)));
  live.delete(readData('verify-panel.json').messageId);
  clearRec();
  await verify.init(ctxBase, GUILD);
  check('panel cũ đã bị xoá -> tạo lại', rec.sends.length === 1);
  check('panel mới ghi đè id cũ', readData('verify-panel.json').messageId === rec.sends[0].__msgId, JSON.stringify(readData('verify-panel.json')));

  // ═══════════════════════════════ TICKET ════════════════════════════════
  console.log('\n=== TICKET ===');
  clearRec();
  t = mkIface({ isButton: () => false, isChatInputCommand: () => false });
  check('interaction lạ -> false', (await ticket.handleInteraction(t.i, ctxBase)) === false);
  t = mkIface({ isButton: () => true, customId: 'khac:xxx' });
  check('nút của module khác -> false', (await ticket.handleInteraction(t.i, ctxBase)) === false);

  t = sub('close', 'close', {}, { channel: null });
  await ticket.handleInteraction(t.i, ctxBase);
  check('/close ngoài kênh ticket -> báo lỗi', /Chỉ dùng trong kênh ticket/.test(t.captured?.content || ''), t.captured?.content);

  const ownerId = '500';
  const staffId = '501';
  const mkTicketChan = (topic) => ({ ...fakeChannel, id: '700', name: 'ticket-tester', topic });
  t = sub('close', 'close', {}, { channel: mkTicketChan(`owner:${ownerId}`), user: { id: '999', tag: 'X#1' } });
  await ticket.handleInteraction(t.i, ctxBase);
  check('không phải owner & không phải staff -> chặn', /Chỉ người mở ticket/.test(t.captured?.content || ''), t.captured?.content);

  t = sub('close', 'close', {}, { channel: mkTicketChan(`owner:${ownerId}`), user: { id: ownerId, tag: 'O#1' } });
  clearRec();
  await ticket.handleInteraction(t.i, ctxBase);
  check('owner đóng được', rec.deletes.includes('channel'));
  check('ghi log ticket đóng', logSends().some((s) => emb(s).title === '🔒 Ticket đóng'));

  t = sub('close', 'close', {}, {
    channel: mkTicketChan(`owner:${ownerId}`),
    user: { id: '999', tag: 'X#1' },
    memberPermissions: { has: (p) => p === PermissionFlagsBits.ManageChannels },
  });
  clearRec();
  await ticket.handleInteraction(t.i, ctxBase);
  check('staff (ManageChannels) đóng được', rec.deletes.includes('channel'));

  t = mkIface({ isButton: () => true, customId: 'ticket:close' });
  t.i.channel = mkTicketChan(null);
  t.i.user = { id: '999', tag: 'X#1' };
  t.i.member = { roles: { cache: new Collection() } };
  await ticket.handleInteraction(t.i, ctxBase);
  check('kênh không có topic owner → không ai sở hữu, staff cũng cần quyền', /Chỉ người mở ticket/.test(t.captured?.content || ''), t.captured?.content);

  console.log('-- tạo ticket --');
  let created = null;
  const guildCreate = {
    id: GUILD,
    name: 'server g n u r t',
    roles: { everyone: { id: '999999999999999999' } },
    members: { me: { id: BOT } },
    channels: {
      create: async (o) => { created = o; return { ...fakeChannel, id: '701', name: o.name, send: fakeChannel.send, toString: () => '#' + o.name }; },
    },
  };
  t = mkIface({
    isButton: () => true,
    customId: 'ticket:create',
    guild: guildCreate,
    user: { id: '555', tag: 'Tên Có Dấu!', username: 'Tên Có Dấu!' },
  });
  clearRec();
  await ticket.handleInteraction(t.i, ctxBase);
  check('tạo channel mới', created !== null);
  check('tên kênh đã chuẩn hoá', /^ticket-[a-z0-9-]+$/.test(created?.name || ''), created?.name);
  check('tên không để dấu cách', !/\s/.test(created?.name || ''), created?.name);
  check('parent = TICKET_CATEGORY_ID', created?.parent === '1554748338262384720', String(created?.parent));
  check('topic ghi owner', created?.topic === 'owner:555', created?.topic);
  check('type = GUILD_TEXT', created?.type === 0);
  const ow = created?.permissionOverwrites || [];
  check('@everyone bị chặn ViewChannel', ow.some((o) => o.id === '999999999999999999' && o.deny?.includes(PermissionFlagsBits.ViewChannel)));
  check('mở kênh cho người mở', ow.some((o) => o.id === '555' && o.allow?.includes(PermissionFlagsBits.SendMessages)));
  check('mở kênh cho bot (@everyone deny sẽ chặn bot nếu thiếu)', ow.some((o) => o.id === BOT));
  // ticket.js đọc ADMIN_ROLE_ID từ process.env lúc nạp module (không qua ctx.env)
  check('mở kênh cho Admin role', ow.some((o) => o.id === '1554748061077737475'), JSON.stringify(ow.map((o) => o.id)));
  check('gửi ping + embed trong kênh mới', rec.sends.some((s) => s && typeof s.content === 'string' && s.content.includes('<@555>')));
  check('kênh mới có nút Đóng', JSON.stringify(rec.sends).includes('ticket:close'));
  check('ghi log ticket mở', logSends().some((s) => emb(s).title === '🎫 Ticket mở'));

  // ══════════════════════════════ LOGGING ════════════════════════════════
  console.log('\n=== LOGGING ===');
  const onDelete = ev(logging, 'messageDelete');
  const onUpdate = ev(logging, 'messageUpdate');
  const onGAdd = ev(logging, 'guildMemberAdd');
  const onGRemove = ev(logging, 'guildMemberRemove');
  const onGUpdate = ev(logging, 'guildMemberUpdate');

  clearRec();
  await onDelete(ctxBase, { guild: null });
  check('tin nhắn DM -> bỏ qua', rec.sends.length === 0);
  clearRec();
  await onDelete(ctxBase, {
    guild: { id: GUILD }, channel: fakeChannel, author: { toString: () => '@A' },
    content: 'nội dung', attachments: new Collection(),
  });
  check('ghi log tin xoá', logSends().some((s) => emb(s).title === '🗑️ Tin nhắn bị xóa'));
  check('log có nội dung', logSends().some((s) => emb(s).description.includes('nội dung')));
  clearRec();
  await onDelete(ctxBase, {
    guild: { id: GUILD }, channel: fakeChannel, content: '', attachments: new Collection(),
  });
  check('không có author -> không in dòng tác giả', !logSends()[0] || !emb(logSends()[0]).description.includes('Tác giả'), emb(logSends()[0]).description);
  clearRec();
  await onDelete(ctxBase, {
    guild: { id: GUILD }, channel: fakeChannel, author: { toString: () => '@A' },
    content: '', attachments: new Collection([['a', {}], ['b', {}]]),
  });
  check('có 2 attachment -> ghi số lượng', /2 attachment/.test(emb(logSends()[0]).description), emb(logSends()[0]).description);

  clearRec();
  await onUpdate(ctxBase, null, { guild: null });
  check('update DM -> bỏ qua', rec.sends.length === 0);
  clearRec();
  await onUpdate(ctxBase, {}, { guild: { id: GUILD }, author: { bot: true, toString: () => '@B' }, channel: fakeChannel, content: 'a', url: 'u' });
  check('update của BOT -> bỏ qua (memory đã ghi)', rec.sends.length === 0, String(rec.sends.length));
  clearRec();
  await onUpdate(ctxBase,
    { content: 'cũ' },
    { guild: { id: GUILD }, author: { bot: false, toString: () => '@A' }, channel: fakeChannel, content: 'mới', url: 'https://x/jump' });
  check('update của người -> ghi log', logSends().some((s) => emb(s).title === '✏️ Tin nhắn bị sửa'));
  check('log có cả cũ lẫn mới', /Cũ: `cũ`/.test(emb(logSends()[0]).description) && /Mới: `mới`/.test(emb(logSends()[0]).description), emb(logSends()[0]).description);
  check('log có link nhảy', emb(logSends()[0]).description.includes('[Nhảy tới](https://x/jump)'));
  clearRec();
  await onUpdate(ctxBase,
    { content: 'giống nhau' },
    { guild: { id: GUILD }, author: { bot: false, toString: () => '@A' }, channel: fakeChannel, content: 'giống nhau', url: 'u' });
  check('nội dung không đổi -> không in dòng Cũ/Mới', !/Cũ:/.test(emb(logSends()[0]).description), emb(logSends()[0]).description);
  check('vẫn ghi log (vì có link nhảy)', logSends().length === 1);

  // Mock GuildMember phải có `guild.id` — sendLog nhận guildId từ đó. Bản cũ
  // không đọc nên mock thiếu cũng chạy; giờ thiếu là ném TypeError.
  clearRec();
  await onGAdd(ctxBase, { guild: { id: GUILD, memberCount: 42 }, user: { tag: 'N#1', displayAvatarURL: () => 'https://x/av.png' }, toString: () => '@N' });
  check('ghi log vào server', logSends().some((s) => emb(s).title === '📥 Vào server'));
  check('log có số thứ tự thành viên', /Thành viên thứ 42/.test(emb(logSends()[0]).description), JSON.stringify(emb(logSends()[0]).description));
  clearRec();
  await onGRemove(ctxBase, { guild: { id: GUILD, memberCount: 41 }, user: { tag: 'N#1', displayAvatarURL: () => 'https://x/av.png' }, toString: () => '@N' });
  check('ghi log rời server', logSends().some((s) => emb(s).title === '📤 Rời server'));

  clearRec();
  const rm = (id) => ({ id, toString: () => '@r' + id });
  // logging.js đọc oldMember.user.username khi nickname rỗng → mock phải có user
  const gmu = (nickname, roleIds = []) => ({
    nickname,
    guild: { id: GUILD, memberCount: 42 },
    user: { username: 'N' },
    roles: { cache: new Collection(roleIds.map((id) => [id, rm(id)])) },
    toString: () => '@N',
  });
  clearRec();
  await onGUpdate(ctxBase, gmu(null), gmu('Biệt Danh'));
  check('đổi biệt danh -> ghi log', /Biệt danh: `N` → `Biệt Danh`/.test(emb(logSends()[0]).description), emb(logSends()[0]).description);
  clearRec();
  await onGUpdate(ctxBase, gmu('A'), gmu(null));
  check('bỏ biệt danh -> hiện username thay thế', /`A` → `N`/.test(emb(logSends()[0]).description), emb(logSends()[0]).description);
  clearRec();
  await onGUpdate(ctxBase, gmu(null), gmu(null, ['111']));
  check('thêm role -> ghi log', /Thêm role: @r111/.test(emb(logSends()[0]).description), emb(logSends()[0]).description);
  clearRec();
  await onGUpdate(ctxBase, gmu(null, ['222']), gmu(null));
  check('gỡ role -> ghi log', /Gỡ role: @r222/.test(emb(logSends()[0]).description), emb(logSends()[0]).description);
  clearRec();
  await onGUpdate(ctxBase, gmu(null), gmu(null));
  check('không có thay đổi gì -> KHÔNG ghi log', rec.sends.length === 0, String(rec.sends.length));

  // ══════════════════════════════ WELCOME ═══════════════════════════════
  console.log('\n=== WELCOME ===');
  const onWelcome = ev(welcome, 'guildMemberAdd');
  clearRec();
  added.length = 0;
  await onWelcome(ctxBase, {
    user: { tag: 'Mới#1', displayAvatarURL: () => 'https://x/av.png' },
    guild: { id: GUILD, name: 'server g n u r t', memberCount: 77 },
    toString: () => '@Mới',
    roles: { add: async (r) => added.push(['w', r]) },
  });
  check('gán role 🌱 cho thành viên mới', added.some((a) => a[1] === ctxBase.cfg(GUILD).roles.newbie), JSON.stringify(added));
  check('gửi embed chào', rec.sends.some((s) => emb(s).title === '👋 Chào mừng mới!'));
  check('embed nhắc tên server', logSends().some((s) => emb(s).description.includes('server g n u r t')));
  check('embed nhắc số thứ tự', logSends().some((s) => emb(s).description.includes('thành viên thứ **77**')));

  clearRec();
  added.length = 0;
  await onWelcome({ ...ctxBase, cfg: () => ({ channels: { welcome: ctxBase.cfg(GUILD).channels.welcome }, roles: {} }) },
    { user: { tag: 'M#1', displayAvatarURL: () => 'https://x/av.png' }, guild: { id: GUILD, name: 's', memberCount: 1 }, toString: () => '@M', roles: { add: async (r) => added.push(r) } });
  check('thiếu NEWBIE_ROLE_ID -> bỏ qua role', added.length === 0);
  check('vẫn gửi embed chào', rec.sends.length === 1);
  clearRec();
  await onWelcome({ ...ctxBase, cfg: () => ({ channels: {}, roles: { newbie: ctxBase.cfg(GUILD).roles.newbie } }) },
    { user: { tag: 'M#1', displayAvatarURL: () => 'https://x/av.png' }, guild: { id: GUILD, name: 's', memberCount: 1 }, toString: () => '@M', roles: { add: async () => {} } });
  check('thiếu WELCOME_CHANNEL_ID -> không gửi', rec.sends.length === 0);
  clearRec();
  await onWelcome(ctxBase, {
    user: { tag: 'M#1', displayAvatarURL: () => 'https://x/av.png' }, guild: { id: GUILD, name: 's', memberCount: 1 }, toString: () => '@M',
    roles: { add: async () => { throw new Error('Missing Permissions'); } },
  });
  check('gán role lỗi -> vẫn gửi được embed chào', rec.sends.length === 1, String(rec.sends.length));
  clearRec();
  const badSend = { ...ctxBase, client: { channels: { fetch: async () => { throw new Error('Unknown Channel'); } } } };
  await onWelcome(badSend, {
    user: { tag: 'M#1', displayAvatarURL: () => 'https://x/av.png' }, guild: { id: GUILD, name: 's', memberCount: 1 }, toString: () => '@M',
    roles: { add: async () => {} },
  });
  check('kênh lỗi -> không crash', true);

  console.log('\n=== sendLog khi thiếu LOG_CHANNEL_ID ===');
  clearRec();
  const { sendLog } = require(path.join(GUARD, 'src/core/log'));
  await sendLog({ ...ctxBase, cfg: () => ({ channels: {}, roles: {} }) }, GUILD, { __t: 1 });
  check('thiếu LOG_CHANNEL_ID -> im lặng, không throw', rec.sends.length === 0);
  await sendLog({ client: { channels: { fetch: async () => { throw new Error('no access'); } } }, cfg: () => ({ channels: { log: '1' } }) }, GUILD, { __t: 1 });
  check('fetch lỗi -> im lặng, không throw', true);

  // ═══════════════════════════════ LEVELS ═══════════════════════════════
  console.log('\n=== LEVELS (công thức / XP / role) ===');
  // Module không export hàm nội bộ → nạp lại từ source, đúng convention
  // test-suggestions-logic.js:197.
  const lvSrc = fs.readFileSync(path.join(GUARD, 'src/modules/levels.js'), 'utf8');
  const grab = (re) => {
    const m = lvSrc.match(re);
    if (!m) throw new Error('không tìm thấy: ' + re);
    return new Function('return ' + m[0] + ';')();
  };
  const levelOf = grab(/function levelOf\(xp\) \{[\s\S]*?\n\}/);
  const xpAtLevel = grab(/function xpAtLevel\(level\) \{[\s\S]*?\n\}/);
  const rankFor = grab(/function rankFor\(roles, level\) \{[\s\S]*?\n\}/);
  const progressBar = grab(/function progressBar\(cur, need, width\) \{[\s\S]*?\n\}/);

  const RANKS = [
    { name: 'Sắt', roleId: '1554809014708080671', emojiId: '1554806770478878720', level: 1, color: 3483428 },
    { name: 'Đồng', roleId: '1554809009863921716', emojiId: '1554806772487688202', level: 3, color: 8343097 },
    { name: 'Bạc', roleId: '1554809005166166087', emojiId: '1554806774463463444', level: 5, color: 4151669 },
    { name: 'Vàng', roleId: '1554809000418222080', emojiId: '1554806776363491430', level: 8, color: 14127393 },
    { name: 'Bạch Kim', roleId: '1554808995494105220', emojiId: '1554806778380816404', level: 12, color: 695908 },
    { name: 'Kim Cương', roleId: '1554808990884561016', emojiId: '1554806780314255412', level: 16, color: 2107067 },
    { name: 'Cao Thủ', roleId: '1554808985729896519', emojiId: '1554806782197502015', level: 21, color: 7870868 },
    { name: 'Đại Cao Thủ', roleId: '1554808981011173447', emojiId: '1554806784328339456', level: 27, color: 9770808 },
    { name: 'Thách đầu', roleId: '1554808976078536705', emojiId: '1554806786719088660', level: 34, color: 359858 },
  ];
  const lvCtx = {
    ...ctxBase,
    config: { ...ctxBase.config, levels: { xp: { message: 1, reaction: 2 }, cooldownMs: 60000, voice: { xpPer: 10, perMinutes: 5 }, roles: RANKS } },
  };

  console.log('-- công thức sqrt --');
  check('0 XP -> level 1', levelOf(0) === 1, String(levelOf(0)));
  check('99 XP -> level 1', levelOf(99) === 1, String(levelOf(99)));
  check('100 XP -> level 2', levelOf(100) === 2, String(levelOf(100)));
  check('399 XP -> level 2', levelOf(399) === 2, String(levelOf(399)));
  check('400 XP -> level 3', levelOf(400) === 3, String(levelOf(400)));
  check('1600 XP -> level 5', levelOf(1600) === 5, String(levelOf(1600)));
  check('8100 XP -> level 10', levelOf(8100) === 10, String(levelOf(8100)));
  check('36100 XP -> level 20', levelOf(36100) === 20, String(levelOf(36100)));
  check('xp âm/NaN/str -> level 1', levelOf(-50) === 1 && levelOf(NaN) === 1 && levelOf('abc') === 1);
  check('xpAtLevel(1)=0, (2)=100, (21)=40000', xpAtLevel(1) === 0 && xpAtLevel(2) === 100 && xpAtLevel(21) === 40000, String(xpAtLevel(21)));
  // Mốc quan trọng: bắt lỗi off-by-one (xpAtLevel trả level^2*100 thì số này SAI)
  check('xp đúng mốc -> đúng level (36 mốc liên tiếp)', Array.from({ length: 36 }, (_, i) => levelOf(xpAtLevel(i + 1))).every((v, i) => v === i + 1));

  console.log('-- rankFor --');
  check('level 1 -> Sắt', (rankFor(RANKS, 1) || {}).name === 'Sắt', JSON.stringify(rankFor(RANKS, 1)));
  check('level 3 -> Đồng', (rankFor(RANKS, 3) || {}).name === 'Đồng');
  check('level 5 -> Bạc', (rankFor(RANKS, 5) || {}).name === 'Bạc');
  check('level 8 -> Vàng', (rankFor(RANKS, 8) || {}).name === 'Vàng');
  check('level 12 -> Bạch Kim', (rankFor(RANKS, 12) || {}).name === 'Bạch Kim');
  check('level 34 -> Thách đầu', (rankFor(RANKS, 34) || {}).name === 'Thách đầu');
  check('level 99 -> vẫn Thách đầu', (rankFor(RANKS, 99) || {}).name === 'Thách đầu');
  check('mảng roles đảo thứ tự vẫn đúng', (rankFor(RANKS.slice().reverse(), 8) || {}).name === 'Vàng');
  check('roles rỗng -> null', rankFor([], 5) === null);

  console.log('-- progressBar --');
  check('0% -> toàn khoảng trống', progressBar(0, 100) === '`[' + '░'.repeat(14) + ']`', progressBar(0, 100));
  check('100% -> toàn đặc', progressBar(100, 100) === '`[' + '█'.repeat(14) + ']`', progressBar(100, 100));
  check('50% -> nửa', progressBar(50, 100) === '`[' + '█'.repeat(7) + '░'.repeat(7) + ']`', progressBar(50, 100));
  check('need = 0 -> không NaN', !/NaN/.test(progressBar(0, 0)), progressBar(0, 0));

  console.log('-- XP tin nhắn --');
  resetData('levels.json', {});
  const mkLvMsg = (authorId, content, over = {}) => ({
    id: '800', guildId: GUILD, guild: { id: GUILD }, content,
    author: { id: authorId, bot: false },
    channel: { send: async (p) => rec.sends.push(p) },
    ...over,
  });
  const onLvMsg = ev(levels, 'messageCreate');
  clearRec();
  await onLvMsg(lvCtx, mkLvMsg('600', 'xin chào'));
  check('tin đầu -> +1 XP', readData('levels.json')['600']?.xp === 1, JSON.stringify(readData('levels.json')['600']));
  await onLvMsg(lvCtx, mkLvMsg('600', 'tin thứ hai ngay'));
  check('tin sau đó -> cooldown, KHÔNG cộng', readData('levels.json')['600'].xp === 1, String(readData('levels.json')['600'].xp));
  check('cooldown lưu lastMsg', readData('levels.json')['600'].lastMsg > 0);

  clearRec();
  await onLvMsg(lvCtx, mkLvMsg('601', 'bot nói', { author: { id: '601', bot: true } }));
  await onLvMsg(lvCtx, mkLvMsg('602', '   '));
  await onLvMsg(lvCtx, mkLvMsg('603', '`code block`'));
  await onLvMsg(lvCtx, mkLvMsg('604', '> quote'));
  await onLvMsg(lvCtx, mkLvMsg('605', 'DM', { guild: null }));
  const lvKeys = Object.keys(readData('levels.json'));
  check('bot / rỗng / ` / > / DM -> không tạo record', lvKeys.length === 1 && lvKeys[0] === '600', JSON.stringify(lvKeys));

  console.log('-- XP reaction --');
  const onLvReact = ev(levels, 'messageReactionAdd');
  const mkLvReaction = (msg, over = {}) => ({ message: msg, partial: false, ...over });
  resetData('levels.json', {});
  clearRec();
  await onLvReact(lvCtx, mkLvReaction(mkLvMsg('610', 'tin của tôi')), { id: '999', bot: false });
  check('người khác thả reaction -> +2 XP cho tác giả', readData('levels.json')['610']?.xp === 2, JSON.stringify(readData('levels.json')['610']));
  await onLvReact(lvCtx, mkLvReaction(mkLvMsg('611', 'tự thả', { author: { id: '611', bot: false } })), { id: '611', bot: false });
  check('tự react tin mình -> không cộng', readData('levels.json')['611'] === undefined, JSON.stringify(readData('levels.json')['611']));
  await onLvReact(lvCtx, mkLvReaction(mkLvMsg('612', 'bot thả', { author: { id: '612', bot: false } })), { id: '998', bot: true });
  check('người bấm là bot -> không cộng', readData('levels.json')['612'] === undefined);
  await onLvReact(lvCtx, mkLvReaction(mkLvMsg('613', 'ngoài guild', { author: { id: '613', bot: false }, guild: null })), { id: '999', bot: false });
  check('reaction ngoài guild -> không cộng', readData('levels.json')['613'] === undefined);
  await onLvReact(lvCtx, { message: mkLvMsg('614', 'partial', { author: { id: '614', bot: false } }), partial: true, fetch: async () => { throw new Error('Unknown Message'); } }, { id: '999', bot: false });
  check('partial fetch lỗi -> bỏ qua, không crash', readData('levels.json')['614'] === undefined);

  console.log('-- XP voice --');
  const onLvVoice = ev(levels, 'voiceStateUpdate');
  // guild phải nằm trên state: module lấy `(newState.guild || oldState.guild)?.id`
  // chứ không đoán qua client.guilds.
  const mkVs = (id, channelId, over = {}) => ({ id, channelId, guild: { id: GUILD }, ...over });
  resetData('levels.json', {});
  await onLvVoice(lvCtx, mkVs('620', null), mkVs('620', 'VC1'));
  check('vào voice -> ghi voiceStart', readData('levels.json')['620']?.voiceStart > 0, JSON.stringify(readData('levels.json')['620']));
  // 5 phút = 300000ms; xpPer 10 / 5 phút -> perMs = 10/300000
  const realNow = Date.now;
  Date.now = () => realNow() + 5 * 60 * 1000;
  await onLvVoice(lvCtx, mkVs('620', 'VC1'), mkVs('620', null));
  Date.now = realNow;
  check('nghe 5 phút rồi rời -> +10 XP (không cộng đôi)', readData('levels.json')['620']?.xp === 10, String(readData('levels.json')['620']?.xp));
  check('rời voice -> xoá voiceStart', readData('levels.json')['620'].voiceStart === 0);
  check('rời voice -> quỹ voiceAcc về 0', readData('levels.json')['620'].voiceAcc === 0);
  await onLvVoice(lvCtx, mkVs('620', null), mkVs('620', 'VC1'));
  const vs1 = readData('levels.json')['620'].voiceStart;
  Date.now = () => realNow() + 60 * 1000;
  // mute/deafen/stream: channelId KHÔNG đổi — nếu không chặn thì mất XP voice
  await onLvVoice(lvCtx, mkVs('620', 'VC1', { selfMute: false }), mkVs('620', 'VC1', { selfMute: true }));
  Date.now = realNow;
  check('mute (cùng kênh) -> KHÔNG reset mốc voiceStart', readData('levels.json')['620'].voiceStart === vs1, String(readData('levels.json')['620'].voiceStart));
  check('mute -> XP không bị cộng sớm', readData('levels.json')['620'].xp === 10, String(readData('levels.json')['620'].xp));
  await onLvVoice(lvCtx, mkVs('621', 'VC1'), mkVs('621', 'VC2'));
  check('đổi kênh -> vẫn chốt được (không mất đoạn nghe)', readData('levels.json')['621']?.voiceStart > 0, JSON.stringify(readData('levels.json')['621']));
  check('đổi kênh chưa đủ thời gian -> +0 XP', readData('levels.json')['621']?.xp === 0, String(readData('levels.json')['621']?.xp));

  console.log('-- gán/gỡ role rank --');
  resetData('levels.json', {});
  const roleOps = [];
  const mkRoleMember = (id, heldRoleIds = []) => ({
    id,
    user: { id, bot: false },
    roles: {
      cache: new Collection(heldRoleIds.map((r) => [r, { id: r }])),
      add: async (r) => roleOps.push(['add', r]),
      remove: async (r) => roleOps.push(['rm', r]),
    },
  });
  // position: Guardian ở pos 18, 9 rank role ở 1..9 -> bot cấp/gỡ được hết.
  const mkLvGuild = (mePos = 18, held = [RANKS[0].roleId]) => {
    const g = {
      id: GUILD,
      roles: { cache: new Collection(RANKS.map((r, i) => [r.roleId, { id: r.roleId, position: i + 1 }])) },
      members: { me: { id: BOT, roles: { highest: { position: mePos } } } },
    };
    g.members.fetch = async (uid) =>
      uid === 'bot-user'
        ? { user: { bot: true }, roles: { cache: new Collection(), add: async () => {}, remove: async () => {} } }
        : mkRoleMember(uid, held);
    return g;
  };
  // Emoji thật trên server đều STATIC, tên rank_<bậc> (đối chiếu API 30/09/2026).
  // Guard này bắt được bug hardcode `<a:rank_x:ID>` — sai prefix lẫn sai tên.
  const EMOJI_NAME = {
    '1554806770478878720': 'rank_sat',
    '1554806772487688202': 'rank_dong',
    '1554806774463463444': 'rank_bac',
    '1554806776363491430': 'rank_vang',
    '1554806778380816404': 'rank_bachkim',
    '1554806780314255412': 'rank_kimcuong',
    '1554806782197502015': 'rank_caothu',
    '1554806784328339456': 'rank_daicaothu',
    '1554806786719088660': 'rank_thachdau',
  };
  const mkEmojiCache = (animatedIds = []) =>
    new Collection(
      RANKS.map((r) => [
        r.emojiId,
        { id: r.emojiId, name: EMOJI_NAME[r.emojiId], animated: animatedIds.includes(r.emojiId) },
      ])
    );
  const mkLvClient = (guild, emojiCache) => {
    if (guild && !guild.emojis) {
      const cache = emojiCache || mkEmojiCache();
      guild.emojis = { cache, fetch: async () => cache };
    }
    // Guild KHÁC nằm TRƯỚC trong Collection: bản single-guild từng đoán
    // `guilds.cache.values().next().value` và luôn ra đúng vì chỉ có 1 guild.
    // Ở đân thứ tự cố tình ngược lại để mọi phỏng đoán còn sót fail ngay.
    const others = [[GUILD2, mkLvGuild(18, [])]];
    return {
      channels: { fetch: async (id) => channels.get(id) || fakeChannel },
      guilds: { cache: new Collection(guild ? [...others, [GUILD, guild]] : [...others]) },
    };
  };
  const lvRoleCtx = { ...lvCtx, client: mkLvClient(mkLvGuild()) };

  roleOps.length = 0;
  await onLvMsg(lvRoleCtx, mkLvMsg('630', 'a'));
  check('chưa đổi level (vẫn Lv1) -> không động role', roleOps.length === 0, JSON.stringify(roleOps));

  // 99 -> 100: lên level 2, bậc vẫn Sắt -> gán Sắt cho member chưa có role nào
  roleOps.length = 0;
  clearRec();
  resetData('levels.json', { '631': { xp: 99, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  const noRoleCtx = { ...lvRoleCtx, client: mkLvClient(mkLvGuild(18, [])) };
  await onLvMsg(noRoleCtx, mkLvMsg('631', 'x'));
  check('lên level 2 -> gán Sắt', roleOps.some((o) => o[0] === 'add' && o[1] === RANKS[0].roleId), JSON.stringify(roleOps));
  check('gán bậc mới -> KHÔNG gỡ chính bậc đó', !roleOps.some((o) => o[0] === 'rm' && o[1] === RANKS[0].roleId), JSON.stringify(roleOps));
  check('lên level -> XP cộng đúng 1', readData('levels.json')['631'].xp === 100, String(readData('levels.json')['631'].xp));
  check('lên level -> thông báo trong kênh', rec.sends.some((s) => typeof s === 'string' && /Level 2/.test(s)), JSON.stringify(rec.sends));

  // 399 -> 400: lên level 3 -> bậc Đồng: gỡ Sắt, gán Đồng
  roleOps.length = 0;
  clearRec();
  resetData('levels.json', { '632': { xp: 399, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  await onLvMsg(lvRoleCtx, mkLvMsg('632', 'x'));
  check('lên level 3 -> gỡ Sắt', roleOps.some((o) => o[0] === 'rm' && o[1] === RANKS[0].roleId), JSON.stringify(roleOps));
  check('lên level 3 -> gán Đồng', roleOps.some((o) => o[0] === 'add' && o[1] === RANKS[1].roleId), JSON.stringify(roleOps));
  check('lên level 3 -> báo Level 3', rec.sends.some((s) => typeof s === 'string' && /Level 3/.test(s)), JSON.stringify(rec.sends));

  // Role đích cao hơn bot -> KHÔNG cấp được, nhưng role cũ thấp hơn vẫn gỡ được.
  // mePos = 3: Sắt (pos 1) + Đồng (pos 2) quản lý được; Đại Cao Thủ (pos 8) thì không.
  // 102399 -> level 32; +1 = 102400 -> level 33 (mốc chuyển level thật).
  roleOps.length = 0;
  resetData('levels.json', { '633': { xp: 102399, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  await onLvMsg({ ...lvRoleCtx, client: mkLvClient(mkLvGuild(3)) }, mkLvMsg('633', 'x'));
  check('role đích cao hơn bot -> KHÔNG cấp',
    !roleOps.some((o) => o[0] === 'add' && o[1] === RANKS[7].roleId), JSON.stringify(roleOps));
  check('role cũ thấp hơn bot -> vẫn gỡ được',
    roleOps.some((o) => o[0] === 'rm' && o[1] === RANKS[0].roleId), JSON.stringify(roleOps));
  check('vẫn cộng XP', readData('levels.json')['633'].xp === 102400, String(readData('levels.json')['633'].xp));

  // toàn bộ role rank nằm >= cao nhất bot -> không động role gì, không throw
  roleOps.length = 0;
  resetData('levels.json', { '633b': { xp: 399, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  await onLvMsg({ ...lvRoleCtx, client: mkLvClient(mkLvGuild(0)) }, mkLvMsg('633b', 'x'));
  check('mọi role rank đều cao hơn bot -> không động role, không crash',
    roleOps.length === 0 && readData('levels.json')['633b'].xp === 400, JSON.stringify(roleOps));

  // Member là bot -> không gán role
  roleOps.length = 0;
  resetData('levels.json', { 'bot-user': { xp: 399, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  await onLvMsg(lvRoleCtx, mkLvMsg('bot-user', 'x'));
  check('member là bot -> không động role', roleOps.length === 0, JSON.stringify(roleOps));

  // Không có guild trong cache -> không crash
  resetData('levels.json', { '634': { xp: 399, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  await onLvMsg({ ...lvRoleCtx, client: mkLvClient(null) }, mkLvMsg('634', 'x'));
  check('không có guild -> không crash', readData('levels.json')['634'].xp === 400, String(readData('levels.json')['634'].xp));

  // member.roles.add ném lỗi -> không làm hỏng phần XP
  roleOps.length = 0;
  resetData('levels.json', { '635': { xp: 399, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  const throwGuild = mkLvGuild();
  throwGuild.members.fetch = async () => ({ user: { bot: false }, roles: { cache: new Collection(), add: async () => { throw new Error('Missing Permissions'); }, remove: async () => {} } });
  await onLvMsg({ ...lvRoleCtx, client: mkLvClient(throwGuild) }, mkLvMsg('635', 'x'));
  check('gán role lỗi -> XP vẫn đã cộng', readData('levels.json')['635'].xp === 400, String(readData('levels.json')['635'].xp));

  console.log('-- /level --');
  // /level và /leaderboard cần guild có emojis.cache để rankTag() render được icon.
  const lvEmojiCtx = { ...lvCtx, client: mkLvClient(mkLvGuild()) };
  resetData('levels.json', {});
  clearRec();
  const lvUser = { id: '700', username: 'Tester', displayAvatarURL: () => 'https://x/a.png' };
  let li = sub('level', 'level', {}, { user: lvUser });
  li.i.options.getUser = () => null;
  check('/level -> true', (await levels.handleInteraction(li.i, lvEmojiCtx)) === true);
  check('/level ephemeral', li.captured?.flags === MessageFlags.Ephemeral, JSON.stringify(li.captured?.flags));
  check('0 XP -> Level 1', (emb(li.captured).author?.name || '').includes('Level 1'), emb(li.captured).author?.name);
  check('0 XP -> bậc Sắt', /Sắt/.test(emb(li.captured).description || ''), emb(li.captured).description);
  check('màu embed theo bậc', emb(li.captured).color === 3483428, String(emb(li.captured).color));
  check('có progress bar', /█|░/.test(emb(li.captured).description || ''), emb(li.captured).description);

  resetData('levels.json', { '701': { xp: 1600, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  clearRec();
  const hiUser = { id: '701', username: 'High', displayAvatarURL: () => 'https://x/a.png' };
  li = sub('level', 'level', {}, { user: hiUser });
  li.i.options.getUser = () => hiUser;
  await levels.handleInteraction(li.i, lvEmojiCtx);
  const desc701 = emb(li.captured).description;
  check('1600 XP -> Level 5', (emb(li.captured).author?.name || '').includes('Level 5'), emb(li.captured).author?.name);
  check('1600 XP -> bậc Bạc', /\bBạc\b/.test(desc701), desc701);
  // 1600 - xpAtLevel(5)=1600 -> cur 0; xpAtLevel(6)=2500 -> need 900
  check('Level 5 -> 0 / 900 XP (off-by-one)', /\b0 \/ 900 XP\b/.test(desc701), desc701);
  check('Level 5 -> tổng XP 1600', /Tổng XP: \*\*1600\*\*/.test(desc701), desc701);
  check('footer Level 5 → 6', (emb(li.captured).footer?.text || '').includes('Level 5 → 6'), emb(li.captured).footer?.text);
  // Emoji Bạc là STATIC tên rank_bac -> markup phải <:rank_bac:ID>.
  // Hardcode `<a:rank_x:ID>` khiến Discord không render, hiện raw text.
  check(
    'nhúng emoji rank đúng markup static <:ten:id>',
    desc701.includes(`<:rank_bac:${RANKS[2].emojiId}>`),
    desc701
  );
  check('KHÔNG dùng prefix <a:> cho emoji static', !/<a:/.test(desc701), desc701);
  check('KHÔNG hardcode tên rank_x', !/rank_x/.test(desc701), desc701);

  // Emoji animated phải ra <a:ten:id> — nhánh này test cũ không chạm tới.
  resetData('levels.json', { '702': { xp: 1600, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  clearRec();
  const animCtx = { ...lvCtx, client: mkLvClient(mkLvGuild(), mkEmojiCache([RANKS[2].emojiId])) };
  const animUser = { id: '702', username: 'Anim', displayAvatarURL: () => 'https://x/a.png' };
  li = sub('level', 'level', {}, { user: animUser });
  li.i.options.getUser = () => animUser;
  await levels.handleInteraction(li.i, animCtx);
  const desc702 = emb(li.captured).description;
  check('emoji animated -> markup <a:ten:id>', desc702.includes(`<a:rank_bac:${RANKS[2].emojiId}>`), desc702);

  // Cache thiếu emoji -> fallback unicode, không crash.
  resetData('levels.json', { '703': { xp: 1600, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  clearRec();
  const noEmojiCtx = { ...lvCtx, client: mkLvClient(mkLvGuild(), new Collection()) };
  const noEmojiUser = { id: '703', username: 'NoEmoji', displayAvatarURL: () => 'https://x/a.png' };
  li = sub('level', 'level', {}, { user: noEmojiUser });
  li.i.options.getUser = () => noEmojiUser;
  check('emoji không có trong cache -> fallback 🏅, không crash', (await levels.handleInteraction(li.i, noEmojiCtx)) === true && /🏅/.test(emb(li.captured).description || ''), emb(li.captured).description);

  // Không có guild trong cache -> fallback, không crash.
  resetData('levels.json', { '704': { xp: 1600, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  clearRec();
  const noGuildUser = { id: '704', username: 'NoGuild', displayAvatarURL: () => 'https://x/a.png' };
  li = sub('level', 'level', {}, { user: noGuildUser });
  li.i.options.getUser = () => noGuildUser;
  check('không có guild -> fallback 🏅, không crash', (await levels.handleInteraction(li.i, lvCtx)) === true && /🏅/.test(emb(li.captured).description || ''), emb(li.captured).description);

  console.log('-- /leaderboard --');
  resetData('levels.json', {});
  clearRec();
  li = sub('leaderboard', 'leaderboard', {});
  check('/leaderboard -> true', (await levels.handleInteraction(li.i, lvEmojiCtx)) === true);
  check('chưa ai có XP -> báo riêng', /Chưa có ai/.test(li.captured?.content || ''), li.captured?.content);

  resetData('levels.json', {
    '801': { xp: 1600, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 },
    '802': { xp: 36100, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 },
    '803': { xp: 100, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceStart: 0, voiceAcc: 0 },
    '804': { xp: 0, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 },
  });
  clearRec();
  li = sub('leaderboard', 'leaderboard', {});
  await levels.handleInteraction(li.i, lvEmojiCtx);
  const lb = emb(li.captured);
  const lbLines = (lb.description || '').split('\n');
  check('tiêu đề bảng', lb.title === '🏆 Bảng xếp hạng level', lb.title);
  check('bỏ user 0 XP', !lbLines.some((l) => l.includes('<@804>')), lb.description);
  check('3 dòng (top 3)', lbLines.length === 3, String(lbLines.length));
  check('🥇 cho người nhiều XP nhất', lbLines[0].startsWith('🥇 <@802>'), lbLines[0]);
  check('🥈 cho người thứ nhì', lbLines[1].startsWith('🥈 <@801>'), lbLines[1]);
  check('🥉 cho người thứ ba', lbLines[2].startsWith('🥉 <@803>'), lbLines[2]);
  check('dòng có level + XP', /Lv \*\*20\*\* · \*\*36100\*\* XP/.test(lbLines[0]), lbLines[0]);
  check('bảng KHÔNG ephemeral (ai cũng xem được)', li.captured?.flags === undefined, JSON.stringify(li.captured?.flags));
  // 36100 XP -> Lv 20 -> Kim Cương (level 16); 1600 -> Bạc (5); 100 -> Đồng (3).
  check('bảng nhúng icon rank markup đúng', lbLines[0].includes(`<:rank_kimcuong:${RANKS[5].emojiId}>`), lbLines[0]);
  check('bảng KHÔNG dùng <a:> cho emoji static', !/<a:/.test(lb.description || ''), lb.description);

  // /leaderboard phải chốt XP voice của người còn đang trong kênh
  resetData('levels.json', { '805': { xp: 0, lastMsg: 0, lastReact: 0, voiceStart: realNow() - 5 * 60 * 1000, voiceAcc: 0 } });
  clearRec();
  li = sub('leaderboard', 'leaderboard', {});
  await levels.handleInteraction(li.i, lvEmojiCtx);
  check('/leaderboard chốt XP voice đang dở', readData('levels.json')['805'].xp === 10, String(readData('levels.json')['805'].xp));
  check('sau khi chốt -> voiceAcc về 0, voiceStart giữ mốc mới', readData('levels.json')['805'].voiceAcc === 0 && readData('levels.json')['805'].voiceStart > 0, JSON.stringify(readData('levels.json')['805']));

  console.log('-- guard --');
  li = sub('tag', 'list', {});
  check('lệnh module khác -> false', (await levels.handleInteraction(li.i, lvCtx)) === false);
  li = mkIface({ isChatInputCommand: () => false, commandName: 'level' });
  check('không phải chat input -> false', (await levels.handleInteraction(li.i, lvCtx)) === false);
  const noRankCtx = { ...lvCtx, config: { ...lvCtx.config, levels: { ...lvCtx.config.levels, roles: [] } } };
  clearRec();
  li = sub('level', 'level', {}, { user: lvUser });
  li.i.options.getUser = () => null;
  check('config.levels.roles rỗng -> vẫn trả lệnh, báo chưa có bậc', (await levels.handleInteraction(li.i, noRankCtx)) === true && /chưa có bậc nào/.test(emb(li.captured).description || ''), emb(li.captured).description);

  console.log('-- init --');
  // init() phải nạp emoji qua REST: gateway KHÔNG gửi emoji trong GUILD_CREATE
  // nên cache rỗng lúc khởi động, rankTag() sẽ mất icon nếu không nạp trước.
  const emojiFetchCalls = [];
  const emojiGuild = mkLvGuild();
  emojiGuild.emojis = {
    cache: new Collection(),
    fetch: async () => {
      emojiFetchCalls.push('fetch');
      for (const [id, e] of mkEmojiCache()) emojiGuild.emojis.cache.set(id, e);
      return emojiGuild.emojis.cache;
    },
  };
  await levels.init({ ...lvRoleCtx, client: mkLvClient(emojiGuild) }, GUILD);
  check('init gọi guild.emojis.fetch()', emojiFetchCalls.length === 1, JSON.stringify(emojiFetchCalls));
  check('sau init thì emoji có trong cache', emojiGuild.emojis.cache.size === RANKS.length, String(emojiGuild.emojis.cache.size));

  await levels.init(lvRoleCtx, GUILD);
  check('init role hợp lệ -> không throw', true);

  // emojis.fetch() lỗi -> init vẫn chạy tiếp, chỉ warn (không chặn phần role).
  const throwEmojiGuild = mkLvGuild();
  throwEmojiGuild.emojis = {
    cache: new Collection(),
    fetch: async () => {
      throw new Error('Missing Access');
    },
  };
  await levels.init({ ...lvRoleCtx, client: mkLvClient(throwEmojiGuild) }, GUILD);
  check('emojis.fetch lỗi -> init không throw', true);

  await levels.init({ ...lvRoleCtx, client: mkLvClient(null) }, GUILD);
  check('init không có guild -> không throw', true);
  await levels.init(noRankCtx, GUILD);
  check('init roles rỗng -> không throw', true);

  // ═══════════════════ CÔ LẬP 2 GUILD (lớp bug bản single-guild không có) ═════
  // Mọi test phía trên chạy trên MỘT guild — nghĩa là bất kỳ chỗ nào đoán guild
  // "đầu tiên trong cache" đều pass. Ở đây guild SAI cố tình nằm TRƯỚC trong
  // Collection: mọi `guilds.cache.values().next().value` còn sót sẽ chọn nhầm nó
  // và fail ngay.
  console.log('\n=== CÔ LẬP 2 GUILD ===');
    const CHAN2 = '900000000000000003';
  channels.set(CHAN2, mkChannel(CHAN2, 'chat-server-2'));

  const mkG2Msg = (authorId, content) => ({
    id: 'g2-' + authorId, guildId: GUILD2, guild: { id: GUILD2 }, content,
    author: { id: authorId, bot: false, toString: () => '@' + authorId },
    channel: channels.get(CHAN2),
    delete: async () => {},
  });

  // XP cùng một userId ở 2 server phải tách bể.
  store.write(GUILD, 'levels', { shared: { xp: 500, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  store.write(GUILD2, 'levels', { shared: { xp: 0, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 } });
  await onLvMsg({ ...lvCtx, config: { ...lvCtx.config, levels: { ...lvCtx.config.levels, cooldownMs: 0 } } }, mkG2Msg('shared', 'chào server 2'));
  check('XP 2 server cùng userId -> tách bể',
    store.read(GUILD, 'levels').shared.xp === 500 && store.read(GUILD2, 'levels').shared.xp === 1,
    `A=${store.read(GUILD, 'levels').shared.xp} B=${store.read(GUILD2, 'levels').shared.xp}`);

  // Strike automod cũng phải tách: 1 lần vi phạm ở server A không làm người đó
  // bị timeout ngay ở server B.
  clearRec();
  const am2 = { ...ctxBase, config: { ...ctxBase.config, automod: { ...ctxBase.config.automod, spam: { messages: 99, windowMs: 5000, timeoutSeconds: 300 } } } };
  await onMsg(am2, mkMsg('striker', 'fuck'));
  const m2 = mkMsg('striker', 'fuck');
  m2.guildId = GUILD2;
  m2.guild = { id: GUILD2 };
  m2.channel = channels.get(CHAN2);
  await onMsg(am2, m2);
  check('strike server B tính riêng -> chưa timeout', m2.__timedOut.length === 0, JSON.stringify(m2.__timedOut));

  // Tags: cùng tên tag ở 2 server là 2 nội dung khác nhau. Interaction phải
  // mang `guildId` của server 2 — bản cũ đọc store phẳng nên tag tạo ở đây sẽ
  // xuất hiện ở `/tag list` của server 1.
  const g2Iface = (over) => ({ guildId: GUILD2, guild: { id: GUILD2, name: 'server 2', ownerId: '900000000000000009' }, ...over });
  store.write(GUILD, 'tags', {});
  store.write(GUILD2, 'tags', {});
  const tagG1 = sub('tag', 'create', { name: 'rule', content: 'nội quy server 1' },
    { guildId: GUILD, memberPermissions: { has: () => true } });
  const tagG2 = sub('tag', 'create', { name: 'rule', content: 'nội quy server 2' },
    g2Iface({ memberPermissions: { has: () => true } }));
  await tags.handleInteraction(tagG1.i, ctxBase);
  await tags.handleInteraction(tagG2.i, ctxBase);
  check('cùng tên tag 2 server -> 2 nội dung khác nhau',
    store.read(GUILD, 'tags').rule === 'nội quy server 1' &&
    store.read(GUILD2, 'tags').rule === 'nội quy server 2',
    `A=${store.read(GUILD, 'tags').rule} B=${store.read(GUILD2, 'tags').rule}`);

  // `/tag list` ở server 2 chỉ thấy tag của server 2 — đây mới là lỗi thật
  // (bản single-guild liệt kê MỌI tag trong file chung).
  clearRec();
  const listG2 = sub('tag', 'list', {}, g2Iface());
  await tags.handleInteraction(listG2.i, ctxBase);
  const listDesc = emb(listG2.captured).description;
  check('/tag list ở server 2 không lộ tag server 1',
    listDesc.includes('`rule`') && store.read(GUILD2, 'tags').rule === 'nội quy server 2',
    listDesc);

  // Warns: chạy `/warn` thật ở server 1 rồi `/warn` lại ở server 2 — server 2
  // phải báo tổng 1, không phải 2 (bản single-guild đếm chung).
  const g2GuildMock = (mePos = 50) => ({
    id: GUILD2, name: 'server 2', ownerId: '900000000000000009',
    members: { me: { id: BOT, roles: { highest: { position: mePos } } } },
    bans: [],
  });
  const warnAt = async (guildId, guildMock, reason) => {
    store.write(guildId, 'warns', {});
    const target = mkMember('shared-user', 10);
    const it = sub('warn', 'warn', { user: 'shared-user', reason },
      g2Iface({ guild: guildMock, memberPermissions: { has: () => true } }));
    it.i.guildId = guildId;
    it.i.guild = guildMock;
    it.i.member = { roles: { cache: new Collection() } };
    it.i.options.getMember = () => target;
    it.i.options.getUser = () => target.user;
    await moderation.handleInteraction(it.i, ctxBase);
    return it.edited || '';
  };
  const w1 = await warnAt(GUILD, guildMock(), 'lý do A');
  const w2 = await warnAt(GUILD2, g2GuildMock(), 'lý do B');
  check('warn ở server 1 -> tổng 1', /tổng \*\*1\*\*/.test(w1), w1);
  check('warn ở server 2 -> tổng 1 (KHÔNG tính dồn server 1)', /tổng \*\*1\*\*/.test(w2), w2);
  check('warn lưu 2 file riêng',
    store.read(GUILD, 'warns')['shared-user'].length === 1 &&
    store.read(GUILD2, 'warns')['shared-user'].length === 1,
    JSON.stringify([store.read(GUILD, 'warns')['shared-user'], store.read(GUILD2, 'warns')['shared-user']]));

  // Hệ quả bắt buộc của việc tách store: 2 guild không dùng chung 1 file.
  check('store tách đường dẫn theo guild',
    store.filePath(GUILD, 'warns') !== store.filePath(GUILD2, 'warns'),
    `${store.filePath(GUILD, 'warns')} vs ${store.filePath(GUILD2, 'warns')}`);

  // sendLog đã theo guild (Phase 4): `log.js` đọc `ctx.cfg(guildId).channels.log`.
  // Guild 2 chưa có `config/guilds/<GUILD2>.json` nên `cfg` rỗng → KHÔNG được
  // gửi về kênh log của server 1 (kênh đó thuộc guild khác, fetch sẽ throw
  // "Cannot send message to this channel" hoặc rơi log nhầm chỗ).
  clearRec();
  await sendLog(ctxBase, GUILD2, { title: 'log server 2' });
  check('sendLog server chưa cấu hình -> im lặng, không lẩn sang kênh server 1',
    sentTo(ctxBase.cfg(GUILD).channels.log).length === 0 && sentTo(CHAN2).length === 0,
    `chung=${sentTo(ctxBase.cfg(GUILD).channels.log).length} g2=${sentTo(CHAN2).length}`);

  // Còn server CÓ config thì log phải về đúng kênh của server đó.
  const CFG2 = '900000000000000002';
  const LOG2 = '900000000000000004';
  guildConfig.clear();
  const cfgDir = path.dirname(guildConfig.GUILD_DIR);
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(guildConfig.GUILD_DIR, `${CFG2}.json`),
    JSON.stringify({ schema: 2, guildId: CFG2, channels: { log: LOG2 }, roles: {} })
  );
  channels.set(LOG2, mkChannel(LOG2, 'chat-log-server-2'));
  clearRec();
  await sendLog(ctxBase, CFG2, { title: 'log server có config' });
  check('sendLog server có config -> về đúng kênh log riêng',
    sentTo(LOG2).length === 1 && sentTo(ctxBase.cfg(GUILD).channels.log).length === 0,
    `g2log=${sentTo(LOG2).length} g1=${sentTo(ctxBase.cfg(GUILD).channels.log).length}`);
  guildConfig.clear();
  fs.rmSync(path.join(guildConfig.GUILD_DIR, `${CFG2}.json`), { force: true });

  // Guild chưa cấu hình -> KHÔNG được đăng panel vào kênh nào.
  // (Phase 5 thêm cổng này ở lifecycle; ở đây verify.init vẫn cần env riêng.)
  clearRec();
  store.write(GUILD2, 'verify-panel', null);
  await verify.init({ ...ctxBase, cfg: (g) => (g === GUILD2 ? { channels: {}, roles: {} } : ctxBase.cfg(g)) }, GUILD2);
  check('guild chưa cấu hình -> KHÔNG đăng panel', rec.sends.length === 0, String(rec.sends.length));

  console.log(`\n${'='.repeat(46)}\nPASS: ${pass}   FAIL: ${fail}\n`);
  restore();
  process.exit(fail ? 1 : 0);
})();
