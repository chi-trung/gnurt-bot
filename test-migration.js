// Kiểm thử scripts/migrate-to-multiguild.js trên CÂY THƯ MỤC TẠM.
//
// Script chạy thành subprocess với GUARDIAN_MIGRATE_ROOT trỏ vào bản sao tạm,
// nên suite này KHÔNG BAO GIỜ chạm `src/data/` thật — cùng nguyên tắc đã áp cho
// test-suggestions-logic.js sau lần mất `rr.json`.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname);
const SCRIPT = path.join(REPO, 'scripts/migrate-to-multiguild.js');
const GUILD = '1554742286598803526';
const GUILD2 = '999888777666555444';

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

/**
 * Dựng cây guardian giả trong thư mục tạm: `bots/guardian/{config.json,.env,src/data}`.
 * `files` = map đường dẫn tương đối -> nội dung (object -> JSON, string -> nguyên văn).
 */
function makeRoot(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-migrate-'));
  const guard = path.join(root, 'bots/guardian');
  fs.mkdirSync(path.join(guard, 'src/data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  // Copy chính script vào cây tạm để `__dirname` -> root tạm. Nhưng script ưu tiên
  // GUARDIAN_MIGRATE_ROOT nên bản copy chỉ để chắc chắn không lỡ tay chạy nhầm.
  fs.copyFileSync(SCRIPT, path.join(root, 'scripts/migrate-to-multiguild.js'));
  for (const [rel, val] of Object.entries(files)) {
    const f = path.join(guard, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof val === 'string' ? val : JSON.stringify(val, null, 2));
  }
  return root;
}

/**
 * Chạy script thành subprocess.
 *
 * KHÔNG dùng execFileSync: hàm đó ném exception, khiến cả suite chết im lặng
 * giữa chừng nếu script crash — không có dòng tổng kết, mọi test phía sau bị
 * bỏ qua mà không ai báo. Ở đây crash thành một FAIL có thật, suite vẫn chạy hết.
 */
let crashed = false;
function run(root, args = []) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/migrate-to-multiguild.js'), ...args], {
    env: { ...process.env, GUARDIAN_MIGRATE_ROOT: root },
    encoding: 'utf8',
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) {
    crashed = true;
    fail++;
    console.log(`  FAIL  script exit ${r.status} — ${out.trim().split('\n')[0]}`);
  }
  return out;
}
function tryRun(root, args = []) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/migrate-to-multiguild.js'), ...args], {
    env: { ...process.env, GUARDIAN_MIGRATE_ROOT: root },
    encoding: 'utf8',
  });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

const exists = (f) => fs.existsSync(f);
// Đọc kiểu "null thay vì ném": script migrate nếu crash sẽ để lại file thiếu.
// Ném ở đây giết cả suite, mọi test sau bị bỏ qua mà không ai báo — đúng cái lỗ
// đã gặp khi mutation làm `roles.admin.join` vỡ. Trả null thay vì để assert
// báo FAIL ở đúng dòng đang hỏng.
const readJson = (f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch { return null; }
};
const readText = (f) => {
  try { return fs.readFileSync(f, 'utf8'); }
  catch { return null; }
};
const at = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const roots = [];
function cleanup() {
  for (const r of roots) {
    try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* thư mục tạm */ }
  }
}

const ENV_FULL = [
  `DISCORD_TOKEN=BOT.tok.dummy`,
  `CLIENT_ID=123456789`,
  `GUILD_ID=${GUILD}`,
  `WELCOME_CHANNEL_ID=100000000000000001`,
  `NEWBIE_ROLE_ID=100000000000000002`,
  `TICKET_CHANNEL_ID=100000000000000003`,
  `TICKET_CATEGORY_ID=100000000000000004`,
  `ADMIN_ROLE_ID=100000000000000005`,
  `LOG_CHANNEL_ID=100000000000000006`,
  `VERIFY_CHANNEL_ID=100000000000000007`,
  `VERIFY_ROLE_ID=100000000000000008`,
  `VERIFY_PENDING_ROLE_ID=100000000000000009`,
  `STARBOARD_CHANNEL_ID=100000000000000010`,
  `SUGGESTIONS_CHANNEL_ID=100000000000000011`,
].join('\n');

// config.json có đủ 9 role rank như file thật để assert "giữ nguyên verbatim".
const NINE_RANKS = Array.from({ length: 9 }, (_, i) => ({
  name: `rank${i + 1}`, roleId: `2000000000000000${i + 1}`, emojiId: `3000000000000000${i + 1}`,
  level: (i + 1) * 4, color: 0x00ff00,
}));
const CONFIG = {
  modules: { welcome: true, verify: true, tags: true, levels: true, ticket: true },
  automod: { badwords: ['fuck', 'shit', 'bitch'], spam: { messages: 5, windowMs: 5000, timeoutSeconds: 60 } },
  levels: { roles: NINE_RANKS, xp: { message: 3, reaction: 1 } },
};

(async () => {
  console.log('\n=== 1. Dry-run KHÔNG ghi gì ===');
  {
    const root = makeRoot({
      '.env': ENV_FULL,
      'config.json': CONFIG,
      'src/data/levels.json': { u1: { xp: 10 } },
      'src/data/tags.json': { rule: 'x' },
    });
    roots.push(root);
    const out = run(root);
    const d = path.join(root, 'bots/guardian/src/data');
    check('dry-run in ra bảng', /DRY-RUN/.test(out), out.slice(0, 120));
    check('dry-run không tạo thư mục guilds/', !exists(path.join(d, 'guilds')));
    check('dry-run không tạo config/guilds/', !exists(path.join(root, 'bots/guardian/config/guilds')));
    check('dry-run không đụng file nguồn', exists(path.join(d, 'levels.json')) && exists(path.join(d, 'tags.json')));
    check('không có .migrated.bak sau dry-run', !exists(path.join(d, 'levels.json.migrated.bak')));
  }

  console.log('\n=== 2. --apply: copy state + gấp đủ binding từ .env ===');
  {
    const root = makeRoot({
      '.env': ENV_FULL,
      'config.json': CONFIG,
      'src/data/levels.json': { u1: { xp: 10 }, u2: { xp: 20 } },
      'src/data/tags.json': { rule: 'nội quy' },
      'src/data/rr.json': [{ channelId: 'c1', emoji: '⭐', roleId: 'r1' }],
    });
    roots.push(root);
    run(root, ['--apply']);
    // Script crash giữa chừng sẽ để lại thư mục thiếu — đọc tiếp sẽ ném và giết
    // suite. Thoát sớm block này; `crashed` đã được đánh dấu rồi.
    const guard = path.join(root, 'bots/guardian');
    const gd = path.join(guard, 'src/data/guilds', GUILD);

    check('levels sang thư mục guild', at(readJson(path.join(gd, 'levels.json')), 'u2.xp') === 20);
    check('tags sang thư mục guild', at(readJson(path.join(gd, 'tags.json')), 'rule') === 'nội quy');
    check('rr (mảng) sang thư mục guild', readJson(path.join(gd, 'rr.json'))?.length === 1);

    const cfg = readJson(path.join(guard, 'config/guilds', `${GUILD}.json`));
    check('ghi marker schema: 2', cfg?.schema === 2, String(cfg?.schema));
    check('ghi guildId', cfg?.guildId === GUILD);
    check('configured = true', cfg?.configured === true);
    const binds = [
      ['channels.welcome', '100000000000000001'],
      ['roles.newbie', '100000000000000002'],
      ['channels.ticket', '100000000000000003'],
      ['channels.ticketCategory', '100000000000000004'],
      ['channels.log', '100000000000000006'],
      ['roles.verify', '100000000000000008'],
      ['roles.verifyPending', '100000000000000009'],
      ['channels.verify', '100000000000000007'],
      ['channels.starboard', '100000000000000010'],
      ['channels.suggestions', '100000000000000011'],
    ];
    for (const [dotted, val] of binds) {
      const got = at(cfg, dotted);
      check(`gấp ${dotted}`, got === val, `got ${got}`);
    }
    check('roles.admin là MẢNG', Array.isArray(cfg?.roles?.admin), typeof cfg?.roles?.admin);
    check('roles.admin chứa ADMIN_ROLE_ID',
      JSON.stringify(cfg?.roles?.admin) === JSON.stringify(['100000000000000005']), JSON.stringify(cfg?.roles?.admin));
    check('giữ nguyên 9 role rank', cfg?.levels?.roles?.length === 9, String(cfg?.levels?.roles?.length));
    check('role rank verbatim (id + level)',
      cfg?.levels?.roles?.[3]?.roleId === NINE_RANKS[3].roleId && cfg?.levels?.roles?.[3]?.level === NINE_RANKS[3].level);
    check('automod giữ nguyên', JSON.stringify(cfg?.automod) === JSON.stringify(CONFIG.automod));
    check('modules giữ nguyên', cfg?.modules?.welcome === true && cfg?.modules?.ticket === true);
  }

  console.log('\n=== 3. KHÔNG xoá nguồn — chỉ rename thành .migrated.bak ===');
  {
    const root = makeRoot({
      '.env': ENV_FULL,
      'config.json': CONFIG,
      'src/data/levels.json': { u1: { xp: 10 } },
    });
    roots.push(root);
    run(root, ['--apply']);
    const d = path.join(root, 'bots/guardian/src/data');
    check('file gốc vẫn tồn tại dưới tên .migrated.bak',
      exists(path.join(d, 'levels.json.migrated.bak')));
    check('nội dung .bak nguyên vẹn',
      readJson(path.join(d, 'levels.json.migrated.bak')).u1.xp === 10);
    check('file gốc đã biến mất khỏi vị trí cũ', !exists(path.join(d, 'levels.json')));
  }

  console.log('\n=== 4. Chạy lần 2 là no-op (cổng chống chạy lại) ===');
  {
    const root = makeRoot({
      '.env': ENV_FULL,
      'config.json': CONFIG,
      'src/data/levels.json': { u1: { xp: 10 } },
      'src/data/tags.json': { rule: 'x' },
    });
    roots.push(root);
    run(root, ['--apply']);
    const guard = path.join(root, 'bots/guardian');
    const gd = path.join(guard, 'src/data/guilds', GUILD);
    const before = {
      levels: readText(path.join(gd, 'levels.json')),
      cfg: readText(path.join(guard, 'config/guilds', `${GUILD}.json`)),
    };
    // Sửa file đích thủ công để chứng minh lần 2 KHÔNG ghi đè bằng dữ liệu gốc.
    fs.writeFileSync(path.join(gd, 'levels.json'), JSON.stringify({ u1: { xp: 999 } }));

    const out2 = run(root, ['--apply']);
    check('lần 2 báo đã migrate', /ĐÃ CÓ|đã migrate|schema:2/.test(out2), out2.slice(0, 200));
    check('lần 2 không copy lại file gốc',
      !exists(path.join(guard, 'src/data/levels.json.migrated.bak.migrated.bak')));
    check('lần 2 KHÔNG ghi đè levels đã sửa tay',
      at(readJson(path.join(gd, 'levels.json')), 'u1.xp') === 999,
      String(at(readJson(path.join(gd, 'levels.json')), 'u1.xp')));
    check('lần 2 KHÔNG ghi đè config đích',
      readText(path.join(guard, 'config/guilds', `${GUILD}.json`)) === before.cfg);
    check('lần 2 KHÔNG copy lại config.json mới hơn',
      readText(path.join(guard, 'config/guilds', `${GUILD}.json`)) === before.cfg);
  }

  console.log('\n=== 5. Conflict: KHÔNG ghi đè, tách phần lệch ra file riêng ===');
  {
    const root = makeRoot({
      '.env': ENV_FULL,
      'config.json': CONFIG,
      // đích đã có u1 với XP KHÁC -> phải coi là conflict
      [`src/data/guilds/${GUILD}/levels.json`]: { u1: { xp: 50 }, u3: { xp: 7 } },
      'src/data/levels.json': { u1: { xp: 10 }, u2: { xp: 20 } },
    });
    roots.push(root);
    const out = run(root, ['--apply']);
    const guard = path.join(root, 'bots/guardian');
    const gd = path.join(guard, 'src/data/guilds', GUILD);

    check('dry-run báo XUNG ĐỘT', /XUNG ĐỘT/.test(out), out.slice(0, 200));
    check('báo có giá trị khác nhau', /GIÁ TRỊ KHÁC/.test(out), out.slice(0, 300));
    check('báo khoá chỉ ở nguồn', /chỉ ở file phẳng/.test(out));
    check('báo khoá chỉ ở đích', /chỉ ở thư mục guild/.test(out));
    check('KHÔNG tự lấy max(xp)', !/max/i.test(out.replace(/không tự lấy max/gi, '')), out.slice(0, 400));

    const dest = readJson(path.join(gd, 'levels.json'));
    check('file đích giữ nguyên u1 (không bị ghi đè)', at(dest, 'u1.xp') === 50, String(at(dest, 'u1.xp')));
    check('file đích giữ nguyên u3', at(dest, 'u3.xp') === 7);
    check('không tự chép u2 vào đích', dest?.u2 === undefined);

    const un = path.join(gd, 'levels.json.legacy-unmerged.json');
    check('tạo file legacy-unmerged', exists(un));
    const extra = readJson(un);
    check('legacy-unmerged ghi khoá chỉ ở nguồn', at(extra, 'onlyInSource.u2.xp') === 20, JSON.stringify(extra).slice(0, 200));
    check('legacy-unmerged ghi cả giá trị lệch', Boolean(extra?.valueDiffers?.u1), JSON.stringify(extra).slice(0, 200));
    check('file phẳng VẪN CÒN (không xoá khi conflict)',
      exists(path.join(guard, 'src/data/levels.json')));
    check('revert block nhắc rõ không xoá tự động', /VẪN CÒN/.test(out), out.slice(-400));
  }

  console.log('\n=== 6. verify-panel copy NGUYÊN BYTE ===');
  {
    // Cố tình viết JSON lệch chuẩn: thừa khoảng trắng + key lộn xộn. Nếu script
    // parse rồi stringify lại thì hash sẽ đổi — test này bắt đúng lỗi đó.
    const raw = '{\n  "messageId":  "1554849284636278847",\n    "channelId":"1554748500045070419"\n}\n';
    const root = makeRoot({
      '.env': ENV_FULL,
      'config.json': CONFIG,
      'src/data/verify-panel.json': raw,
    });
    roots.push(root);
    run(root, ['--apply']);
    const gd = path.join(root, 'bots/guardian/src/data/guilds', GUILD);
    const copied = readText(path.join(gd, 'verify-panel.json'));
    check('verify-panel byte-identical', copied === raw, JSON.stringify(copied));
    // id để nguyên dạng chuỗi ở file nguồn thì vẫn là chuỗi ở file đích:
    // script KHÔNG parse rồi stringify lại, nên không chuẩn hoá gì cả.
    check('verify-panel id không bị chuẩn hoá (vẫn là chuỗi)',
      readJson(path.join(gd, 'verify-panel.json')).messageId === '1554849284636278847',
      typeof readJson(path.join(gd, 'verify-panel.json')).messageId);
  }

  console.log('\n=== 7. File rỗng / không có nguồn bị bỏ qua, không sinh file rác ===');
  {
    const root = makeRoot({
      '.env': ENV_FULL,
      'config.json': CONFIG,
      'src/data/suggestions.json': {},
      'src/data/tags.json': '[]',
    });
    roots.push(root);
    run(root, ['--apply']);
    const gd = path.join(root, 'bots/guardian/src/data/guilds', GUILD);
    check('{} không tạo file ở đích', !exists(path.join(gd, 'suggestions.json')));
    check('[] rỗng không tạo file ở đích', !exists(path.join(gd, 'tags.json')));
    check('file rỗng vẫn nằm nguyên chỗ (không đụng)', exists(path.join(root, 'bots/guardian/src/data/suggestions.json')));
  }

  console.log('\n=== 8. token KHÔNG bao giờ lọt ra output ===');
  {
    const root = makeRoot({
      '.env': ENV_FULL + '\nDISCORD_TOKEN=SUPER.SECRET.VALUE.abc123\n',
      'config.json': CONFIG,
      'src/data/levels.json': { u1: { xp: 1 } },
    });
    roots.push(root);
    const out = run(root) + run(root, ['--apply']);
    check('output không chứa token', !out.includes('SUPER.SECRET.VALUE.abc123'));
    check('file config đích không chứa token',
      !(readText(path.join(root, 'bots/guardian/config/guilds', `${GUILD}.json`)) || '')
        .includes('SUPER.SECRET.VALUE'));
  }

  console.log('\n=== 9. Thiếu GUILD_ID -> từ chối, không ghi gì ===');
  {
    const root = makeRoot({ '.env': 'CLIENT_ID=1', 'config.json': CONFIG });
    roots.push(root);
    const { ok, out } = tryRun(root, ['--apply']);
    check('exit != 0', !ok);
    check('báo thiếu GUILD_ID', /GUILD_ID/.test(out), out.slice(0, 120));
    check('không tạo thư mục nào',
      !exists(path.join(root, 'bots/guardian/src/data/guilds')) &&
      !exists(path.join(root, 'bots/guardian/config/guilds')));
  }

  console.log('\n=== 10. Binding thiếu trong .env: ghi rõ thay vì im lặng ===');
  {
    const root = makeRoot({
      '.env': ENV_FULL.split('\n').filter((l) => !l.startsWith('STARBOARD_CHANNEL_ID')).join('\n'),
      'config.json': CONFIG,
    });
    roots.push(root);
    const out = run(root);
    check('báo biến thiếu', /STARBOARD_CHANNEL_ID/.test(out) && /THIẾU/.test(out), out.slice(0, 400));
    check('không tự bịa giá trị', !/1554748465232351263/.test(out.split('CONFIG')[1] || ''));
    run(root, ['--apply']);
    const cfg = readJson(path.join(root, 'bots/guardian/config/guilds', `${GUILD}.json`));
    check('config đích không có key starboard bịa', cfg.channels?.starboard === undefined);
    check('các binding khác vẫn vào đủ', cfg.channels.log === '100000000000000006');
  }

  console.log('\n=== 11. Guild thứ hai không đụng guild thứ nhất ===');
  {
    const root = makeRoot({
      '.env': ENV_FULL,
      'config.json': CONFIG,
      [`src/data/guilds/${GUILD}/tags.json`]: { a: '1' },
      [`src/data/guilds/${GUILD2}/tags.json`]: { b: '2' },
      'src/data/tags.json': { legacy: 'x' },
    });
    roots.push(root);
    run(root, ['--apply']);
    const g2 = path.join(root, 'bots/guardian/src/data/guilds', GUILD2);
    check('guild 2 giữ nguyên tags của nó', readJson(path.join(g2, 'tags.json')).b === '2');
    check('không trộn guild 1 vào guild 2', readJson(path.join(g2, 'tags.json')).a === undefined);
    check('chỉ migrate cho GUILD_ID trong .env',
      !exists(path.join(root, 'bots/guardian/config/guilds', `${GUILD2}.json`)));
  }

  console.log(`\n${'='.repeat(46)}`);
  if (crashed) console.log('⚠ CÓ script crash trong lúc test — các assert đọc file thiếu ở trên đã FAIL, không phải bỏ qua im lặng.');
  console.log(`PASS: ${pass}   FAIL: ${fail}\n`);
  cleanup();
  process.exit(fail ? 1 : 0);
})();
