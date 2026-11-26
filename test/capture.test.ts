import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { capture, isolatedEnvironment } from '../scripts/capture/capture.mjs'
import { startCaptureServer } from '../scripts/capture/server.js'
import { scenariosFor } from '../scripts/capture/scenarios.mjs'
import { diffCatalogs, loadSnapshot } from '../scripts/catalog-diff.mjs'
import { sha256 } from '../scripts/capture/common.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pi-claude-capture-test-'))
const text = (value: string) => ({ blocks: [{ type: 'text', text: value }] })
const fixtureRequest = { model: 'claude-test', system: [{ type: 'text', text: 'cc_version=9.8.7.test' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'environment fixture' }] }], tools: [{ name: 'Read', description: 'Read fixture', input_schema: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } }] }
const collect = (raw: string, docs: string) => spawnSync(process.execPath, [path.join(root, 'scripts/collect.mjs'), '--raw', raw, '--docs', docs], { encoding: 'utf8' })
const save = (file: string, value: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)) }

test('ESM mock captures only message bodies in the shared raw layout and scopes steps per run', async () => {
  const directory = temporary()
  let scenario = { run: 'first', steps: [text('first response'), text('next response')] }
  const mock = await startCaptureServer({ out: directory, getScenario: () => scenario, logger: () => {} })
  const post = (endpoint = '/v1/messages?beta=true') => fetch(mock.url + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'header-secret-must-not-be-saved' }, body: JSON.stringify(fixtureRequest) })
  try {
    assert.equal((await fetch(mock.url + '/not-a-message')).status, 404)
    assert.deepEqual(await (await post('/v1/messages/count_tokens')).json(), { input_tokens: 10 })
    const first = await (await post()).text()
    assert.match(first, /first response/)
    assert.equal((first.match(/first response/g) || []).length, 1, 'SSE text is emitted only in its delta')
    assert.match(await (await post()).text(), /next response/)
    scenario = { run: 'second', steps: [text('second first response')] }
    assert.match(await (await post()).text(), /second first response/)
    const files = fs.readdirSync(path.join(directory, 'requests/first'))
    assert.equal(files.length, 2)
    assert.match(files[0], /^001_/)
    const saved = fs.readFileSync(path.join(directory, 'requests/first', files[0]), 'utf8')
    assert.deepEqual(JSON.parse(saved), fixtureRequest)
    assert.doesNotMatch(saved, /header-secret/)
    scenario = { run: '../escape', steps: [text('bad')] }
    assert.equal((await post()).status, 400)
    assert.equal(fs.existsSync(path.join(directory, 'escape')), false)
    assert.equal(mock.counts.get('first'), 2)
    assert.equal(mock.counts.get('second'), 1)
  } finally { mock.server.closeAllConnections(); await mock.close(); fs.rmSync(directory, { recursive: true, force: true }) }
})

const fakeChild = `
import assert from 'node:assert/strict';
if (process.argv.includes('--version')) { console.log('9.8.7 (fake Claude Code)'); process.exit(0); }
assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-ant-api03-capture-dummy');
assert.equal(process.env.ANTHROPIC_AUTH_TOKEN, undefined);
assert.equal(process.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
assert.equal(process.env.HTTP_PROXY, undefined);
assert.equal(process.env.NODE_OPTIONS, undefined);
assert.ok(process.env.HOME.includes('pi-claude-capture-'));
const args = process.argv.slice(2);
const prompt = args[args.indexOf('--print') + 1];
if (prompt === 'hang') { setInterval(() => {}, 1000); }
else {
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.ok(args.includes('--strict-mcp-config'));
  console.log(JSON.stringify({ type: 'system', subtype: 'init', tools: ['Read'], agents: [], skills: [], slash_commands: [] }));
  const fixture = ${JSON.stringify(fixtureRequest)};
  const count = args.includes('--permission-mode') ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const tools = i ? [...fixture.tools, { name: 'Grep', description: 'Grep fixture', input_schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } }] : fixture.tools;
    const response = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages?beta=true', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...fixture, tools }) });
    assert.equal(response.status, 200);
    await response.text();
  }
}
`

test('capture runs a fake child through HTTP, writes provenance, then collects and builds a separate snapshot', async () => {
  const directory = temporary()
  const bin = path.join(directory, 'fake-client.mjs')
  fs.writeFileSync(bin, fakeChild)
  const out = path.join(directory, 'snapshot')
  try {
    const cli = spawnSync(process.execPath, [path.join(root, 'scripts/capture/capture.mjs'), '--out', out, '--bin', path.relative(root, process.execPath), '--bin-arg', path.relative(root, bin), '--tools', 'Read', '--platform', 'test-platform', '--work', path.join(directory, 'work')], { cwd: root, encoding: 'utf8', timeout: 15000 })
    assert.equal(cli.status, 0, cli.stderr)
    assert.match(cli.stdout, /toolsearch: 2 request/)
    const result = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'))
    assert.equal(result.claudeCodeVersion, '9.8.7')
    assert.equal(result.versionSource, 'binary --version')
    assert.equal(result.platform, 'test-platform')
    assert.equal(result.entry, 'print')
    assert.equal(result.status, 'complete')
    assert.deepEqual(result.requestedTools, ['Read'])
    assert.deepEqual(result.enabledTools, ['Grep', 'Read'])
    assert.equal(result.requests.length, 3)
    assert.match(result.source.executableSha256, /^[0-9a-f]{64}$/)
    assert.match(result.source.requestsSha256, /^[0-9a-f]{64}$/)
    assert.match(result.source.scenariosSha256, /^[0-9a-f]{64}$/)
    assert.ok(result.startedAt <= result.generatedAt)
    assert.deepEqual(fs.readdirSync(path.join(directory, 'work')), [], 'isolated homes are removed')
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')), result)
    assert.deepEqual(result.scenarios.map((item: any) => item.requestCount), [2, 1])
    assert.ok(fs.existsSync(path.join(out, 'inits/toolsearch.json')))
    const docs = path.join(directory, 'docs')
    for (const [script, args] of [['collect.mjs', ['--raw', out, '--docs', docs]], ['build-docs.mjs', ['--docs', docs]]] as const) {
      const command = spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8' })
      assert.equal(command.status, 0, command.stderr)
    }
    const tools = JSON.parse(fs.readFileSync(path.join(docs, 'data/tools.json'), 'utf8'))
    assert.deepEqual(tools.map((tool: any) => tool.name), ['Read', 'Grep'])
    assert.match(fs.readFileSync(path.join(docs, '03-tool-catalog.md'), 'utf8'), /9\.8\.7.*|test-platform/)
    assert.match(fs.readFileSync(path.join(docs, '03-tool-catalog.md'), 'utf8'), /test-platform/)
    assert.equal(fs.readFileSync(path.join(docs, 'data/manifest.json'), 'utf8'), fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'))
    await assert.rejects(capture({ out }), /not empty/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('capture environment excludes inherited auth and configuration paths', () => {
  const directory = temporary()
  try {
    const env = isolatedEnvironment(directory, 'http://127.0.0.1:1', { PATH: 'safe-path', HOME: 'real-home', USERPROFILE: 'real-home', ANTHROPIC_AUTH_TOKEN: 'real-token', ANTHROPIC_API_KEY: 'real-key', CLAUDE_CODE_OAUTH_TOKEN: 'real-oauth', NODE_OPTIONS: '--require=secret', HTTP_PROXY: 'secret-proxy', CLAUDE_CONFIG_DIR: 'real-config' })
    const serialized = JSON.stringify(env)
    assert.doesNotMatch(serialized, /real-|secret/)
    assert.equal(env.PATH, 'safe-path')
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-api03-capture-dummy')
    assert.ok(env.CLAUDE_CONFIG_DIR.startsWith(directory))
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('timeouts fail the capture and retain a failed manifest while cleaning isolated state', async () => {
  const directory = temporary()
  fs.writeFileSync(path.join(directory, 'fake.mjs'), fakeChild)
  fs.writeFileSync(path.join(directory, 'scenario.json'), JSON.stringify({ run: 'hang', prompt: 'hang', steps: [text('ok')] }))
  const out = path.join(directory, 'snapshot')
  try {
    await assert.rejects(capture({ out, bin: process.execPath, 'bin-arg': [path.join(directory, 'fake.mjs')], version: 'fake-test', scenario: [path.join(directory, 'scenario.json')], 'timeout-ms': '300', work: path.join(directory, 'work'), logger: () => {} }), /timeout/)
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'))
    assert.equal(manifest.status, 'failed')
    assert.equal(manifest.scenarios[0].timedOut, true)
    assert.deepEqual(fs.readdirSync(path.join(directory, 'work')), [])
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('the existing offline raw data collects without a manifest and preserves its catalog', () => {
  const directory = temporary()
  try {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/collect.mjs'), '--raw', path.join(root, 'data/raw'), '--docs', directory], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'data/tools.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(root, 'docs/data/tools.json'), 'utf8')))
    const docs = spawnSync(process.execPath, [path.join(root, 'scripts/build-docs.mjs'), '--docs', directory], { encoding: 'utf8' })
    assert.equal(docs.status, 0, docs.stderr)
    assert.match(fs.readFileSync(path.join(directory, '03-tool-catalog.md'), 'utf8'), /2\.1\.316/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('collect and raw snapshot loading share the complete multi-run tool union', () => {
  const directory = temporary()
  const raw = path.join(directory, 'raw')
  const docs = path.join(directory, 'docs')
  save(path.join(raw, 'requests/read/001.json'), fixtureRequest)
  save(path.join(raw, 'requests/glob/001.json'), { ...fixtureRequest, tools: [{ name: 'Glob', defer_loading: true }] })
  save(path.join(raw, 'requests/glob/002.json'), { ...fixtureRequest, tools: [{ name: 'Glob', description: 'Find files', input_schema: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } }] })
  try {
    const result = collect(raw, docs)
    assert.equal(result.status, 0, result.stderr)
    const original = loadSnapshot(raw)
    const distilled = loadSnapshot(docs)
    assert.deepEqual(distilled.tools.map((tool: any) => tool.name).sort(), ['Glob', 'Read'])
    assert.deepEqual(distilled.tools, original.tools)
    const report = diffCatalogs(original, distilled)
    assert.deepEqual([report.addedTools, report.removedTools, report.changedTools], [[], [], []])
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

function oldOptionalSnapshot(directory: string) {
  const raw = path.join(directory, 'old')
  save(path.join(raw, 'requests/toolsearch/001.json'), fixtureRequest)
  save(path.join(raw, 'requests/plan-mode/001.json'), { ...fixtureRequest, safeguards: { test: true } })
  save(path.join(raw, 'requests/agent-Explore/001.json'), fixtureRequest)
  save(path.join(raw, 'requests/agent-Explore/002.json'), { ...fixtureRequest, system: [{ type: 'text', text: 'child prompt longer than the parent fixture' }] })
  save(path.join(raw, 'requests/skill-old-skill/001.json'), { ...fixtureRequest, messages: [{ role: 'assistant', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'old-skill' } }] }, { role: 'user', content: [{ type: 'text', text: 'old generated skill body '.repeat(20) }] }] })
  save(path.join(raw, 'manifest.json'), { claudeCodeVersion: 'OLD', status: 'complete' })
  save(path.join(raw, 'init.json'), { tools: ['Read'], agents: [], skills: ['old-skill'], slash_commands: [] })
  save(path.join(raw, 'gated-todowrite.md'), 'old static description')
  return raw
}

test('collect reuse removes stale owned optional products and preserves handwritten documents', () => {
  const directory = temporary()
  const oldRaw = oldOptionalSnapshot(directory)
  const newRaw = path.join(directory, 'new')
  const docs = path.join(directory, 'docs')
  save(path.join(newRaw, 'requests/custom/001.json'), fixtureRequest)
  const handwritten = ['README.md', 'skills/handwritten.md', 'skills/legacy-unknown.md', 'data/agents/handwritten.md']
  for (const name of handwritten) save(path.join(docs, name), 'user content: ' + name)
  try {
    const first = collect(oldRaw, docs)
    assert.equal(first.status, 0, first.stderr)
    const stale = ['data/manifest.json', 'data/init.json', 'data/gated-todowrite.md', 'data/request-envelope.plan-mode.json', 'data/agents/Explore.md', 'skills/old-skill.md']
    for (const name of stale) assert.ok(fs.existsSync(path.join(docs, name)), name)
    const second = collect(newRaw, docs)
    assert.equal(second.status, 0, second.stderr)
    for (const name of stale) assert.equal(fs.existsSync(path.join(docs, name)), false, name)
    for (const name of handwritten) assert.equal(fs.readFileSync(path.join(docs, name), 'utf8'), 'user content: ' + name)
    assert.equal(loadSnapshot(docs).manifest, null)
    const ownership = JSON.parse(fs.readFileSync(path.join(docs, 'data/.collect-manifest.json'), 'utf8'))
    assert.equal(ownership.files['skills/old-skill.md'], undefined)
    assert.ok(ownership.files['data/tools.json'])
    const built = spawnSync(process.execPath, [path.join(root, 'scripts/build-docs.mjs'), '--docs', docs], { encoding: 'utf8' })
    assert.equal(built.status, 0, built.stderr)
    const skills = fs.readFileSync(path.join(docs, '05-skills.md'), 'utf8')
    assert.match(skills, /自带 \*\*0\*\* 个 skill/)
    assert.doesNotMatch(skills, /legacy-unknown|handwritten|old-skill/)
    assert.doesNotMatch(fs.readFileSync(path.join(docs, '04-subagents.md'), 'utf8'), /user content:|## handwritten/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('collect refuses to delete an edited generated document before writing new outputs', () => {
  const directory = temporary()
  const oldRaw = oldOptionalSnapshot(directory)
  const newRaw = path.join(directory, 'new')
  const docs = path.join(directory, 'docs')
  save(path.join(newRaw, 'requests/custom/001.json'), { ...fixtureRequest, tools: [] })
  try {
    const first = collect(oldRaw, docs)
    assert.equal(first.status, 0, first.stderr)
    const oldTools = fs.readFileSync(path.join(docs, 'data/tools.json'), 'utf8')
    save(path.join(docs, 'skills/old-skill.md'), 'manually revised document')
    const result = collect(newRaw, docs)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Previously generated file was edited/)
    assert.equal(fs.readFileSync(path.join(docs, 'skills/old-skill.md'), 'utf8'), 'manually revised document')
    assert.equal(fs.readFileSync(path.join(docs, 'data/tools.json'), 'utf8'), oldTools)
    assert.equal(JSON.parse(fs.readFileSync(path.join(docs, 'data/manifest.json'), 'utf8')).claudeCodeVersion, 'OLD')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('collect migrates a first Windows CRLF checkout without rejecting unchanged agent and skill text', () => {
  const directory = temporary()
  const docs = path.join(directory, 'docs')
  try {
    fs.cpSync(path.join(root, 'docs'), docs, { recursive: true })
    const ownership = path.join(docs, 'data/.collect-manifest.json')
    if (fs.existsSync(ownership)) fs.unlinkSync(ownership)
    for (const child of ['skills', 'data/agents']) {
      const target = path.join(docs, child)
      for (const name of fs.readdirSync(target).filter((name) => name.endsWith('.md'))) {
        const file = path.join(target, name)
        fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'))
      }
    }
    const result = collect(path.join(root, 'data/raw'), docs)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(loadSnapshot(docs).tools, loadSnapshot(path.join(root, 'data/raw')).tools)
    assert.equal(JSON.parse(fs.readFileSync(ownership, 'utf8')).hashFormat, 'sha256-lf')
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('collect ownership ignores newline-only changes and accepts legacy raw CRLF digests', () => {
  const directory = temporary()
  const raw = oldOptionalSnapshot(directory)
  const docs = path.join(directory, 'docs')
  const manifest = path.join(docs, 'data/.collect-manifest.json')
  try {
    const initial = collect(raw, docs)
    assert.equal(initial.status, 0, initial.stderr)
    const original = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    for (const name of Object.keys(original.files)) {
      const file = path.join(docs, name)
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n'))
    }
    const normalized = collect(raw, docs)
    assert.equal(normalized.status, 0, normalized.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(manifest, 'utf8')).files, original.files)
    const legacy = { ...original, files: Object.fromEntries(Object.keys(original.files).map((name) => [name, sha256(fs.readFileSync(path.join(docs, name), 'utf8').replace(/\n/g, '\r\n'))])) }
    delete legacy.hashFormat
    fs.writeFileSync(manifest, JSON.stringify(legacy))
    const migrated = collect(raw, docs)
    assert.equal(migrated.status, 0, migrated.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(manifest, 'utf8')).files, original.files)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('capture cancellation stops a running child and leaves a failed snapshot', async () => {
  const directory = temporary()
  fs.writeFileSync(path.join(directory, 'fake.mjs'), fakeChild)
  fs.writeFileSync(path.join(directory, 'scenario.json'), JSON.stringify({ run: 'cancel', prompt: 'hang', steps: [text('ok')] }))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300)
  try {
    const out = path.join(directory, 'snapshot')
    await assert.rejects(capture({ out, bin: process.execPath, 'bin-arg': [path.join(directory, 'fake.mjs')], version: 'fake-test', scenario: [path.join(directory, 'scenario.json')], work: path.join(directory, 'work'), signal: controller.signal, logger: () => {} }), /cancelled/)
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'))
    assert.equal(manifest.status, 'failed')
    assert.equal(manifest.scenarios[0].cancelled, true)
    assert.deepEqual(fs.readdirSync(path.join(directory, 'work')), [])
  } finally { clearTimeout(timer); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('compatibility profiles retain ordinary agent/skill runs and permission-bypass skill runs', () => {
  assert.equal(scenariosFor('legacy').filter((scenario: any) => scenario.run.startsWith('agent-')).length, 5)
  assert.equal(scenariosFor('legacy').filter((scenario: any) => scenario.run.startsWith('skill-')).length, 12)
  const permissive = scenariosFor('skills-permissive')
  assert.equal(permissive.length, 13)
  assert.ok(permissive.every((scenario: any) => scenario.args?.includes('--dangerously-skip-permissions')))
})
