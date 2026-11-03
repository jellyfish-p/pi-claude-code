#!/usr/bin/env node
// Turns the raw mock-API captures in data/raw/ into the distilled files that
// scripts/build-docs.mjs consumes (docs/data/ + docs/skills/).
// Usage: node scripts/collect.mjs
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const RAW = path.join(ROOT, 'data', 'raw')
const REQ = path.join(RAW, 'requests')
const DATA = path.join(ROOT, 'docs', 'data')
const SKILLS = path.join(ROOT, 'docs', 'skills')

fs.mkdirSync(path.join(DATA, 'agents'), { recursive: true })
fs.mkdirSync(SKILLS, { recursive: true })

const NL = String.fromCharCode(10)
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const read = (p) => fs.readFileSync(p, 'utf8')
const write = (p, body) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  console.log('  ' + path.relative(ROOT, p) + '  (' + body.length + ' chars)')
}
const list = (dir) => fs.readdirSync(path.join(REQ, dir)).filter((f) => f.endsWith('.json')).sort()
const load = (dir, f) => readJSON(path.join(REQ, dir, f))

const textBlocks = (j) => j.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === 'text').map((c) => c.text)
const sysLen = (j) => (j.system || []).reduce((a, s) => a + (s.text || '').length, 0)

/* ---------------------------------------------------------------- tools + system */
console.log('tools / system prompt')
{
  const dir = 'toolsearch'
  const files = list(dir)
  const reqs = files.map((f) => ({ f, j: load(dir, f) }))
  const plain = reqs.find((r) => (r.j.tools || []).length <= 15)
  const full = reqs.reduce((a, b) => ((b.j.tools || []).length > (a.j.tools || []).length ? b : a))

  write(path.join(DATA, 'system-prompt.json'), JSON.stringify(plain.j.system, null, 2) + '\n')
  write(path.join(DATA, 'tools.json'), JSON.stringify(full.j.tools, null, 2) + '\n')
  write(path.join(DATA, 'system-prompt.txt'), plain.j.system.map((b) => b.text).join('\n\n<<<BLOCK>>>\n\n') + '\n')

  const env = textBlocks(plain.j).sort((a, b) => b.length - a.length)[0] || ''
  write(path.join(DATA, 'environment-block.md'), env + '\n')

  const envelope = Object.fromEntries(Object.entries(plain.j).filter(([k]) => !['messages', 'system', 'tools'].includes(k)))
  write(path.join(DATA, 'request-envelope.json'), JSON.stringify(envelope, null, 2) + '\n')

  const planFile = list('plan-mode')[0]
  const plan = load('plan-mode', planFile)
  write(path.join(DATA, 'request-envelope.plan-mode.json'), JSON.stringify(
    Object.fromEntries(Object.entries(plan).filter(([k]) => !['messages', 'system', 'tools'].includes(k))), null, 2) + '\n')
}

/* ---------------------------------------------------------------- subagents */
console.log('subagents')
for (const dir of fs.readdirSync(REQ).filter((d) => d.startsWith('agent-'))) {
  const type = dir.slice('agent-'.length)
  const files = list(dir)
  const first = load(dir, files[0])
  const parentLen = sysLen(first)
  for (const f of files.slice(1)) {
    const j = load(dir, f)
    if (sysLen(j) === parentLen) continue
    const prompt = (j.system || []).map((s) => s.text || '').join('\n\n---\n\n')
    const tools = (j.tools || []).map((t) => t.name).join(', ')
    write(path.join(DATA, 'agents', type + '.md'), prompt.trimEnd() + '\n\n<!-- tools: ' + tools + ' -->\n')
    break
  }
}

/* ---------------------------------------------------------------- skills */
console.log('skills')
// For each skill, keep the LONGEST body across all runs: the same skill renders
// differently depending on repo state (e.g. security-review runs `git diff origin/HEAD...`).
const best = new Map()
for (const dir of fs.readdirSync(REQ).filter((d) => /^(sd-)?skill/.test(d))) {
  const name = dir.replace(/^(sd-)?skill-?\d*-?/, '')
  let body = null
  for (const f of list(dir)) {
    const j = load(dir, f)
    for (let i = 0; i < j.messages.length; i++) {
      const c = Array.isArray(j.messages[i].content) ? j.messages[i].content : []
      if (!c.some((b) => b.type === 'tool_use' && b.name === 'Skill')) continue
      const next = Array.isArray(j.messages[i + 1]?.content) ? j.messages[i + 1].content : []
      const tb = next.filter((b) => b.type === 'text' && b.text && b.text.length > 200).map((b) => b.text)
      if (tb.length) body = tb.join(NL + NL)
    }
  }
  if (!body) continue
  if (!best.has(name) || best.get(name).length < body.length) best.set(name, body)
}
for (const [name, body] of [...best.entries()].sort()) {
  write(path.join(SKILLS, name + '.md'), body.replace(new RegExp(NL + '*$'), NL))
}

/* ---------------------------------------------------------------- extras */
console.log('extras')
write(path.join(DATA, 'init.json'), read(path.join(RAW, 'init.json')).trim() + '\n')
write(path.join(DATA, 'gated-todowrite.md'), read(path.join(RAW, 'gated-todowrite.md')))
console.log('\ndone')
