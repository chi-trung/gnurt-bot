// Auto-mod: chặn link mời server khác, tin nhắn dồn dập, tag mass, từ ngữ xấu.
// Bypass: bot + thành viên có Manage Messages / Administrator.
// Lưu ý: kiểm tra nội dung cần MESSAGE CONTENT INTENT (bật ở Portal).
const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { sendLog } = require('../core/log');

// Chỉ khớp link mời THẬT của Discord, và chỉ khi nó là ĐẦU TÊN MIỀN của URL.
// Nếu dò "discord.gg" trong text thuần thì "https://example.com/discord.gg" hoặc
// "a.discord.gg" sẽ bị khớp nhầm (trước "discord" là "/" hoặc "." — đều không phải
// word char) → tin vô hại bị xoá. Vì vậy bắt buộc có protocol:// phía trước.
const INVITE_RE = /\bhttps?:\/\/(?:www\.)?discord\.(?:gg|io|me)\/\S+|\bhttps?:\/\/(?:www\.)?discord(?:app)?\.com\/invite\/\S+/i;

// strike counting (in-memory, reset khi bot restart)
const strikes = new Map(); // userId -> count
const spamWindows = new Map(); // userId -> [timestamps]

function bumpStrike(userId) {
  const n = (strikes.get(userId) || 0) + 1;
  strikes.set(userId, n);
  return n;
}

async function penalize(msg, ctx, reason, description) {
  const cfg = ctx.config.automod;
  const strike = bumpStrike(msg.author.id);

  try {
    await msg.delete();
  } catch (err) {
    console.error('Automod không xóa được tin:', err.message);
  }

  // strike >= 2 → timeout
  let timedOut = false;
  if (strike >= 2 && msg.member) {
    try {
      await msg.member.timeout(cfg.spam.timeoutSeconds * 1000, `Automod: ${reason}`);
      timedOut = true;
      strikes.set(msg.author.id, 0);
    } catch (err) {
      console.error('Automod không timeout được:', err.message);
    }
  }

  // báo ngay trong kênh (tự xóa sau 5s)
  try {
    const notice = await msg.channel.send(
      `⚠️ ${msg.author}, tin nhắn vi phạm (**${reason}**).${timedOut ? ' Bạn bị timeout ' + cfg.spam.timeoutSeconds + 's.' : ''}`
    );
    setTimeout(() => notice.delete().catch(() => {}), 5000);
  } catch {
    /* kênh có thể không cho gửi — bỏ qua */
  }

  await sendLog(
    ctx,
    new EmbedBuilder()
      .setColor(timedOut ? 0xe74c3c : 0xe67e22)
      .setTitle('🛡️ Auto-mod')
      .setDescription(
        `${msg.author} trong ${msg.channel}\nLý do: **${reason}**\n${description}\nStrike: ${strike}${timedOut ? ' → **timeout**' : ''}`
      )
      .setTimestamp()
  );
}

module.exports = {
  name: 'automod',
  events: [
    {
      name: Events.MessageCreate,
      handler: async (ctx, msg) => {
        if (!msg.guild || msg.author.bot || !msg.member) return;
        const perms = msg.memberPermissions;
        if (perms?.has(PermissionFlagsBits.ManageMessages) || perms?.has(PermissionFlagsBits.Administrator)) return;

        const cfg = ctx.config.automod;
        const content = msg.content || '';

        // 1. Link mời (cần content)
        if (cfg.invites && content && INVITE_RE.test(content)) {
          await penalize(msg, ctx, 'link mời server', `Nội dung: \`${content.slice(0, 200)}\``);
          return;
        }

        // 2. Từ ngữ xấu (cần content)
        if (cfg.badwords.length && content) {
          const lower = content.toLowerCase();
          const hit = cfg.badwords.find((w) => w && lower.includes(String(w).toLowerCase()));
          if (hit) {
            await penalize(msg, ctx, 'từ ngữ xấu', 'Nội dung đã bị xóa.');
            return;
          }
        }

        // 3. Tag mass (mentions luôn có, không cần content intent)
        if (cfg.mentions.max > 0 && msg.mentions.users.size > cfg.mentions.max) {
          await penalize(msg, ctx, 'tag quá nhiều người', `Đã tag ${msg.mentions.users.size} người.`);
          return;
        }

        // 4. Spam (rate)
        const now = Date.now();
        const win = (spamWindows.get(msg.author.id) || []).filter((t) => now - t < cfg.spam.windowMs);
        win.push(now);
        spamWindows.set(msg.author.id, win);
        if (win.length > cfg.spam.messages) {
          spamWindows.set(msg.author.id, []);
          await penalize(msg, ctx, 'spam', `${win.length} tin trong ${cfg.spam.windowMs}ms.`);
        }
      },
    },
  ],
};
