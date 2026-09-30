#!/usr/bin/env bash
# Monitor Guardian khi user test: ticket open/close, welcome, member count, lỗi log.
# v2: poll 10s, tôn trọng HTTP429 (SKIP = không thay đổi), lọc warning deprecated.
cd "$(dirname "$0")/.." || exit 1

TOKEN=$(grep '^DISCORD_TOKEN=' bots/guardian/.env | cut -d= -f2)
GID=1554742286598803526
WELCOME=1554748465232351263
LOG=bots/guardian/guardian.log
ERRLOG=bots/guardian/guardian.err.log

# GET url -> body (nếu 200) hoặc "SKIP" (429/lỗi mạng)
get() {
  local out code
  out=$(curl -s -m 5 -H "Authorization: Bot $TOKEN" -w $'\n%{http_code}' "$1")
  code=${out##*$'\n'}
  if [ "$code" = "200" ]; then printf '%s' "${out%$'\n'*}"; else printf 'SKIP'; fi
}
tickets() {
  local b
  b=$(get "https://discord.com/api/v10/guilds/$GID/channels")
  [ "$b" = "SKIP" ] && { echo "SKIP"; return; }
  echo "$b" | grep -o '"name":"ticket-[^"]*"' | sed 's/"name":"//;s/"$//' | tr '\n' ','
}
members() {
  local b
  b=$(get "https://discord.com/api/v10/guilds/$GID/members?limit=1000")
  [ "$b" = "SKIP" ] && { echo "SKIP"; return; }
  echo "$b" | grep -o '"user":{' | wc -l | tr -d ' '
}
welcome_msg() {
  local b
  b=$(get "https://discord.com/api/v10/channels/$WELCOME/messages?limit=1")
  [ "$b" = "SKIP" ] && { echo "SKIP"; return; }
  echo "$b" | grep -o '"username":"[^"]*"' | head -1 | sed 's/"username":"//;s/"$//'
}

# baseline im lặng lần đầu (chỉ nhận giá trị thật)
prev_t=""; prev_m=""; prev_w=""
while [ -z "$prev_t" ] || [ "$prev_t" = "SKIP" ]; do prev_t=$(tickets); sleep 1; done
while [ -z "$prev_m" ] || [ "$prev_m" = "SKIP" ]; do prev_m=$(members); sleep 1; done
while [ -z "$prev_w" ] || [ "$prev_w" = "SKIP" ]; do prev_w=$(welcome_msg); sleep 1; done
prev_log=$(wc -l < "$LOG" 2>/dev/null || echo 0)
prev_err=$(wc -l < "$ERRLOG" 2>/dev/null || echo 0)
echo "WATCHER_READY v2 members=$prev_m tickets=[$prev_t] last_welcome_author=$prev_w"

while true; do
  t=$(tickets)
  if [ "$t" != "SKIP" ] && [ "$t" != "$prev_t" ]; then
    echo "TICKET_CHANGE trước=[$prev_t] sau=[$t]"
    prev_t=$t
  fi

  m=$(members)
  if [ "$m" != "SKIP" ] && [ "$m" != "$prev_m" ]; then
    echo "MEMBER_COUNT $prev_m -> $m"
    prev_m=$m
  fi

  w=$(welcome_msg)
  if [ "$w" != "SKIP" ] && [ "$w" != "$prev_w" ]; then
    echo "WELCOME_MSG mới nhất từ: $w"
    prev_w=$w
  fi

  # dòng mới trong log — chỉ lỗi thật, lọc warning deprecated
  if [ -f "$LOG" ]; then
    new=$(tail -n +$((prev_log + 1)) "$LOG" 2>/dev/null | grep -E 'Lỗi|Error|error|FATAL' || true)
    [ -n "$new" ] && echo "GUARDIAN_LOG: $new"
    prev_log=$(wc -l < "$LOG")
  fi
  if [ -f "$ERRLOG" ]; then
    new=$(tail -n +$((prev_err + 1)) "$ERRLOG" 2>/dev/null | grep -vE 'Warning:|trace-warnings' | grep -v '^\s*$' || true)
    [ -n "$new" ] && echo "GUARDIAN_ERR: $new"
    prev_err=$(wc -l < "$ERRLOG")
  fi

  sleep 10
done
