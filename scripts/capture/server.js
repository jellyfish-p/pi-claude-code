const http = require('http')
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, 'requests')
fs.mkdirSync(OUT, { recursive: true })
let n = 0

function load() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'scenario.json'), 'utf8')) }
  catch { return { run: 'default', steps: [{ blocks: [{ type: 'text', text: 'ok' }] }] } }
}

function sse(res, s, id) {
  const blocks = s.blocks || [{ type: 'text', text: 'ok' }]
  const stopReason = s.stop_reason || (blocks.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn')
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`)
  ev('message_start', { type: 'message_start', message: { id: 'msg_' + id, type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })
  blocks.forEach((b, i) => {
    ev('content_block_start', { type: 'content_block_start', index: i, content_block: b.type === 'tool_use' ? { type: 'tool_use', id: b.id || 'toolu_' + id + '_' + i, name: b.name, input: {} } : b })
    if (b.type === 'text' && b.text) ev('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } })
    if (b.type === 'tool_use') ev('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input || {}) } })
    ev('content_block_stop', { type: 'content_block_stop', index: i })
  })
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } })
  ev('message_stop', { type: 'message_stop' })
  res.end()
}

http.createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    const sc = load()
    const runDir = path.join(OUT, sc.run)
    fs.mkdirSync(runDir, { recursive: true })
    const idx = (fs.readdirSync(runDir).filter(f=>f.endsWith('.json')).length) + 1
    let parsed = null
    try { parsed = JSON.parse(body) } catch {}
    const file = path.join(runDir, `${String(idx).padStart(3, '0')}${req.url.replace(/[^a-z0-9]+/gi, '_')}.json`)
    fs.writeFileSync(file, parsed ? JSON.stringify(parsed, null, 2) : body)
    console.error(`[${idx}] run=${sc.run} ${req.method} ${req.url} -> ${path.basename(file)} (${body.length}b)`)
    const step = (sc.steps || [])[Math.min(idx - 1, (sc.steps || []).length - 1)] || {}
    sse(res, step, idx)
  })
}).listen(8790, '127.0.0.1', () => console.error('mock server on 8790'))
