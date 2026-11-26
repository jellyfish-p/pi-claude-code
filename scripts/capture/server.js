import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_RAW, ROOT, isMain, parseArgs, readJSON, validateScenario } from './common.mjs'

const fallback = { run: 'default', steps: [{ blocks: [{ type: 'text', text: 'ok' }] }] }

function sse(res, step, id, model) {
  const blocks = step.blocks || [{ type: 'text', text: 'ok' }]
  const stopReason = step.stop_reason || (blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn')
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
  ev('message_start', { type: 'message_start', message: { id: 'msg_' + id, type: 'message', role: 'assistant', model: model || 'claude-mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } })
  blocks.forEach((block, index) => {
    const content = block.type === 'tool_use'
      ? { type: 'tool_use', id: block.id || `toolu_${id}_${index}`, name: block.name, input: {} }
      : block.type === 'text' ? { type: 'text', text: '' } : block
    ev('content_block_start', { type: 'content_block_start', index, content_block: content })
    if (block.type === 'text' && block.text) ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } })
    if (block.type === 'tool_use') ev('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input || {}) } })
    ev('content_block_stop', { type: 'content_block_stop', index })
  })
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } })
  ev('message_stop', { type: 'message_stop' })
  res.end()
}

export async function startCaptureServer({ out = DEFAULT_RAW, scenarioFile, getScenario, port = 0, logger = console.error } = {}) {
  const scenarioPath = scenarioFile || path.join(ROOT, 'scripts/capture/scenario.json')
  const counts = new Map()
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (req.method === 'GET' && pathname === '/health') { res.end('ok'); return }
    if (req.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(pathname)) { res.writeHead(404).end(); return }
    try {
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 16 * 1024 * 1024) { res.writeHead(413).end('Request too large'); return }
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (pathname.endsWith('/count_tokens')) { res.setHeader('content-type', 'application/json'); res.end('{"input_tokens":10}'); return }
      const scenario = validateScenario(getScenario ? getScenario() : fs.existsSync(scenarioPath) ? readJSON(scenarioPath) : fallback)
      const directory = path.join(out, 'requests', scenario.run)
      fs.mkdirSync(directory, { recursive: true })
      const prior = fs.readdirSync(directory).reduce((n, file) => Math.max(n, Number(file.match(/^(\d+).*\.json$/)?.[1] || 0)), 0)
      const index = prior + 1
      const file = `${String(index).padStart(3, '0')}${req.url.replace(/[^a-z0-9]+/gi, '_')}.json`
      fs.writeFileSync(path.join(directory, file), JSON.stringify(body, null, 2) + '\n', { flag: 'wx' })
      counts.set(scenario.run, (counts.get(scenario.run) || 0) + 1)
      logger(`[${index}] run=${scenario.run} ${req.method} ${pathname} -> ${file} (${size}b)`)
      sse(res, scenario.steps[Math.min(index - 1, scenario.steps.length - 1)], index, body.model)
    } catch (error) {
      logger(`mock request failed: ${error.message}`)
      if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: error.message } }))
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return {
    server, counts, url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeIdleConnections() }),
  }
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2), { values: ['out', 'scenario', 'port'], flags: ['help'] })
    if (args.help) console.log('Usage: node scripts/capture/server.js [--out data/raw] [--scenario scenario.json] [--port 8790]')
    else {
      if (args._.length) throw new Error('Unexpected positional argument')
      const port = Number(args.port ?? 8790)
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port')
      const mock = await startCaptureServer({ out: path.resolve(args.out || DEFAULT_RAW), scenarioFile: args.scenario && path.resolve(args.scenario), port })
      console.error(`mock server on ${mock.url}; output ${path.resolve(args.out || DEFAULT_RAW)}/requests`)
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { mock.server.closeAllConnections(); mock.close().then(() => process.exit(0)) })
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
