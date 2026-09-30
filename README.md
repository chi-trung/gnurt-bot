# Discord Bot Workspace

Nơi chứa tất cả các Discord bot — **mỗi bot nằm trong 1 folder riêng**.

## Cấu trúc

```
bot-discord/
├── README.md
├── .gitignore
├── .env.example          # mẫu env dùng chung (KHÔNG commit .env thật)
└── bots/
    ├── <ten-bot-1>/      # mỗi bot 1 folder riêng, tự chứa:
    │   ├── src/
    │   ├── package.json  # hoặc requirements.txt / ...
    │   └── README.md
    └── <ten-bot-2>/
```

**Quy tắc:**
- Mỗi bot có folder riêng, không trộn code giữa các bot.
- Mỗi bot có `.env` riêng chứa token của bot đó.
- Token bot KHÔNG BAO GIỜ commit lên git.
- Repo này có thể là git repo chung — cẩn thận trước khi push.

## Chuẩn bị chung (làm 1 lần)

1. Tài khoản Discord.
2. Vào [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
3. Tab **Bot** → tạo bot → **Reset Token** → lưu token (giữ bí mật).
4. Bật **Privileged Intents** (tuỳ bot cần):
   - `Presence Intent`
   - `Server Members Intent`
   - `Message Content Intent` (cần nếu bot đọc nội dung tin nhắn)
5. Tab **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`, ...
   - Mở URL vừa generate ra → mời bot vào server test.
6. Cài runtime:
   - Node.js ( LTS ) nếu dùng JS, hoặc Python 3.11+ nếu dùng Python.

## Danh sách bot

| Bot | Folder | Trạng thái |
|-----|--------|------------|
| ... | ... | planned / done |
