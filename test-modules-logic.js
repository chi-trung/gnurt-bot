// Kiểm thử logic 9 module Guardian còn lại bằng mock interaction/event.
// (suggestions đã có test riêng ở test-suggestions-logic.js)
//
// KHÔNG gọi Discord API. Chỉ nạp module rồi bơm dữ liệu giả vào handler,
// kiểm tra kết quả. File data/*.json bị XOÁ trước và sau khi chạy — mọi module
// đều load/save qua try-catch nên thiếu file = kho rỗng, không mất gì.
// Đừng chạy khi Guardian đang chạy: sẽ mất tag/panel/rr/warn thật.
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

// ---------------------------------------------------------------- hạ tầng test
const DATA_DIR = path.join(GUARD, 'src/data');
const DATA_FILES = ['tags.json', 'rr.json', 'warns.json', 'starboard.json'];

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

  console.log(`\n${'='.repeat(46)}\nPASS: ${pass}   FAIL: ${fail}\n`);
  restore();
  process.exit(fail ? 1 : 0);
})();
