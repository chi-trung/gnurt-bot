// Kiểm thử logic 10 module Guardian còn lại bằng mock interaction/event.
// (suggestions đã có test riêng ở test-suggestions-logic.js)
//
// KHÔNG gọi Discord API. Chỉ nạp module rồi bơm dữ liệu giả vào handler,
// kiểm tra kết quả. File data/*.json bị XOÁ trước và sau khi chạy — mọi module
// đều load/save qua try-catch nên thiếu file = kho rỗng, không mất gì.
// verify-panel.json được backup riêng vì nó trỏ tới tin nhắn THẬT trên Discord.
//
// ĐỪNG chạy khi Guardian đang chạy, và BACKUP src/data trước: xóa hẳn (không
// khôi phục snapshot) là chủ đích — nếu lúc bắt đầu file đã bẩn sẵn thì restore
// giữ lại rác cho lần chạy sau. Đã xảy ra: rr.json mất thật, không phục hồi được
// vì .gitignore loại trừ src/data.
const fs = require('fs');
const path = require('path');

const GUARD = 'C:/Users/Gnurt/Desktop/bot-discord/bots/guardian';
const DJ = path.join(GUARD, 'node_modules/discord.js');
const { Collection, PermissionFlagsBits, MessageFlags } = require(DJ);

// ticket.js đọc process.env LÚC NẠP MODULE (không qua ctx.env) → phải set trước require.
process.env.TICKET_CHANNEL_ID = '1554748500045070419';
process.env.TICKET_CATEGORY_ID = '1554748338262384720';
process.env.ADMIN_ROLE_ID = '1554748061077737475';

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
const DATA_DIR = path.join(GUARD, 'src/data');
const DATA_FILES = ['tags.json', 'rr.json', 'warns.json', 'starboard.json', 'levels.json'];

// Mỗi module đều load/save qua try-catch nên thiếu file = kho rỗng. Xoá hẳn file
// về đúng trạng thái "chưa có" thay vì khôi phục nội dung lúc bắt đầu: nếu lúc đó
// file đã bẩn sẵn thì restore sẽ giữ lại rác cho lần chạy sau.
//
// verify-panel.json CỐ Ý KHÔNG nằm trong danh sách: nó trỏ tới tin nhắn THẬT trên
// Discord. Xoá nó khiến Guardian tạo panel trùng mỗi lần chạy test rồi restart.
// Phần test verify dùng PANEL_FILE riêng và tự dọn.
const PANEL_FILE = path.join(DATA_DIR, 'verify-panel.json');
const panelBackup = fs.existsSync(PANEL_FILE) ? fs.readFileSync(PANEL_FILE, 'utf8') : null;
for (const f of DATA_FILES) fs.rmSync(path.join(DATA_DIR, f), { force: true });
const restore = () => {
  for (const f of DATA_FILES) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  if (panelBackup === null) fs.rmSync(PANEL_FILE, { force: true });
  else fs.writeFileSync(PANEL_FILE, panelBackup);
};
const resetData = (name, obj) =>
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(obj, null, 2));
const readData = (name) => {
  const p = path.join(DATA_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
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
const GUILD = '1554742286598803526';
const CHAN = '1554748500045070419';
const BOT = '1554756064182804560';

// Một kênh giả dùng chung cho log / welcome / panel / starboard.
const rec = { sends: [], edits: [], deletes: [] };
const fakeChannel = {
  id: CHAN,
  name: 'test-chan',
  isTextBased: () => true,
  messages: {
    // starboard.js sửa bài cũ qua sbChannel.messages.fetch(id).edit(...);
    // reactionroles.js xoá qua messages.fetch(id).delete(). Cần cả hai.
    fetch: async () => ({
      edit: async (q) => rec.edits.push(q),
      delete: async () => rec.deletes.push('starboard-msg'),
    }),
  },
  send: async (p) => {
    rec.sends.push(p);
    return {
      id: '1554782911142694935',
      channelId: CHAN,
      url: `https://discord.com/channels/${GUILD}/${CHAN}/1554782911142694935`,
      react: async (e) => rec.sends.push({ __react: e }),
      edit: async (q) => rec.edits.push(q),
      delete: async () => rec.deletes.push('sent-msg'),
    };
  },
  delete: async () => rec.deletes.push('channel'),
};
const clearRec = () => { rec.sends.length = 0; rec.edits.length = 0; rec.deletes.length = 0; };
const logSends = () => rec.sends.filter((s) => emb(s).title);

const ctxBase = {
  client: { channels: { fetch: async () => fakeChannel } },
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
  env: {
    LOG_CHANNEL_ID: '1554748461461540896',
    ADMIN_ROLE_ID: 'ROLE_ADMIN',
    STARBOARD_CHANNEL_ID: '1554777506169491527',
    SUGGESTIONS_CHANNEL_ID: '1554782911142694934',
    WELCOME_CHANNEL_ID: '1554748465232351263',
    NEWBIE_ROLE_ID: '1554748071747788870',
    VERIFY_CHANNEL_ID: '1554771434549678131',
    VERIFY_ROLE_ID: '1554771429889802241',
    VERIFY_PENDING_ROLE_ID: '1554771432305860629',
  },
};

function mkIface(over = {}) {
  const out = { captured: null, replied: 0, edited: null, responded: null };
  out.i = {
    isChatInputCommand: () => false,
    isButton: () => false,
    isAutocomplete: () => false,
    commandName: 'x',
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
  check('báo trong kênh', rec.sends.some((s) => typeof s === 'string' && s.includes('link mời server')));
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
  const ctxNoSb = { ...ctxBase, env: { ...ctxBase.env, STARBOARD_CHANNEL_ID: '' } };
  await onReactAdd(ctxNoSb, mkReaction(mkSbMsg('906'), 9), { bot: false });
  check('thiếu STARBOARD_CHANNEL_ID -> bỏ qua, không crash', rec.sends.length === 0);

  clearRec();
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('910'), 3), { bot: false });
  check('đạt ngưỡng -> đăng starboard', rec.sends.length === 1, String(rec.sends.length));
  check('lưu map tin gốc -> tin starboard', readData('starboard.json')['910'] === '1554782911142694935', JSON.stringify(readData('starboard.json')));
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
  const oldFetch = fakeChannel.messages.fetch;
  fakeChannel.messages.fetch = async () => { throw new Error('Unknown Message'); };
  clearRec();
  await onReactAdd(ctxBase, mkReaction(mkSbMsg('910'), 8), { bot: false });
  check('fetch lỗi -> gửi lại bài mới', rec.sends.length === 1, String(rec.sends.length));
  fakeChannel.messages.fetch = oldFetch;

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
  const mkRRReaction = (emoji, count = 1) => ({
    message: { id: '1554782911142694935', guild: { members: { fetch: async (uid) => ({ user: { bot: false }, roles: { add: async (r) => added.push(['add', uid, r]), remove: async (r) => added.push(['rm', uid, r]) } }) } } },
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
  await onRRAdd(rrCtx, { ...mkRRReaction({ id: '1', name: 'star' }), message: { id: '999', guild: { members: { fetch: async () => ({ user: { bot: false }, roles: { add: async () => added.push('x') } }) } } } }, { id: 'u1', bot: false });
  check('emoji custom so name:id', added.length === 1, String(added.length));
  added.length = 0;
  await onRRAdd(rrCtx, { ...mkRRReaction({ id: '1', name: 'other' }), message: { id: '999', guild: { members: { fetch: async () => ({ user: { bot: false }, roles: { add: async () => added.push('x') } }) } } } }, { id: 'u1', bot: false });
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
    user: { id, bot, tag: 'N#0004' },
    roles: { add: async (r) => added.push(['madd', id, r]) },
  });
  added.length = 0;
  await onMemberAdd(ctxBase, mkMemberAdd('400', false));
  check('thành viên mới -> gán role chờ', added.some((a) => a[2] === ctxBase.env.VERIFY_PENDING_ROLE_ID), JSON.stringify(added));
  added.length = 0;
  await onMemberAdd(ctxBase, mkMemberAdd('401', true));
  check('bot mới vào -> không gán role', added.length === 0);
  added.length = 0;
  await onMemberAdd({ ...ctxBase, env: { ...ctxBase.env, VERIFY_PENDING_ROLE_ID: '' } }, mkMemberAdd('402', false));
  check('thiếu VERIFY_PENDING_ROLE_ID -> bỏ qua', added.length === 0);

  const agree = (roles) => mkIface({
    isButton: () => true,
    customId: 'verify:agree',
    member: { user: { id: 'u5', tag: 'U#5' }, roles: { cache: new Collection(roles.map((r) => [r, { id: r }])), add: async (r) => added.push(['vadd', r]), remove: async (r) => added.push(['vrm', r]) } },
  });
  t = mkIface({ isButton: () => true, customId: 'verify:xxx' });
  check('nút khác -> false', (await verify.handleInteraction(t.i, ctxBase)) === false);
  t = agree([]);
  const ctxNoRole = { ...ctxBase, env: { ...ctxBase.env, VERIFY_ROLE_ID: '' } };
  check('thiếu VERIFY_ROLE_ID -> false', (await verify.handleInteraction(t.i, ctxNoRole)) === false);

  added.length = 0;
  t = mkIface({ isButton: () => true, customId: 'verify:agree', member: null });
  await verify.handleInteraction(t.i, ctxBase);
  check('không lấy được member -> báo lỗi', /Không tìm thấy thành viên/.test(t.captured?.content || ''), t.captured?.content);

  added.length = 0;
  t = agree([ctxBase.env.VERIFY_ROLE_ID]);
  await verify.handleInteraction(t.i, ctxBase);
  check('đã có role -> báo đã xác nhận', /đã xác nhận rồi/.test(t.captured?.content || ''), t.captured?.content);
  check('không gán lại role', added.length === 0);

  clearRec();
  added.length = 0;
  t = agree([ctxBase.env.VERIFY_PENDING_ROLE_ID]);
  await verify.handleInteraction(t.i, ctxBase);
  check('gán role ✅', added.some((a) => a[0] === 'vadd' && a[1] === ctxBase.env.VERIFY_ROLE_ID), JSON.stringify(added));
  check('gỡ role ⏳', added.some((a) => a[0] === 'vrm' && a[1] === ctxBase.env.VERIFY_PENDING_ROLE_ID), JSON.stringify(added));
  check('ghi log xác nhận', logSends().some((s) => emb(s).title === '✅ Thành viên đã xác nhận'));

  added.length = 0;
  t = agree([ctxBase.env.VERIFY_PENDING_ROLE_ID]);
  t.i.member.roles.add = async () => { throw new Error('Missing Permissions'); };
  await verify.handleInteraction(t.i, ctxBase);
  check('gán role lỗi -> báo ❌, không crash', /❌ Không xác nhận được: Missing Permissions/.test(t.captured?.content || ''), t.captured?.content);

  console.log('-- init: tạo & tái dùng panel --');
  clearRec();
  resetData('verify-panel.json', null);
  await verify.init(ctxBase);
  check('chưa có panel -> tạo mới', rec.sends.length === 1);
  check('lưu vị trí panel', readData('verify-panel.json')?.messageId === '1554782911142694935', JSON.stringify(readData('verify-panel.json')));
  check('panel có nút verify:agree', JSON.stringify(rec.sends[0]).includes('verify:agree'));
  clearRec();
  await verify.init(ctxBase);
  check('panel còn -> không tạo lại', rec.sends.length === 0);
  clearRec();
  await verify.init({ ...ctxBase, env: { ...ctxBase.env, VERIFY_CHANNEL_ID: '' } });
  check('thiếu VERIFY_CHANNEL_ID -> bỏ qua, không crash', rec.sends.length === 0);
  resetData('verify-panel.json', { channelId: CHAN, messageId: '999' });
  const goodFetch = fakeChannel.messages.fetch;
  fakeChannel.messages.fetch = async () => { throw new Error('Unknown Message'); };
  clearRec();
  await verify.init(ctxBase);
  check('panel cũ đã mất -> tạo lại', rec.sends.length === 1);
  fakeChannel.messages.fetch = goodFetch;

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

  clearRec();
  await onGAdd(ctxBase, { user: { tag: 'N#1' }, toString: () => '@N', guild: { memberCount: 42 }, user: { tag: 'N#1', displayAvatarURL: () => 'https://x/av.png' } });
  check('ghi log vào server', logSends().some((s) => emb(s).title === '📥 Vào server'));
  check('log có số thứ tự thành viên', /Thành viên thứ 42/.test(emb(logSends()[0]).description), JSON.stringify(emb(logSends()[0]).description));
  clearRec();
  await onGRemove(ctxBase, { user: { tag: 'N#1', displayAvatarURL: () => 'https://x/av.png' }, toString: () => '@N' });
  check('ghi log rời server', logSends().some((s) => emb(s).title === '📤 Rời server'));

  clearRec();
  const rm = (id) => ({ id, toString: () => '@r' + id });
  // logging.js đọc oldMember.user.username khi nickname rỗng → mock phải có user
  const gmu = (nickname, roleIds = []) => ({
    nickname,
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
    guild: { name: 'server g n u r t', memberCount: 77 },
    toString: () => '@Mới',
    roles: { add: async (r) => added.push(['w', r]) },
  });
  check('gán role 🌱 cho thành viên mới', added.some((a) => a[1] === ctxBase.env.NEWBIE_ROLE_ID), JSON.stringify(added));
  check('gửi embed chào', rec.sends.some((s) => emb(s).title === '👋 Chào mừng mới!'));
  check('embed nhắc tên server', logSends().some((s) => emb(s).description.includes('server g n u r t')));
  check('embed nhắc số thứ tự', logSends().some((s) => emb(s).description.includes('thành viên thứ **77**')));

  clearRec();
  added.length = 0;
  await onWelcome({ ...ctxBase, env: { ...ctxBase.env, NEWBIE_ROLE_ID: '' } },
    { user: { tag: 'M#1', displayAvatarURL: () => 'https://x/av.png' }, guild: { name: 's', memberCount: 1 }, toString: () => '@M', roles: { add: async (r) => added.push(r) } });
  check('thiếu NEWBIE_ROLE_ID -> bỏ qua role', added.length === 0);
  check('vẫn gửi embed chào', rec.sends.length === 1);
  clearRec();
  await onWelcome({ ...ctxBase, env: { ...ctxBase.env, WELCOME_CHANNEL_ID: '' } },
    { user: { tag: 'M#1', displayAvatarURL: () => 'https://x/av.png' }, guild: { name: 's', memberCount: 1 }, toString: () => '@M', roles: { add: async () => {} } });
  check('thiếu WELCOME_CHANNEL_ID -> không gửi', rec.sends.length === 0);
  clearRec();
  await onWelcome(ctxBase, {
    user: { tag: 'M#1', displayAvatarURL: () => 'https://x/av.png' }, guild: { name: 's', memberCount: 1 }, toString: () => '@M',
    roles: { add: async () => { throw new Error('Missing Permissions'); } },
  });
  check('gán role lỗi -> vẫn gửi được embed chào', rec.sends.length === 1, String(rec.sends.length));
  clearRec();
  const badSend = { ...ctxBase, client: { channels: { fetch: async () => { throw new Error('Unknown Channel'); } } } };
  await onWelcome(badSend, {
    user: { tag: 'M#1', displayAvatarURL: () => 'https://x/av.png' }, guild: { name: 's', memberCount: 1 }, toString: () => '@M',
    roles: { add: async () => {} },
  });
  check('kênh lỗi -> không crash', true);

  console.log('\n=== sendLog khi thiếu LOG_CHANNEL_ID ===');
  clearRec();
  await require(path.join(GUARD, 'src/core/log')).sendLog({ ...ctxBase, env: { ...ctxBase.env, LOG_CHANNEL_ID: '' } }, { __t: 1 });
  check('thiếu LOG_CHANNEL_ID -> im lặng, không throw', rec.sends.length === 0);
  await require(path.join(GUARD, 'src/core/log')).sendLog({ client: { channels: { fetch: async () => { throw new Error('no access'); } } }, env: { LOG_CHANNEL_ID: '1' } }, { __t: 1 });
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
    id: '800', guild: { id: GUILD }, content,
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
  resetData('levels.json', {});
  await onLvVoice(lvCtx, { id: '620', channelId: null }, { id: '620', channelId: 'VC1' });
  check('vào voice -> ghi voiceStart', readData('levels.json')['620']?.voiceStart > 0, JSON.stringify(readData('levels.json')['620']));
  // 5 phút = 300000ms; xpPer 10 / 5 phút -> perMs = 10/300000
  const realNow = Date.now;
  Date.now = () => realNow() + 5 * 60 * 1000;
  await onLvVoice(lvCtx, { id: '620', channelId: 'VC1' }, { id: '620', channelId: null });
  Date.now = realNow;
  check('nghe 5 phút rồi rời -> +10 XP (không cộng đôi)', readData('levels.json')['620']?.xp === 10, String(readData('levels.json')['620']?.xp));
  check('rời voice -> xoá voiceStart', readData('levels.json')['620'].voiceStart === 0);
  check('rời voice -> quỹ voiceAcc về 0', readData('levels.json')['620'].voiceAcc === 0);
  await onLvVoice(lvCtx, { id: '620', channelId: null }, { id: '620', channelId: 'VC1' });
  const vs1 = readData('levels.json')['620'].voiceStart;
  Date.now = () => realNow() + 60 * 1000;
  // mute/deafen/stream: channelId KHÔNG đổi — nếu không chặn thì mất XP voice
  await onLvVoice(lvCtx, { id: '620', channelId: 'VC1', selfMute: false }, { id: '620', channelId: 'VC1', selfMute: true });
  Date.now = realNow;
  check('mute (cùng kênh) -> KHÔNG reset mốc voiceStart', readData('levels.json')['620'].voiceStart === vs1, String(readData('levels.json')['620'].voiceStart));
  check('mute -> XP không bị cộng sớm', readData('levels.json')['620'].xp === 10, String(readData('levels.json')['620'].xp));
  await onLvVoice(lvCtx, { id: '621', channelId: 'VC1' }, { id: '621', channelId: 'VC2' });
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
    return { channels: { fetch: async () => fakeChannel }, guilds: { cache: new Collection(guild ? [[GUILD, guild]] : []) } };
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
  await levels.init({ ...lvRoleCtx, client: mkLvClient(emojiGuild) });
  check('init gọi guild.emojis.fetch()', emojiFetchCalls.length === 1, JSON.stringify(emojiFetchCalls));
  check('sau init thì emoji có trong cache', emojiGuild.emojis.cache.size === RANKS.length, String(emojiGuild.emojis.cache.size));

  await levels.init(lvRoleCtx);
  check('init role hợp lệ -> không throw', true);

  // emojis.fetch() lỗi -> init vẫn chạy tiếp, chỉ warn (không chặn phần role).
  const throwEmojiGuild = mkLvGuild();
  throwEmojiGuild.emojis = {
    cache: new Collection(),
    fetch: async () => {
      throw new Error('Missing Access');
    },
  };
  await levels.init({ ...lvRoleCtx, client: mkLvClient(throwEmojiGuild) });
  check('emojis.fetch lỗi -> init không throw', true);

  await levels.init({ ...lvRoleCtx, client: mkLvClient(null) });
  check('init không có guild -> không throw', true);
  await levels.init(noRankCtx);
  check('init roles rỗng -> không throw', true);

  console.log(`\n${'='.repeat(46)}\nPASS: ${pass}   FAIL: ${fail}\n`);
  restore();
  process.exit(fail ? 1 : 0);
})();
