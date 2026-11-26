#!/usr/bin/env node
// Turns the raw mock-API captures in data/raw/ into the distilled files that
// scripts/build-docs.mjs consumes (docs/data/ + docs/skills/).
// Usage: node scripts/collect.mjs
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { parseArgs, sha256 } from './capture/common.mjs'
import { mergeRawTools } from './capture/snapshot.mjs'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2), { values: ['raw', 'docs'], flags: ['help'] })
if (args.help) { console.log('Usage: node scripts/collect.mjs [--raw data/raw] [--docs docs]'); process.exit(0) }
if (args._.length) throw new Error('Unexpected positional argument')
const RAW = path.resolve(args.raw || path.join(ROOT, 'data', 'raw'))
const REQ = path.join(RAW, 'requests')
const DOCS = path.resolve(args.docs || path.join(ROOT, 'docs'))
const DATA = path.join(DOCS, 'data')
const SKILLS = path.join(DOCS, 'skills')
const OWNERSHIP = path.join(DATA, '.collect-manifest.json')
if (!fs.existsSync(REQ)) throw new Error(`No request captures in ${REQ}`)

fs.mkdirSync(path.join(DATA, 'agents'), { recursive: true })
fs.mkdirSync(SKILLS, { recursive: true })

const NL = String.fromCharCode(10)
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const read = (p) => fs.readFileSync(p, 'utf8')
const normalizeLF = (body) => body.replace(/\r\n?/g, '\n')
const textDigest = (body) => sha256(normalizeLF(body))
const outputs = new Map()
const write = (p, body) => {
  outputs.set(path.relative(DOCS, p).split(path.sep).join('/'), normalizeLF(body))
}
const directories = fs.readdirSync(REQ).filter((dir) => fs.statSync(path.join(REQ, dir)).isDirectory()).sort()
const list = (dir) => fs.existsSync(path.join(REQ, dir)) ? fs.readdirSync(path.join(REQ, dir)).filter((f) => f.endsWith('.json')).sort() : []
const load = (dir, f) => readJSON(path.join(REQ, dir, f))

const textBlocks = (j) => (j.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === 'text').map((c) => c.text)
const sysLen = (j) => (j.system || []).reduce((a, s) => a + (s.text || '').length, 0)

/* ---------------------------------------------------------------- tools + system */
console.log('tools / system prompt')
{
  const dir = list('toolsearch').length ? 'toolsearch' : directories.find((dir) => !/^(agent-|(?:sd-)?skill)/.test(dir) && list(dir).length) || directories.find((dir) => list(dir).length)
  if (!dir) throw new Error(`No JSON requests in ${REQ}`)
  const files = list(dir)
  const reqs = files.map((f) => ({ f, j: load(dir, f) }))
  const plain = reqs.find((r) => (r.j.tools || []).length <= 15) || reqs.reduce((a, b) => ((b.j.tools || []).length < (a.j.tools || []).length ? b : a))

  write(path.join(DATA, 'system-prompt.json'), JSON.stringify(plain.j.system || [], null, 2) + '\n')
  write(path.join(DATA, 'tools.json'), JSON.stringify(mergeRawTools(REQ), null, 2) + '\n')
  write(path.join(DATA, 'system-prompt.txt'), (plain.j.system || []).map((b) => b.text || '').join('\n\n<<<BLOCK>>>\n\n') + '\n')

  const env = textBlocks(plain.j).sort((a, b) => b.length - a.length)[0] || ''
  write(path.join(DATA, 'environment-block.md'), env + '\n')

  const envelope = Object.fromEntries(Object.entries(plain.j).filter(([k]) => !['messages', 'system', 'tools'].includes(k)))
  write(path.join(DATA, 'request-envelope.json'), JSON.stringify(envelope, null, 2) + '\n')

  const planFile = list('plan-mode')[0]
  if (planFile) {
    const plan = load('plan-mode', planFile)
    write(path.join(DATA, 'request-envelope.plan-mode.json'), JSON.stringify(
    Object.fromEntries(Object.entries(plan).filter(([k]) => !['messages', 'system', 'tools'].includes(k))), null, 2) + '\n')
  }
}

/* ---------------------------------------------------------------- subagents */
console.log('subagents')
for (const dir of directories.filter((d) => d.startsWith('agent-'))) {
  const type = dir.slice('agent-'.length)
  const files = list(dir)
  if (!files.length) continue
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
for (const dir of directories.filter((d) => /^(sd-)?skill/.test(d))) {
  const name = dir.replace(/^(sd-)?skill-?\d*-?/, '')
  let body = null
  for (const f of list(dir)) {
    const j = load(dir, f)
    for (let i = 0; i < (j.messages || []).length; i++) {
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
for (const name of ['init.json', 'gated-todowrite.md', 'manifest.json']) {
  if (fs.existsSync(path.join(RAW, name))) write(path.join(DATA, name), read(path.join(RAW, name)).trimEnd() + '\n')
}

// Only known data products and files listed by a previous collect are managed.
// Untracked prose in skills/, agents/, or the docs root belongs to the user.
const fixed = ['system-prompt.json', 'system-prompt.txt', 'tools.json', 'environment-block.md', 'request-envelope.json', 'request-envelope.plan-mode.json', 'init.json', 'gated-todowrite.md', 'manifest.json'].map((name) => 'data/' + name)
const allowed = (name) => fixed.includes(name) || /^(?:data\/agents|skills)\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.md$/.test(name)
const previous = fs.existsSync(OWNERSHIP) ? readJSON(OWNERSHIP) : { schemaVersion: 1, files: {} }
if (previous.schemaVersion !== 1 || !previous.files || Array.isArray(previous.files) || typeof previous.files !== 'object') throw new Error('Invalid collect ownership manifest')
if (previous.hashFormat !== undefined && previous.hashFormat !== 'sha256-lf') throw new Error('Unknown collect ownership hash format')
for (const [name, digest] of Object.entries(previous.files)) {
  if (!allowed(name) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid path or digest in collect ownership manifest')
  const file = path.resolve(DOCS, name)
  const relative = path.relative(DOCS, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Collect ownership path escapes the docs directory')
  if (fs.existsSync(file)) {
    const body = read(file)
    const matches = textDigest(body) === digest || (previous.hashFormat === undefined && (sha256(body) === digest || sha256(normalizeLF(body).replace(/\n/g, '\r\n')) === digest))
    if (!matches) throw new Error(`Previously generated file was edited: ${file}. Move it aside before collecting again.`)
  }
}
for (const [name, body] of outputs) {
  if (!allowed(name)) throw new Error(`Invalid generated output path: ${name}`)
  const file = path.join(DOCS, name)
  if (!fixed.includes(name) && !Object.hasOwn(previous.files, name) && fs.existsSync(file) && normalizeLF(read(file)) !== body) throw new Error(`Untracked document would be overwritten: ${file}. Choose a new --docs directory or move the document aside.`)
}
for (const [name, body] of outputs) {
  const file = path.join(DOCS, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body)
  console.log('  ' + path.relative(ROOT, file) + '  (' + body.length + ' chars)')
}
for (const name of new Set([...fixed, ...Object.keys(previous.files)])) {
  if (outputs.has(name)) continue
  const file = path.resolve(DOCS, name)
  if (fs.existsSync(file)) { fs.unlinkSync(file); console.log('  removed ' + path.relative(ROOT, file)) }
}
fs.writeFileSync(OWNERSHIP, JSON.stringify({ schemaVersion: 1, hashFormat: 'sha256-lf', files: Object.fromEntries([...outputs].map(([name, body]) => [name, textDigest(body)])) }, null, 2) + '\n')
console.log('\ndone')
