// Helper gọi tool trên discord-mcp local (http://localhost:8085/mcp)
// Dùng:
//   node scripts/mcp.mjs list                 → liệt kê tên tools
//   node scripts/mcp.mjs schema <toolName>    → xem input schema của tool
//   node scripts/mcp.mjs call <toolName> '<json args>'
const BASE = 'http://localhost:8085/mcp';
const [, , cmd, a1, a2] = process.argv;

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
  return { json, sid: sidNew, status: res.status };
}

const init = await rpc({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'setup-helper', version: '1.0' },
  },
});
if (!init.sid) {
  console.error('INIT FAIL', init.status, JSON.stringify(init.json));
  process.exit(1);
}
await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sid);

if (cmd === 'list') {
  const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.sid);
  const tools = r.json?.result?.tools ?? [];
  console.log(tools.map((t) => t.name).join('\n'));
} else if (cmd === 'schema') {
  const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.sid);
  const tools = r.json?.result?.tools ?? [];
  const t = tools.find((x) => x.name === a1);
  console.log(t ? JSON.stringify(t.inputSchema, null, 2) : `NOT FOUND: ${a1}\n${tools.map((x) => x.name).join(', ')}`);
} else if (cmd === 'call') {
  const args = a2 ? JSON.parse(a2) : {};
  const r = await rpc(
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: a1, arguments: args } },
    init.sid
  );
  const res = r.json?.result;
  if (res?.isError) {
    console.error('TOOL ERROR:', JSON.stringify(res.content));
    process.exit(1);
  }
  const text = res?.content?.map((c) => c.text).join('\n') ?? JSON.stringify(r.json);
  console.log(text);
} else {
  console.error('Usage: list | schema <tool> | call <tool> <jsonArgs>');
  process.exit(1);
}
