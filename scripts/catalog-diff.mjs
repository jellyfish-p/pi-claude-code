#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { isMain, parseArgs } from './capture/common.mjs'
import { canonical, loadSnapshot } from './capture/snapshot.mjs'
export { loadSnapshot } from './capture/snapshot.mjs'
const pointer = (value) => value.replace(/~/g, '~0').replace(/\//g, '~1')
const ordered = (values) => [...new Set(values)].sort()

function compareObject(before, after, at, change, role = 'object') {
  if (canonical(before) === canonical(after)) return
  if (role === 'schema-array' && Array.isArray(before) && Array.isArray(after)) {
    for (let index = 0; index < Math.max(before.length, after.length); index++) {
      const next = at + '/' + index
      if (index >= before.length || index >= after.length) change.fields.push({ path: next, kind: index < after.length ? 'added' : 'removed', before: before[index] ?? null, after: after[index] ?? null })
      else compareObject(before[index], after[index], next, change)
    }
    return
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of ordered([...Object.keys(before), ...Object.keys(after)])) {
      const next = at + '/' + pointer(key)
      if (role !== 'schema-map' && key === 'required' && (before[key] === undefined || Array.isArray(before[key])) && (after[key] === undefined || Array.isArray(after[key]))) {
        const left = before[key] || [], right = after[key] || []
        const added = ordered(right.filter((item) => !left.includes(item)))
        const removed = ordered(left.filter((item) => !right.includes(item)))
        if (added.length || removed.length) change.required.push({ path: next, added, removed })
      } else if (role !== 'schema-map' && key === 'description' && (before[key] === undefined || typeof before[key] === 'string') && (after[key] === undefined || typeof after[key] === 'string')) {
        if (before[key] !== after[key]) change.descriptions.push({ path: next, before: before[key] ?? null, after: after[key] ?? null })
      } else if (!(key in before) || !(key in after)) {
        change.fields.push({ path: next, kind: key in after ? 'added' : 'removed', before: before[key] ?? null, after: after[key] ?? null })
      } else {
        const childRole = role === 'schema-map' ? 'object' : ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'].includes(key) ? 'schema-map' : ['anyOf', 'oneOf', 'allOf', 'prefixItems'].includes(key) ? 'schema-array' : 'object'
        compareObject(before[key], after[key], next, change, childRole)
      }
    }
  } else change.fields.push({ path: at, kind: 'changed', before: before ?? null, after: after ?? null })
}

export function diffCatalogs(before, after) {
  const left = new Map(before.tools.map((tool) => [tool.name, tool]))
  const right = new Map(after.tools.map((tool) => [tool.name, tool]))
  const metadata = (snapshot) => snapshot.manifest ? Object.fromEntries(['claudeCodeVersion', 'platform', 'entry', 'requestedTools', 'enabledTools', 'generatedAt', 'status'].map((key) => [key, snapshot.manifest[key] ?? null])) : null
  const report = { before: metadata(before), after: metadata(after), contextDifferences: [], warnings: [], addedTools: [...right.keys()].filter((key) => !left.has(key)).sort(), removedTools: [...left.keys()].filter((key) => !right.has(key)).sort(), changedTools: [] }
  if (!before.manifest || !after.manifest) report.warnings.push('A legacy snapshot has no manifest; version/platform/entry/configuration comparability is unknown.')
  for (const key of ['platform', 'entry', 'requestedTools']) if (before.manifest && after.manifest && canonical(before.manifest[key]) !== canonical(after.manifest[key])) report.contextDifferences.push({ field: key, before: before.manifest[key] ?? null, after: after.manifest[key] ?? null })
  for (const key of ['scenariosSha256', 'extraArgsSha256']) if (before.manifest?.source && after.manifest?.source && canonical(before.manifest.source[key]) !== canonical(after.manifest.source[key])) report.contextDifferences.push({ field: 'source.' + key, before: before.manifest.source[key] ?? null, after: after.manifest.source[key] ?? null })
  if (report.contextDifferences.length) report.warnings.push('Capture contexts differ. These changes cannot be attributed to Claude Code version alone; feature gates may also differ.')
  if ([before.manifest, after.manifest].some((manifest) => manifest && manifest.status !== 'complete')) report.warnings.push('At least one capture is incomplete; missing tools may reflect a failed capture.')
  for (const name of [...left.keys()].filter((name) => right.has(name)).sort()) {
    const change = { name, fields: [], required: [], descriptions: [] }
    compareObject(left.get(name), right.get(name), '', change)
    if (change.fields.length || change.required.length || change.descriptions.length) report.changedTools.push(change)
  }
  return report
}

export function renderMarkdown(report) {
  const json = (value) => JSON.stringify(value)
  const lines = ['# Claude Code tool snapshot diff', '', `Added tools: ${report.addedTools.length}; removed tools: ${report.removedTools.length}; changed tools: ${report.changedTools.length}.`, '', '| Context | Before | After |', '| --- | --- | --- |']
  for (const field of ['claudeCodeVersion', 'platform', 'entry', 'requestedTools', 'enabledTools', 'generatedAt', 'status']) lines.push(`| ${field} | ${json(report.before?.[field] ?? 'unknown').replace(/\|/g, '\\|')} | ${json(report.after?.[field] ?? 'unknown').replace(/\|/g, '\\|')} |`)
  for (const warning of report.warnings) lines.push('', '> ' + warning)
  for (const context of report.contextDifferences) lines.push('', `Context changed: ${context.field}: ${json(context.before)} → ${json(context.after)}.`)
  lines.push('', '## Tools', '', `Added: ${report.addedTools.join(', ') || 'none'}`, '', `Removed: ${report.removedTools.join(', ') || 'none'}`)
  for (const tool of report.changedTools) {
    lines.push('', '## ' + tool.name)
    for (const field of tool.fields) lines.push('', `- Field ${field.kind} at \`${field.path}\`: ${json(field.before)} → ${json(field.after)}`)
    for (const required of tool.required) lines.push('', `- Required at \`${required.path}\`: added ${json(required.added)}, removed ${json(required.removed)}`)
    for (const description of tool.descriptions) {
      const body = `Before: ${description.before ?? '(absent)'}\n\nAfter: ${description.after ?? '(absent)'}`
      const fence = '`'.repeat(Math.max(3, ...(body.match(/`+/g) || []).map((run) => run.length + 1)))
      lines.push('', `Description changed at \`${description.path}\`:`, '', fence + 'text', body, fence)
    }
  }
  return lines.join('\n') + '\n'
}

if (isMain(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2), { values: ['format', 'out'], flags: ['help'] })
    if (args.help) console.log('Usage: node scripts/catalog-diff.mjs BEFORE AFTER [--format markdown|json] [--out FILE]\nInputs: raw snapshot root, docs root/data, or tools.json; manifests are optional for legacy data.')
    else {
      if (args._.length !== 2) throw new Error('Expected BEFORE and AFTER snapshot paths; see --help')
      if (!['markdown', 'json'].includes(args.format || 'markdown')) throw new Error('--format must be markdown or json')
      const report = diffCatalogs(loadSnapshot(args._[0]), loadSnapshot(args._[1]))
      const body = args.format === 'json' ? JSON.stringify(report, null, 2) + '\n' : renderMarkdown(report)
      if (args.out) { fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true }); fs.writeFileSync(args.out, body) }
      else process.stdout.write(body)
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
