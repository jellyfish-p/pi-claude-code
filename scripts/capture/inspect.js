import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_RAW, parseArgs } from './common.mjs'
const args = parseArgs(process.argv.slice(2), { values: ['raw'], flags: ['help'] })
if (args.help) console.log('Usage: node scripts/capture/inspect.js [--raw data/raw]')
else {
  if (args._.length) throw new Error('Unexpected positional argument')
  const requests = path.join(path.resolve(args.raw || DEFAULT_RAW), 'requests')
  for (const run of fs.readdirSync(requests).filter((name) => fs.statSync(path.join(requests, name)).isDirectory()).sort()) {
    console.log(`\n### ${run}`)
    for (const file of fs.readdirSync(path.join(requests, run)).filter((name) => name.endsWith('.json')).sort()) {
      const request = JSON.parse(fs.readFileSync(path.join(requests, run, file), 'utf8'))
      const system = (request.system || []).map((block) => (block.text || '').length)
      const last = request.messages?.at(-1)
      const types = Array.isArray(last?.content) ? last.content.map((block) => block.type + (block.name ? '/' + block.name : '') + (block.tool_use_id ? '/res' : '')).join(',') : 'str'
      console.log(`  ${file} tools=${(request.tools || []).length} sys=${JSON.stringify(system)} last=${types}`)
    }
  }
}
