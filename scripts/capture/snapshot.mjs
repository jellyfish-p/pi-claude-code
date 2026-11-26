import fs from 'node:fs'
import path from 'node:path'
import { readJSON } from './common.mjs'

export const canonical = (value) => JSON.stringify(normalize(value))
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]))
  return value
}

export function mergeRawTools(requests) {
  // Keep the historical full toolsearch declaration's order when it is present,
  // then union all remaining scenarios instead of discarding their tools.
  const runs = fs.readdirSync(requests).filter((run) => fs.statSync(path.join(requests, run)).isDirectory()).sort((a, b) => a === 'toolsearch' ? -1 : b === 'toolsearch' ? 1 : a.localeCompare(b))
  const selected = new Map()
  for (const run of runs) {
    const captures = fs.readdirSync(path.join(requests, run)).filter((name) => name.endsWith('.json')).sort().map((name) => ({ name, request: readJSON(path.join(requests, run, name)) }))
    captures.sort((a, b) => (b.request.tools || []).length - (a.request.tools || []).length || a.name.localeCompare(b.name))
    for (const { request } of captures) for (const tool of request.tools || []) {
      if (typeof tool.name !== 'string' || !tool.name) throw new Error('Every catalog tool needs a name')
      const prior = selected.get(tool.name)
      // A deferred placeholder must not hide an expanded declaration captured later.
      if (!prior || (Boolean(tool.input_schema) && !prior.input_schema) || (Boolean(tool.input_schema) === Boolean(prior.input_schema) && canonical(tool).length > canonical(prior).length)) selected.set(tool.name, tool)
    }
  }
  return [...selected.values()]
}

export function loadSnapshot(input) {
  const location = path.resolve(input)
  const file = fs.statSync(location).isFile()
  const directory = file ? path.dirname(location) : location
  const candidates = file ? [location] : [path.join(directory, 'tools.json'), path.join(directory, 'data/tools.json')]
  const catalog = candidates.find((candidate) => fs.existsSync(candidate))
  let tools
  if (catalog) {
    tools = readJSON(catalog)
    if (!Array.isArray(tools)) throw new Error(`Expected a tool array in ${catalog}`)
  } else {
    const requests = path.join(directory, 'requests')
    if (!fs.existsSync(requests)) throw new Error(`No tools.json or requests directory in ${directory}`)
    tools = mergeRawTools(requests)
  }
  const names = new Set()
  for (const tool of tools) {
    if (typeof tool.name !== 'string' || !tool.name) throw new Error('Every catalog tool needs a name')
    if (names.has(tool.name)) throw new Error(`Duplicate catalog tool: ${tool.name}`)
    names.add(tool.name)
  }
  const manifestPath = [path.join(directory, 'manifest.json'), path.join(directory, 'data/manifest.json')].find((file) => fs.existsSync(file))
  return { tools, manifest: manifestPath ? readJSON(manifestPath) : null }
}
