# Server Structure — Bản đồ setup (đã duyệt v1)

> Dùng làm checklist khi setup qua MCP (`discord-mcp` — bot "Gnurt - 1").
> Server: **g n u r t** — ID `1554742286598803526`

## Roles (thứ tự hierarchy, cao → thấp) — ✅ DONE 2026-09-30

- [x] 👑 Owner (đỏ #ED4245) — gán cho feb27.gnurt — perms 0 (bit ADMIN bị Discord chặn khi grant qua bot → thêm tay trong UI nếu muốn)
- [x] 🛡️ Admin (cam #E67E22) — perms 1100317191222
- [x] 🧭 Moderator (xanh dương #3498DB) — perms 1099511884800
- [x] ⭐ Thành viên ưu tú (vàng #F1C40F) — perms 248832
- [x] 🌱 Thành viên mới (xanh lá #2ECC71) — perms 84992
- [x] 🤖 Bot (xám #95A5A6) — perms 0 — đã gán cho bot "Gnurt - 1"
- [x] @everyone — giữ nguyên

> hierarchy verified: Gnurt-1(6) > Owner(5) > Admin(4) > Mod(3) > Star(2) > Newbie(1) > Bot(0) > @everyone

## Categories & Channels — ✅ DONE 2026-09-30 (đủ dấu tiếng Việt)

### 📌 THÔNG BÁO (ai cũng xem, chỉ admin/bot ghi)
- [x] #quy-tắc — deny @everyone send, allow 🤖 Bot
- [x] #thông-báo — deny @everyone send, allow 🤖 Bot — đã post thông báo setup
- [x] #log-bot — deny @everyone send, allow 🤖 Bot

### 👋 CHÀO MỪNG
- [x] #chào-mới
- [x] #giới-thiệu

### 💬 CHUNG
- [x] #tán-gẫu
- [x] #meme-pic
- [x] #âm-nhạc

### 🤖 BOT ZONE
- [x] #lệnh
- [x] #time-capsule
- [x] #uống-nước
- [x] #tâm-trạng
- [x] #thử-thách

### 🎫 HỖ TRỢ
- [x] #tạo-ticket

### 🎮 GIẢI TRÍ
- [x] #game-chat
- [x] #thảo-luận

### 🔊 VOICE
- [x] 🔹 Chill Zone
- [x] 🔹 Game Night
- [x] 🔹 Học Nhóm

## Kênh mặc định của Discord — ✅ ĐÃ DỌN 2026-09-30 (user xác nhận)
- [x] Xóa #chung, voice "Chung", category "Kênh Chat" + "Kênh đàm thoại" — verified qua REST (26 channels còn lại)

## Map bot → trách nhiệm

| Bot | Vai trò | Folder | Trạng thái |
|---|---|---|---|
| Gnurt - 1 (MCP) | Tạo cấu trúc, moderation, announce, webhook | `mcp-discord/` | ✅ setup xong |
| Guardian (tương lai) | Welcome + Ticket + anti-raid + auto-role 🌱 | `bots/guardian/` | planned |
| Time Capsule bot | Kênh `#time-capsule` | `bots/<tên>/` | planned |
| Hydro | Kênh `#uống-nước` | `bots/<tên>/` | planned |
| Moodi | Kênh `#tâm-trạng` | `bots/<tên>/` | planned |

## Ghi chú kỹ thuật (rút kinh nghiệm)

- Discord **giữ dấu tiếng Việt** trong tên channel (space → `-`). Tên bị mất dấu khi shell làm hỏng NFC → dùng `String.normalize('NFC')` (xem `scripts/fix-names.mjs`).
- Bot **không grant được quyền nó không có** (anti-escalation) → không thể set role nào có ADMIN qua bot.
- Thứ tự set overwrite: grant allow cho role bot TRƯỚC, deny @everyone SAU (grant requires bot đang có effective permission ở kênh đó).
- Bot không thể sửa overwrite cho chính role cao nhất của nó (hierarchy) → dùng role 🤖 Bot (vị trí thấp) gán cho bot.
- GUILD_ID chỉ đọc lúc start server → đổi `.env` phải chạy lại jar.
- MCP server chạy detached (`Start-Process`), sống qua phiên Claude Code.

## Điều kiện setup

- [x] MCP server online (`localhost:8085`, health UP, bot Login Successful)
- [x] Invite bot vào server (URL quyền đầy đủ 1102464674870)
- [x] GUILD_ID điền vào `.env`
- [x] Kết nối MCP (`/mcp` reconnect) — 75 tools
