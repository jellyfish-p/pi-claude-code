import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DEFAULT_RAW = path.join(ROOT, 'data/raw')
export const isMain = (meta) => process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(meta)
export const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
export const sha256 = (body) => createHash('sha256').update(body).digest('hex')
export const writeJSON = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

export function parseArgs(args, { values = [], flags = [], repeated = [] } = {}) {
  const result = { _: [] }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') { result._.push(...args.slice(i + 1)); break }
    if (!arg.startsWith('--')) { result._.push(arg); continue }
    const equal = arg.indexOf('=')
    const key = arg.slice(2, equal < 0 ? undefined : equal)
    if (flags.includes(key)) {
      if (equal >= 0) throw new Error(`--${key} does not take a value`)
      result[key] = true
    } else if (values.includes(key) || repeated.includes(key)) {
      const value = equal < 0 ? args[++i] : arg.slice(equal + 1)
      if (value === undefined || (equal < 0 && value.startsWith('--'))) throw new Error(`Missing value for --${key} (use --${key}=VALUE for values starting with --)`)
      if (repeated.includes(key)) (result[key] ??= []).push(value)
      else result[key] = value
    } else throw new Error(`Unknown option: --${key}`)
  }
  return result
}

export function validateScenario(scenario) {
  if (!scenario || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(scenario.run) || scenario.run === '..') throw new Error('Scenario run must be a simple directory name')
  if (!Array.isArray(scenario.steps) || !scenario.steps.length) throw new Error(`Scenario ${scenario.run} needs at least one step`)
  return scenario
}
