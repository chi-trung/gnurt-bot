# Guardian Bot

Bot quản trị **đa năng** (kiểu Carl-bot): 1 Application — nhiều module, bật/tắt qua `config.json`.

| Module | Tính năng |
|---|---|
| `welcome` | Chào mừng trong #chào-mới + auto-role 🌱 Thành viên mới |
| `verify` | Panel nút trong #xác-nhận → nhận ✅ Đã xác nhận, gỡ ⏳ Chờ xác nhận; thành viên mới bị gán role chờ |
| `ticket` | Panel 🎫 trong #tạo-ticket, `/close`, nút đóng ticket |
| `logging` | Ghi vào #log-bot: tin xóa/sửa, vào/ra server, đổi role/ biệt danh |
| `automod` | Chặn link mời, từ ngữ xấu, tag mass, spam (timeout khi tái phạm) |
| `moderation` | `/kick` `/ban` `/timeout` `/warn` (warn lưu ở `src/data/warns.json`) |
| `reactionroles` | `/rr create` panel emoji → bấm nhận role, `/rr delete` gỡ panel |
| `tags` | `/tag create|delete|list|show` — trả lời nhanh, autocomplete tên tag |
| `starboard` | Tin đạt ≥3 ⭐ (config) → embed vào #starboard, tự update số sao |
| `suggestions` | `/suggest create|list|decide` — gợi ý trong #góp-ý + nút 👍/👎, staff duyệt |

## Cài đặt

1. **Application** tại https://discord.com/developers/applications
   - Tab **Bot** → copy token
   - Bật **Privileged Intents** (tab Bot → Privileged Gateway Intents):
     - `SERVER MEMBERS INTENT` — bắt buộc (welcome/auto-role/logging)
     - **`MESSAGE CONTENT INTENT` — bắt buộc** (automod chặn link/từ xấu; thiếu là bot bị disconnect 4016)
2. **Mời bot vào server** (quyền đầy đủ cho Phase 1–3):
   ```
   https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&permissions=1101927672854&integration_type=0&scope=bot+applications.commands
   ```
3. **Cấu hình:**
   ```powershell
   copy .env.example .env
   # sửa .env: điền DISCORD_TOKEN, CLIENT_ID
   # Phase 2 (tùy chọn): VERIFY_CHANNEL_ID, VERIFY_ROLE_ID, VERIFY_PENDING_ROLE_ID
   # Phase 3 (tùy chọn): STARBOARD_CHANNEL_ID, SUGGESTIONS_CHANNEL_ID
   ```
   Tùy chọn trong `config.json`: bật/tắt module, danh sách từ xấu, ngưỡng spam/tag.
4. **Chạy:**
   ```powershell
   npm install
   npm start
   ```

## Kiểm tra sau khi chạy

- [ ] Log có `Module ...: OK` ×10 và `Đã đăng ký 8 lệnh: /close, /kick, /ban, /timeout, /warn, /rr, /tag, /suggest`
- [ ] Vào server → embed chào mừng + role 🌱 Thành viên mới + role ⏳ Chờ xác nhận
- [ ] #xác-nhận có panel → bấm **✅ Tôi đồng ý** → nhận ✅ Đã xác nhận, mất role chờ, log vào #log-bot
- [ ] `/rr create channel:#tán-gẫu role:@role emoji:👍` → panel hiện, bấm 👍 → có role, bỏ react → mất role
- [ ] `/tag create` → `/tag show` (có autocomplete) → `/tag list` → `/tag delete`
- [ ] Đăng tin, 3 người (hoặc 3 acc) react ⭐ → tin lên #starboard, bỏ sao thì count cập nhật
- [ ] `/suggest create ...` → embed trong #góp-ý + nút 👍/👎 → bấm thử đổi số → `/suggest decide <link> accepted`
- [ ] `#tạo-ticket` có panel 🎫 → tạo/đóng ticket bằng `/close`
- [ ] Đăng link `discord.gg/...` → tin bị xóa + log vào #log-bot
- [ ] `/warn @user lý do` → trả lời ephemeral + log vào #log-bot
- [ ] Sửa/xóa tin nhắn → hiện trong #log-bot

## Cấu trúc module

```
src/
├── index.js        # core: load module, đăng ký lệnh, dispatch
├── config.js       # đọc config.json + DEFAULTS
├── core/log.js     # sendLog → #log-bot
└── modules/
    ├── welcome.js  ├── verify.js     ├── ticket.js
    ├── logging.js  ├── automod.js    ├── moderation.js
    ├── reactionroles.js ├── tags.js   ├── starboard.js
    └── suggestions.js
```

Module tự khai báo `{ name, commands[], events[], init(), handleInteraction() }`.
Lỗi 1 module bị bắt riêng — không kéo sập cả bot.
Thêm module mới: tạo file trong `src/modules/`, thêm đường dẫn vào `MODULE_PATHS` trong `index.js`.

## ⚠️ Quan trọng

- **Privileged intents:** thiếu `MESSAGE CONTENT INTENT` → bot login bị kick (4016).
  Thiếu `SERVER MEMBERS INTENT` → welcome/auto-role/logging member không chạy.
- **Role hierarchy:** role Guardian phải **TRÊN** 🌱 Thành viên mới, 🛡️ Admin
  (lệnh mod cũng check: không xử lý user có role bằng/cao hơn bot).
- Quyền bot trong channel: nếu channel có @everyone DENY View, cần overwrite Allow riêng cho bot.
- `GUILD_ID` trong `.env` chỉ đọc lúc start — đổi server thì sửa `.env` rồi chạy lại.
- Warn lưu local tại `src/data/warns.json` (đã gitignore) — mất khi đổi máy.
