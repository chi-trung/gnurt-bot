// Fix tên kênh bị mất dấu — chuẩn hóa NFC trước khi gửi (tránh shell làm hỏng Unicode)
const BASE = 'http://localhost:8085/mcp';
const GUILD = '1554742286598803526';

const RENAMES = [
  ['1554748480176783372', 'âm-nhạc'],
  ['1554748497020977254', 'thử-thách'],
  ['1554748506231668747', 'thảo-luận'],
];

const HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};
async function rpc(body, sid) {
  const h = { ...HEADERS };
  if (sid) h['Mcp-Session-Id'] = sid;
  const res = await fetch(BASE, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const sidNew = res.headers.get('mcp-session-id') || sid;
  const text = await res.text();
  let data = text;
  const line = text.split('\n').find((l) => l.startsWith('data:'));
  if (line) data = line.slice(5).trim();
  let json = data;
  try {
    json = JSON.parse(data);
  } catch {}
  return { json, sid: sidNew };
}

const init = await rpc({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'fix-names', version: '1.0' },
  },
});
await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid);

for (const [channelId, rawName] of RENAMES) {
  const name = rawName.normalize('NFC');
  const r = await rpc(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'edit_text_channel',
        arguments: { guildId: GUILD, channelId, name },
      },
    },
    init.sid
  );
  const out = r.json?.result?.content?.[0]?.text ?? JSON.stringify(r.json);
  console.log(out);
}

// verify: liệt kê lại toàn bộ kênh text
const v = await rpc(
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_channels', arguments: { guildId: GUILD } } },
  init.sid
);
console.log('=== VERIFY ===');
console.log(v.json?.result?.content?.[0]?.text ?? JSON.stringify(v.json));
