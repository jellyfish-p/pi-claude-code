import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { diffCatalogs, loadSnapshot, renderMarkdown } from '../scripts/catalog-diff.mjs'

const manifest = (version = '1.0.0') => ({ claudeCodeVersion: version, platform: 'linux-x64', entry: 'print', requestedTools: null, enabledTools: ['Read'], generatedAt: '2026-11-26T00:00:00.000Z', status: 'complete' })
const tool = { name: 'Read', description: 'old description', input_schema: { type: 'object', properties: { path: { type: 'string', description: 'old path' }, limit: { type: 'integer' }, options: { type: 'object', properties: { mode: { type: 'string' } }, required: ['mode'] } }, required: ['path'] } }

test('catalog diff reports tool, field, nested required, and description changes independently', () => {
  const before = { tools: [tool, { name: 'Removed' }], manifest: manifest() }
  const changed = structuredClone(tool) as any
  changed.description = 'new description'
  changed.input_schema.properties.path.description = 'new path'
  changed.input_schema.properties.limit.type = 'number'
  changed.input_schema.properties.offset = { type: 'integer' }
  delete changed.input_schema.properties.options.properties.mode
  changed.input_schema.properties.options.required = []
  changed.input_schema.required = ['offset']
  const after = { tools: [changed, { name: 'Added' }], manifest: manifest('2.0.0') }
  const report = diffCatalogs(before, after)
  assert.deepEqual(report.addedTools, ['Added'])
  assert.deepEqual(report.removedTools, ['Removed'])
  const result = report.changedTools[0]
  assert.equal(result.name, 'Read')
  assert.deepEqual(result.fields.map((item: any) => [item.path, item.kind]), [['/input_schema/properties/limit/type', 'changed'], ['/input_schema/properties/offset', 'added'], ['/input_schema/properties/options/properties/mode', 'removed']])
  assert.deepEqual(result.required, [{ path: '/input_schema/properties/options/required', added: [], removed: ['mode'] }, { path: '/input_schema/required', added: ['offset'], removed: ['path'] }])
  assert.deepEqual(result.descriptions.map((item: any) => item.path), ['/description', '/input_schema/properties/path/description'])
  assert.deepEqual(report.contextDifferences, [], 'a version difference alone is not a context mismatch')
  const markdown = renderMarkdown(report)
  assert.match(markdown, /Added: Added/)
  assert.match(markdown, /Removed: Removed/)
  assert.match(markdown, /Required at/)
  assert.match(markdown, /new description/)
})

test('catalog diff ignores object key order, required order and tool order', () => {
  const before = { tools: [{ name: 'A', input_schema: { properties: { x: { type: 'string' }, y: { type: 'string' } }, required: ['x', 'y'] } }, { name: 'B' }], manifest: manifest() }
  const after = { tools: [{ name: 'B' }, { input_schema: { required: ['y', 'x'], properties: { y: { type: 'string' }, x: { type: 'string' } } }, name: 'A' }], manifest: manifest() }
  assert.deepEqual(diffCatalogs(before, after).changedTools, [])
})

test('schema keywords used as property names and nested union schemas are compared correctly', () => {
  const before = { tools: [{ name: 'Example', input_schema: { type: 'object', properties: { required: { type: 'string' }, description: { type: 'string', description: 'field docs' }, properties: { type: 'object', properties: { required: { type: 'boolean' } }, required: ['required'] }, choice: { anyOf: [{ type: 'object', properties: { name: { type: 'string', description: 'old' } }, required: ['name'] }, { type: 'null' }] } } } }], manifest: null }
  const after = structuredClone(before) as any
  after.tools[0].input_schema.properties.required.type = 'integer'
  after.tools[0].input_schema.properties.description.type = 'number'
  after.tools[0].input_schema.properties.properties.required = []
  after.tools[0].input_schema.properties.choice.anyOf[0].properties.name.description = 'new'
  after.tools[0].input_schema.properties.choice.anyOf[0].required = []
  const change = diffCatalogs(before, after).changedTools[0]
  assert.deepEqual(change.fields.map((field: any) => field.path), ['/input_schema/properties/description/type', '/input_schema/properties/required/type'])
  assert.deepEqual(change.descriptions.map((field: any) => field.path), ['/input_schema/properties/choice/anyOf/0/properties/name/description'])
  assert.deepEqual(change.required.map((field: any) => field.path), ['/input_schema/properties/choice/anyOf/0/required', '/input_schema/properties/properties/required'])
})

test('catalog diff flags platform, entry, requested-tool and missing-manifest ambiguity', () => {
  const before = { tools: [tool], manifest: manifest() }
  const after = { tools: [tool], manifest: { ...manifest('2.0.0'), platform: 'win32-x64', entry: 'interactive', requestedTools: ['Read'], status: 'failed' } }
  const report = diffCatalogs(before, after)
  assert.deepEqual(report.contextDifferences.map((change: any) => change.field), ['platform', 'entry', 'requestedTools'])
  assert.match(report.warnings.join(' '), /cannot be attributed/)
  assert.match(report.warnings.join(' '), /incomplete/)
  assert.match(diffCatalogs({ tools: [tool], manifest: null }, before).warnings[0], /legacy/)
})

test('raw, distilled and legacy inputs work through the CLI without network or binaries', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-claude-diff-test-'))
  const raw = path.join(directory, 'raw')
  const docs = path.join(directory, 'docs/data')
  fs.mkdirSync(path.join(raw, 'requests/toolsearch'), { recursive: true })
  fs.mkdirSync(docs, { recursive: true })
  fs.writeFileSync(path.join(raw, 'requests/toolsearch/001.json'), JSON.stringify({ tools: [{ name: 'Read', defer_loading: true }] }))
  fs.writeFileSync(path.join(raw, 'requests/toolsearch/002.json'), JSON.stringify({ tools: [tool] }))
  fs.writeFileSync(path.join(raw, 'manifest.json'), JSON.stringify(manifest()))
  fs.writeFileSync(path.join(docs, 'tools.json'), JSON.stringify([tool, { name: 'Glob' }]))
  fs.writeFileSync(path.join(docs, 'manifest.json'), JSON.stringify(manifest('2.0.0')))
  try {
    assert.deepEqual(loadSnapshot(raw).tools, [tool])
    assert.equal(loadSnapshot(path.dirname(docs)).manifest.claudeCodeVersion, '2.0.0')
    const script = fileURLToPath(new URL('../scripts/catalog-diff.mjs', import.meta.url))
    const output = path.join(directory, 'report.json')
    const result = spawnSync(process.execPath, [script, raw, docs, '--format', 'json', '--out', output], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')).addedTools, ['Glob'])
    fs.rmSync(path.join(docs, 'manifest.json'))
    assert.equal(loadSnapshot(path.join(docs, 'tools.json')).manifest, null)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
