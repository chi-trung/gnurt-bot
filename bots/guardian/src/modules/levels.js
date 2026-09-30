// Levels: XP theo tin nhắn / reaction / thời gian nghe voice → level → role rank (thang LoL).
// Công thức sqrt (chậm rồi nhanh): level = floor(sqrt(xp / 100)) + 1
// Cấu hình: config.json → levels { xp, cooldownMs, voice, roles[] }.
// Storage: core/store → data/guilds/<guildId>/levels.json
//   { "<userId>": { xp, lastMsg, lastReact, voiceStart, voiceAcc } }
//
// Mọi thao tác state đều nhận `guildId` từ chính event (`msg.guildId`,
// `newState.guild.id`, `interaction.guildId`). Bản single-guild từng đoán
// `guilds.cache.values().next().value` — sang server thứ hai là đoán trúng
// server nào tình cờ được cache trước, tức gán role nhầm và đếm XP chung.
const { Events, SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const store = require('../core/store');

/** Công thức sqrt: level = floor(sqrt(xp/100)) + 1. */
function levelOf(xp) {
  const x = Math.max(0, Number(xp) || 0);
  return Math.floor(Math.sqrt(x / 100)) + 1;
}
/**
 * Đảo ngược công thức: XP tối thiểu để ĐẠT level `level` (level 1 = 0 XP).
 * level L cần (L-1)^2 * 100 XP. Dùng cho thanh tiến trình: cần = xpAtLevel(lv+1) - xpAtLevel(lv).
 */
function xpAtLevel(level) {
  const l = Math.max(1, Math.floor(level) || 1);
  return (l - 1) ** 2 * 100;
}

/** Bậc rank cao nhất mà level hiện tại đạt. Tự sort nên thứ tự mảng không quan trọng. */
function rankFor(roles, level) {
  let hit = null;
  for (const r of roles.slice().sort((a, b) => a.level - b.level)) {
    if (level >= r.level) hit = r;
  }
  return hit;
}

/** config.levels.roles: [{ name, roleId, emojiId, level, color }] — thứ tự thang, thấp → cao. */
function getRanks(ctx) {
  const cfg = (ctx.config.levels && ctx.config.levels.roles) || [];
  return cfg
    .filter((r) => r && r.roleId && r.name && Number.isFinite(r.level))
    .slice()
    .sort((a, b) => a.level - b.level);
}

function record(store, userId) {
  if (!store[userId]) {
    store[userId] = { xp: 0, lastMsg: 0, lastReact: 0, voiceStart: 0, voiceAcc: 0 };
  }
  const r = store[userId];
  for (const k of ['xp', 'lastMsg', 'lastReact', 'voiceStart', 'voiceAcc']) {
    if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) r[k] = 0;
  }
  return r;
}

/**
 * Gỡ hết role rank cũ, cấp đúng 1 role theo level.
 * Role nào nằm >= cao nhất của bot thì bỏ qua (không throw) — Discord không cho bot
 * tự hạ role của chính mình.
 */
async function applyRoles(ctx, guildId, userId, level) {
  const ranks = getRanks(ctx);
  if (!ranks.length) return false;
  try {
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot) return false;

    const me = guild.members.me;
    const myTop = me ? me.roles.highest.position : 0;
    const target = rankFor(ranks, level);
    const want = target ? target.roleId : null;

    // Chỉ động vào role nào bot thật sự manage được (position < cao nhất bot).
    // Role >= myTop thì bỏ qua im lặng: Discord sẽ từ chối, cộng dồn nhiều role
    // bị chặn chỉ đổi 1 lỗi ra thành nhiều lỗi.
    const manageable = (roleId) => {
      const role = guild.roles.cache.get(roleId);
      return !role || role.position < myTop;
    };

    for (const r of ranks) {
      if (r.roleId === want) continue;
      if (member.roles.cache.has(r.roleId) && manageable(r.roleId)) await member.roles.remove(r.roleId);
    }
    if (want && !member.roles.cache.has(want) && manageable(want)) await member.roles.add(want);
    return true;
  } catch (err) {
    console.error('Levels applyRoles lỗi:', err.message);
    return false;
  }
}

/**
 * Markup emoji custom đúng chuẩn Discord: static `<:ten:123>`, animated `<a:ten:123>`.
 * Phải resolve từ cache guild vì `a`/tên đều sai lúc hardcode — emoji không render,
 * hiện nguyên chuỗi markup thô trong embed.
 *
 * Sync, chỉ đọc cache. Cache được `init()` nạp sẵn; hụt thì trả null để caller
 * fallback sang icon unicode.
 */
function rankTag(ctx, guildId, rank) {
  if (!rank || !rank.emojiId) return null;
  const guild = ctx.client.guilds?.cache?.get(guildId);
  const emoji = guild?.emojis?.cache?.get(rank.emojiId);
  if (!emoji) return null;
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

function progressBar(cur, need, width) {
  const w = width || 14;
  const pct = need > 0 ? Math.max(0, Math.min(1, cur / need)) : 1;
  const filled = Math.round(pct * w);
  return '`[' + '█'.repeat(filled) + '░'.repeat(Math.max(0, w - filled)) + ']`';
}

const levelCommand = new SlashCommandBuilder()
  .setName('level')
  .setDescription('Xem level và XP của bạn (hoặc của người khác)')
  .addUserOption((o) => o.setName('user').setDescription('Người muốn xem (mặc định: bạn)'));

const leaderboardCommand = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Bảng xếp hạng level');

async function handleInteraction(interaction, ctx) {
  if (!interaction.isChatInputCommand()) return false;
  const name = interaction.commandName;
  if (name !== 'level' && name !== 'leaderboard') return false;

  const guildId = interaction.guildId;
  const ranks = getRanks(ctx);

  if (name === 'level') {
    const user = interaction.options.getUser('user') || interaction.user;
    // Đọc -> sửa -> ghi dưới khoá: giữa lúc chốt XP voice, một MessageCreate
    // song song có thể đang cộng XP cho cùng user.
    const { rec, before, after } = await store.updateAsync(guildId, 'levels', (s) => {
      const r = record(s, user.id);
      const b = levelOf(r.xp);
      const gained = flushVoice(ctx, s, user.id);
      if (gained > 0) addXp(s, user.id, gained);
      return { rec: r, before: b, after: levelOf(r.xp) };
    });
    const xp = rec.xp;
    const lv = levelOf(xp);
    const cur = xp - xpAtLevel(lv);
    const need = xpAtLevel(lv + 1) - xpAtLevel(lv);
    const rank = rankFor(ranks, lv);
    const icon = rankTag(ctx, guildId, rank) || '🏅';

    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [
        new EmbedBuilder()
          .setColor(rank && Number.isFinite(rank.color) ? rank.color : 0x5865f2)
          .setAuthor({ name: `${user.username} — Level ${lv}`, iconURL: user.displayAvatarURL({ size: 64 }) })
          .setDescription(
            [
              `${progressBar(cur, need)} **${cur} / ${need} XP**`,
              rank ? `Hạng: ${icon} **${rank.name}**` : 'Hạng: chưa có bậc nào',
              `Tổng XP: **${xp}**`,
            ].join('\n')
          )
          .setFooter({ text: `Level ${lv} → ${lv + 1}` }),
      ],
    });
    if (user.id !== interaction.user.id || after !== before) {
      // người khác hỏi, hoặc XP voice vừa đẩy qua bậc mới -> đồng bộ role
      await applyRoles(ctx, guildId, user.id, lv);
    }
    return true;
  }

  // /leaderboard: chốt voice cho user còn đang trong kênh (chưa có sự kiện rời).
  // Chỉ xếp hạng guild này — data đã khoá theo guildId từ đầu.
  const beforeLb = await store.updateAsync(guildId, 'levels', (s) => {
    const before = {};
    for (const [id, r] of Object.entries(s)) {
      if (!r || !r.voiceStart) continue;
      before[id] = levelOf(r.xp);
      const gained = flushVoice(ctx, s, id);
      if (gained > 0) addXp(s, id, gained);
    }
    return before;
  });
  const levels = store.read(guildId, 'levels');
  for (const [id, before] of Object.entries(beforeLb)) {
    const lv = levelOf(levels[id].xp);
    if (lv !== before) await applyRoles(ctx, guildId, id, lv);
  }

  const top = Object.entries(levels)
    .map(([id, r]) => ({ id, xp: (r && r.xp) || 0 }))
    .filter((r) => r.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 10);

  if (!top.length) {
    await interaction.reply({
      content: 'Chưa có ai tích luỹ XP. Nhắn tin, thả reaction hoặc vào voice để bắt đầu!',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((r, i) => {
    const rank = rankFor(ranks, levelOf(r.xp));
    const icon = rankTag(ctx, guildId, rank) || '▪️';
    const tag = i < 3 ? medals[i] : `${i + 1}.`;
    return `${tag} <@${r.id}> — Lv **${levelOf(r.xp)}** · **${r.xp}** XP${rank ? ` · ${icon} ${rank.name}` : ''}`;
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🏆 Bảng xếp hạng level')
        .setDescription(lines.join('\n'))
        .setFooter({ text: `Top ${top.length} · dùng /level để xem của bạn` }),
    ],
  });
  return true;
}

/** Cộng XP vào record (chưa lưu). Trả level trước/sau. */
function addXp(store, userId, amount) {
  const rec = record(store, userId);
  const before = levelOf(rec.xp);
  rec.xp += Math.max(0, Math.floor(amount));
  return { rec, before, after: levelOf(rec.xp) };
}

/** Cộng XP, lưu, đồng bộ role nếu lên bậc. Trả level trước/sau. */
async function grantXp(ctx, guildId, userId, amount) {
  const { before, after } = await store.updateAsync(guildId, 'levels', (s) => addXp(s, userId, amount));
  if (after !== before) await applyRoles(ctx, guildId, userId, after);
  return { before, after };
}

/**
 * Chốt XP voice của 1 user: phần đang tích (voiceStart) + phần quỹ dở (voiceAcc).
 * KHÔNG cộng vào xp — chỉ trả về số XP ứng viên và reset quỹ/mốc, để nơi gọi
 * quyết định có cộng vào xp hay không (và có applyRoles hay không).
 *
 * Gọi khi rời/đổi kênh, và khi đọc /level, /leaderboard (user còn trong voice nên
 * chưa có sự kiện rời để chốt).
 */
function flushVoice(ctx, store, userId) {
  const rec = store[userId];
  if (!rec) return 0;
  const v = (ctx.config.levels && ctx.config.levels.voice) || {};
  const perMs = (v.xpPer ?? 10) / ((v.perMinutes ?? 5) * 60000);
  const pending = rec.voiceAcc + (rec.voiceStart ? Math.floor((Date.now() - rec.voiceStart) * perMs) : 0);
  if (rec.voiceStart) rec.voiceStart = Date.now(); // mốc mới để không tính trùng đoạn này
  if (pending <= 0) return 0;
  rec.voiceAcc = 0;
  return pending;
}

module.exports = {
  name: 'levels',
  commands: [levelCommand, leaderboardCommand],
  handleInteraction,
  init: async (ctx, guildId) => {
    const ranks = getRanks(ctx);
    if (!ranks.length) {
      console.warn(`Levels [${guildId}]: config.levels.roles rỗng — chưa gán role rank được.`);
      return;
    }
    const guild = ctx.client.guilds.cache.get(guildId);
    if (!guild) return;

    // Gateway KHÔNG gửi emoji trong GUILD_CREATE -> cache rỗng lúc khởi động.
    // rankTag() đọc cache nên phải nạp trước, nếu không embed sẽ mất icon rank.
    try {
      await guild.emojis.fetch();
    } catch (err) {
      console.warn(
        `Levels [${guildId}]: không nạp được emoji guild — icon rank sẽ fallback unicode:`,
        err.message
      );
    }

    const myTop = guild.members.me ? guild.members.me.roles.highest.position : 0;
    const blocked = ranks.filter((r) => {
      const role = guild.roles.cache.get(r.roleId);
      return role && role.position >= myTop;
    });
    if (blocked.length) {
      console.warn(
        `Levels [${guildId}]: ${blocked.length} role rank cao bằng/bố hơn bot (${blocked.map((b) => b.name).join(', ')}) — sẽ không cấp được.`
      );
    }
  },
  events: [
    {
      name: Events.MessageCreate,
      handler: async (ctx, msg) => {
        if (!msg.guild || msg.author.bot) return;
        const content = (msg.content || '').trim();
        if (!content) return;
        if (content.startsWith('`') || content.startsWith('>')) return;

        // Chặn cooldown nằm TRONG khoá, không phải ngoài: đọc `lastMsg` rồi
        // ghi ở 2 lần riêng thì hai tin gần nhau đều thấy "đủ hạn" và cùng
        // được cộng XP.
        const ok = await store.updateAsync(msg.guildId, 'levels', (s) => {
          const rec = record(s, msg.author.id);
          const now = Date.now();
          if (now - rec.lastMsg < (ctx.config.levels.cooldownMs || 60000)) return false;
          rec.lastMsg = now;
          return true;
        });
        if (!ok) return;

        const { before, after } = await grantXp(ctx, msg.guildId, msg.author.id, ctx.config.levels.xp?.message ?? 1);
        if (after !== before) {
          try {
            await msg.channel.send(`🎉 <@${msg.author.id}> lên **Level ${after}**!`);
          } catch {
            /* không gửi được thì bỏ qua — XP vẫn đã ghi */
          }
        }
      },
    },
    {
      name: Events.MessageReactionAdd,
      handler: async (ctx, reaction, user) => {
        if (user.bot) return;
        if (reaction.partial) {
          try {
            await reaction.fetch();
          } catch {
            return;
          }
        }
        const msg = reaction.message;
        if (!msg || !msg.guild) return;
        if (msg.author && msg.author.id === user.id) return;

        const ok = await store.updateAsync(msg.guildId, 'levels', (s) => {
          const rec = record(s, msg.author.id);
          const now = Date.now();
          if (now - rec.lastReact < (ctx.config.levels.cooldownMs || 60000)) return false;
          rec.lastReact = now;
          return true;
        });
        if (!ok) return;

        await grantXp(ctx, msg.guildId, msg.author.id, ctx.config.levels.xp?.reaction ?? 2);
      },
    },
    {
      name: Events.VoiceStateUpdate,
      handler: async (ctx, oldState, newState) => {
        const userId = (newState && newState.id) || (oldState && oldState.id);
        if (!userId) return;
        // Chỉ xử lý THAY ĐỔI KÊNH. Discord cũng bắn event khi mute/deafen/stream
        // (channelId không đổi) — nếu không chặn thì mốc thời gian bị reset liên
        // tục và user ngồi im trong voice mất sạch XP.
        if (oldState.channelId === newState.channelId) return;
        if (newState.member && newState.member.user && newState.member.user.bot) return;
        const guildId = (newState.guild || oldState.guild)?.id;
        if (!guildId) return;

        const { before, after } = await store.updateAsync(guildId, 'levels', (s) => {
          const rec = record(s, userId);
          const b = levelOf(rec.xp);
          if (oldState.channelId && rec.voiceStart) {
            addXp(s, userId, flushVoice(ctx, s, userId));
            rec.voiceStart = 0;
          }
          if (newState.channelId) {
            rec.voiceStart = Date.now();
          }
          return { before: b, after: levelOf(rec.xp) };
        });
        if (after !== before) await applyRoles(ctx, guildId, userId, after);
      },
    },
  ],
};
