// Kiểm thử logic module suggestions + starboard bằng mock interaction.
// KHÔNG thay đổi behavior production — chỉ gọi handleInteraction với dữ liệu giả
// rồi kiểm tra kết quả trả về. suggestions.json được snapshot & khôi phục.
const fs = require('fs');
const path = require('path');
const os = require('os');

const GUARD = 'C:/Users/Gnurt/Desktop/bot-discord/bots/guardian';
const SUG = require(path.join(GUARD, 'src/modules/suggestions'));
const SUG_FILE = path.join(GUARD, 'src/data/suggestions.json');

const backup = fs.existsSync(SUG_FILE) ? fs.readFileSync(SUG_FILE, 'utf8') : null;
const restore = () => {
  if (backup === null) fs.rmSync(SUG_FILE, { force: true });
  else fs.writeFileSync(SUG_FILE, backup);
};

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`);
  }
}

/** EmbedBuilder giữ dữ liệu ở .data; đã serialize thì lấy thẳng. */
function emb(p, i = 0) {
  const e = p?.embeds?.[0];
  if (!e) return {};
  return e.data || e;
}

// Ghi lại payload embed mà module gửi qua channel.send / message.edit,
// để assert được phần UI (màu, footer) chứ không chỉ phần DB.
const sent = { lastSend: null, lastEdit: null };

const fakeChannel = {
  send: async (p) => {
    sent.lastSend = p;
    return {
      id: '1554782911142694935',
      url: 'https://discord.com/channels/1554742286598803526/1554782911142694934/1554782911142694935',
      edit: async (q) => { sent.lastEdit = q; },
    };
  },
  messages: {
    fetch: async () => ({ edit: async (p) => { sent.lastEdit = p; } }),
  },
};
const ctx = {
  client: { channels: { fetch: async () => fakeChannel } },
  config: { modules: { suggestions: true } },
  env: { SUGGESTIONS_CHANNEL_ID: '1554782911142694934', ADMIN_ROLE_ID: 'ROLE_ADMIN', LOG_CHANNEL_ID: null },
};

function mkIface(over = {}) {
  const out = { captured: null, errors: [] };
  const base = {
    isChatInputCommand: () => false,
    isButton: () => false,
    isAutocomplete: () => false,
    commandName: 'suggest',
    guild: { id: '1554742286598803526' },
    user: { id: 'U1', tag: 'Tester#0001', displayAvatarURL: () => 'https://x/av.png' },
    member: { roles: { cache: new Map() } },
    memberPermissions: { has: () => false },
    reply: async (p) => { out.captured = p; },
    deferReply: async () => {},
    editReply: async (p) => { out.captured = p; },
    update: async (p) => { out.captured = p; },
    ...over,
  };
  out.i = base;
  return out;
}

function sub(name, extraOpts = {}, over = {}) {
  return mkIface({
    isChatInputCommand: () => true,
    commandName: 'suggest',
    options: { getSubcommand: () => name, getString: (k) => extraOpts[k] },
    ...over,
  });
}

(async () => {
  console.log('\n=== 1. /suggest list — kho rỗng ===');
  fs.writeFileSync(SUG_FILE, JSON.stringify({}));
  let t = sub('list');
  check('trả về true', (await SUG.handleInteraction(t.i, ctx)) === true);
  check('reply ephemeral', t.captured?.ephemeral === true);
  const d0 = emb(t.captured).description ?? '';
  check('báo chưa có gợi ý', d0.includes('Chưa có gợi ý nào'), d0);

  console.log('\n=== 2. /suggest create — tạo gợi ý ===');
  t = sub('create', { content: 'Nên thêm kênh nhạc' });
  check('trả về true', (await SUG.handleInteraction(t.i, ctx)) === true);
  check('deferReply được gọi', true);
  let db = JSON.parse(fs.readFileSync(SUG_FILE, 'utf8'));
  const newId = Object.keys(db)[0];
  check('message id là số (snowflake)', /^\d+$/.test(newId), newId);
  check('ghi 1 record vào DB', Object.keys(db).length === 1, JSON.stringify(Object.keys(db)));
  const item = db[newId];
  check('lưu nội dung', item.content === 'Nên thêm kênh nhạc', item.content);
  check('status mặc định open', item.status === 'open', item.status);
  check('vote khởi tạo rỗng', item.up.length === 0 && item.down.length === 0);
  check('có messageId', Boolean(item.messageId), String(item.messageId));

  console.log('\n=== 3. Bấm 👍 (bỏ phiếu đồng ý) ===');
  t = mkIface({ isButton: () => true, customId: 'suggest:up', message: { id: newId } });
  check('trả về true', (await SUG.handleInteraction(t.i, ctx)) === true);
  db = JSON.parse(fs.readFileSync(SUG_FILE, 'utf8'));
  check('up=1', db[newId].up.length === 1, JSON.stringify(db[newId].up));
  const f0 = emb(t.captured).footer?.text ?? '';
  check('footer hiện 👍 1', f0.includes('👍 1'), f0);

  console.log('\n=== 4. Bấm 👍 lần 2 (bỏ phiếu) ===');
  t = mkIface({ isButton: () => true, customId: 'suggest:up', message: { id: newId } });
  await SUG.handleInteraction(t.i, ctx);
  db = JSON.parse(fs.readFileSync(SUG_FILE, 'utf8'));
  check('up=0 sau khi bỏ', db[newId].up.length === 0, JSON.stringify(db[newId].up));

  console.log('\n=== 5. Bấm 👍 rồi 👎 (đổi phe, không double-count) ===');
  let a = mkIface({ isButton: () => true, customId: 'suggest:up', message: { id: newId } });
  await SUG.handleInteraction(a.i, ctx);
  a = mkIface({ isButton: () => true, customId: 'suggest:down', message: { id: newId } });
  await SUG.handleInteraction(a.i, ctx);
  db = JSON.parse(fs.readFileSync(SUG_FILE, 'utf8'));
  check('up=0', db[newId].up.length === 0, JSON.stringify(db[newId].up));
  check('down=1', db[newId].down.length === 1, JSON.stringify(db[newId].down));

  console.log('\n=== 6. Chưa bấm được (tin không có trong DB) ===');
  t = mkIface({ isButton: () => true, customId: 'suggest:up', message: { id: 'KHONG_CO' } });
  check('trả về true', (await SUG.handleInteraction(t.i, ctx)) === true);
  check('báo lỗi thay vì crash', /database/i.test(t.captured?.content || ''), t.captured?.content);

  console.log('\n=== 7. /suggest list — có dữ liệu ===');
  t = sub('list');
  await SUG.handleInteraction(t.i, ctx);
  const d1 = emb(t.captured).description ?? '';
  check('có tiêu đề đếm số', (emb(t.captured).title || '').includes('(1)'), emb(t.captured).title);
  check('hiện nội dung gợi ý', d1.includes('Nên thêm kênh nhạc'), d1.slice(0, 80));
  check('có link tới tin', d1.includes('discord.com/channels/1554742286598803526/1554782911142694934/'), d1.slice(0, 200));

  console.log('\n=== 8. /suggest decide — link sai ===');
  t = sub('decide', { link: 'không phải link', status: 'accepted' }, { memberPermissions: { has: () => true } });
  check('trả về true', (await SUG.handleInteraction(t.i, ctx)) === true);
  check('báo link không hợp lệ', /không hợp lệ/i.test(t.captured?.content || ''), t.captured?.content);

  console.log('\n=== 9. /suggest decide — không phải staff ===');
  t = sub('decide', { link: `https://discord.com/channels/1554742286598803526/1554782911142694934/${newId}`, status: 'accepted' });
  check('trả về true', (await SUG.handleInteraction(t.i, ctx)) === true);
  check('từ chối', /staff/i.test(t.captured?.content || ''), t.captured?.content);

  console.log('\n=== 10. /suggest decide — staff đổi trạng thái ===');
  t = sub(
    'decide',
    { link: `https://discord.com/channels/1554742286598803526/1554782911142694934/${newId}`, status: 'accepted' },
    { memberPermissions: { has: (p) => true } }
  );
  check('trả về true', (await SUG.handleInteraction(t.i, ctx)) === true);
  db = JSON.parse(fs.readFileSync(SUG_FILE, 'utf8'));
  check('status=accepted', db[newId].status === 'accepted', db[newId].status);
  check('ghi decidedBy', db[newId].decidedBy === 'Tester#0001', String(db[newId].decidedBy));
  // decide gọi channel.messages.fetch().edit() — embed nằm ở đó, không phải reply
  check('đã edit embed của tin gợi ý', Boolean(sent.lastEdit), 'lastEdit=null');
  check('màu embed = 0x2ecc71 (đã chấp nhận)', emb(sent.lastEdit).color === 0x2ecc71, String(emb(sent.lastEdit).color));
  check('footer hiện trạng thái mới', (emb(sent.lastEdit).footer?.text || '').includes('Đã chấp nhận'), emb(sent.lastEdit).footer?.text);

  console.log('\n=== 11. Subcommand lạ bị bỏ qua (không nuốt interaction) ===');
  t = sub('khong-ton-tai');
  check('trả về false', (await SUG.handleInteraction(t.i, ctx)) === false);

  console.log('\n=== 12. Nút của module khác không bị nuốt ===');
  t = mkIface({ isButton: () => true, customId: 'ticket:create', message: { id: newId } });
  check('trả về false', (await SUG.handleInteraction(t.i, ctx)) === false);

  console.log('\n=== 13. Thiếu SUGGESTIONS_CHANNEL_ID ===');
  const ctxNoCh = { ...ctx, env: { ...ctx.env, SUGGESTIONS_CHANNEL_ID: '' } };
  t = sub('create', { content: 'abc' });
  await SUG.handleInteraction(t.i, ctxNoCh);
  check('báo cấu hình thiếu', /SUGGESTIONS_CHANNEL_ID/.test(t.captured?.content || ''), t.captured?.content);

  console.log('\n=== 14. Nội dung rỗng ===');
  t = sub('create', { content: '   ' });
  await SUG.handleInteraction(t.i, ctx);
  check('báo rỗng', /rỗng/i.test(t.captured?.content || ''), t.captured?.content);

  console.log('\n=== 15. Starboard: emojiMatches (unicode vs custom) ===');
  const sbSrc = fs.readFileSync(path.join(GUARD, 'src/modules/starboard.js'), 'utf8');
  const fn = new Function(
    'return ' + sbSrc.match(/function emojiMatches[\s\S]*?\n}/)[0] + '; emojiMatches;'
  )();
  check('unicode ⭐ khớp tên', fn('⭐', { id: null, name: '⭐' }) === true);
  check('unicode ⭐ KHÔNG khớp ❤️', fn('⭐', { id: null, name: '❤️' }) === false);
  // Emoji custom thật của discord.js: { id: snowflake, name: tênEmoji, animated }
  check('custom dạng <a:name:id> khớp',
    fn('<a:star:1>', { id: '1', name: 'star', animated: true }) === true);
  check('custom dạng <:name:id> (không animated) khớp',
    fn('<:star:1>', { id: '1', name: 'star', animated: false }) === true);
  check('custom name:id khớp', fn('star:1', { id: '1', name: 'star' }) === true);
  check('custom sai id', fn('star:1', { id: '2', name: 'star' }) === false);
  check('custom sai tên', fn('star:1', { id: '1', name: 'other' }) === false);

  console.log(`\n${'='.repeat(46)}\nPASS: ${pass}   FAIL: ${fail}\n`);
  restore();
  process.exit(fail ? 1 : 0);
})();
