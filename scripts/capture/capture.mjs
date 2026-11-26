#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { ROOT, DEFAULT_RAW, isMain, parseArgs, readJSON, sha256, validateScenario, writeJSON } from './common.mjs'
import { startCaptureServer } from './server.js'
import { scenariosFor } from './scenarios.mjs'

const HELP = `Usage: node scripts/capture/capture.mjs [options]
  --out DIR             Snapshot root (default data/raw; refuses existing captures)
  --bin FILE            Claude Code executable (or CC_BIN)
  --bin-arg VALUE       Executable prefix argument, repeatable (e.g. a fake .mjs)
  --version VERSION     Declared binary version; otherwise read isolated --version
  --platform PLATFORM   Capture platform label (default process.platform-process.arch)
  --entry print         Entry point (currently only print is supported)
  --tools A,B           Requested Claude Code --tools list; actual tools recorded separately
  --scenario FILE       Scenario JSON object/array; repeatable
  --scenarios DIR       Directory of scenario JSON files
  --profile NAME        base (default), agents, skills, legacy, skills-permissive
  --only TEXT           Filter scenario run names
  --prompt TEXT         Override scenario prompt
  --arg VALUE           Extra Claude argument, repeatable; use --arg=--flag
  --cwd DIR             Explicit test project (default new empty scratch)
  --work DIR            Parent for a new isolated temporary workspace
  --timeout-ms N        Per child timeout (default 90000)
  --help                Show this message
The command starts/stops its own loopback mock; no separate server is needed.`

export function isolatedEnvironment(work, baseURL, source = process.env) {
  const env = {}
  // Do not inherit credentials, proxies, NODE_OPTIONS, or user Claude configuration.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL', 'TERM']) {
    if (source[key] !== undefined) env[key] = source[key]
  }
  const home = path.join(work, 'home')
  const temp = path.join(work, 'tmp')
  for (const directory of [home, temp, path.join(home, 'AppData/Roaming'), path.join(home, 'AppData/Local')]) fs.mkdirSync(directory, { recursive: true })
  return Object.assign(env, {
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
    TMPDIR: temp, TMP: temp, TEMP: temp,
    ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_API_KEY: 'sk-ant-api03-capture-dummy',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_AUTOUPDATE: '1',
    CLAUDE_CODE_USE_BEDROCK: '0', CLAUDE_CODE_USE_VERTEX: '0', CLAUDE_CODE_USE_FOUNDRY: '0',
  })
}

async function runChild(bin, args, { cwd, env, timeoutMs, signal: abortSignal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', timedOut = false, aborted = false
    const limit = 8 * 1024 * 1024
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk).slice(-limit) })
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-limit) })
    const stop = () => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => child.kill('SIGKILL'))
      } else if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
    const cancel = () => { aborted = true; stop() }
    abortSignal?.addEventListener('abort', cancel, { once: true })
    if (abortSignal?.aborted) cancel()
    const timer = setTimeout(() => { timedOut = true; stop() }, timeoutMs)
    const cleanup = () => { clearTimeout(timer); abortSignal?.removeEventListener('abort', cancel) }
    child.once('error', (error) => { cleanup(); reject(new Error(`Cannot start capture child: ${error.message}`)) })
    child.once('close', (code, signal) => { cleanup(); resolve({ code, signal, stdout, stderr, timedOut, aborted }) })
  })
}

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function capture(options = {}) {
  if (options.signal?.aborted) throw new Error('Capture cancelled')
  const out = path.resolve(options.out || DEFAULT_RAW)
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`Output directory is not empty: ${out}. Choose a new --out snapshot directory.`)
  if (options.entry && options.entry !== 'print') throw new Error('Only --entry print is supported')
  const timeoutMs = Number(options['timeout-ms'] ?? 90000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('--timeout-ms must be a positive integer')
  const prefix = (options['bin-arg'] || []).map((arg) => fs.existsSync(arg) ? path.resolve(arg) : arg)
  const binary = options.bin || process.env.CC_BIN || path.join(process.env.CC_WORK || path.join(ROOT, '.work'), 'bin/package', process.platform === 'win32' ? 'claude.exe' : 'claude')
  // Resolve before switching cwd to the isolated scratch directory. Bare commands still use PATH.
  const bin = /[\\/]/.test(binary) || fs.existsSync(binary) ? path.resolve(binary) : binary
  const scenarioPaths = [...(options.scenario || [])]
  if (options.scenarios) for (const file of fs.readdirSync(options.scenarios).filter((f) => f.endsWith('.json')).sort()) scenarioPaths.push(path.join(options.scenarios, file))
  let scenarios = scenarioPaths.length ? scenarioPaths.flatMap((file) => { const data = readJSON(file); return Array.isArray(data) ? data : [data] }) : scenariosFor(options.profile)
  if (options.only) scenarios = scenarios.filter((s) => s.run?.includes(options.only))
  if (!scenarios.length) throw new Error('No scenarios selected')
  scenarios = scenarios.map((scenario) => ({ ...scenario, prompt: options.prompt ?? scenario.prompt ?? 'hi' }))
  const names = new Set()
  for (const scenario of scenarios) {
    validateScenario(scenario)
    if (names.has(scenario.run)) throw new Error(`Duplicate scenario run: ${scenario.run}`)
    names.add(scenario.run)
    if (scenario.args && (!Array.isArray(scenario.args) || scenario.args.some((arg) => typeof arg !== 'string'))) throw new Error(`Invalid args for ${scenario.run}`)
  }
  const workParent = path.resolve(options.work || os.tmpdir())
  fs.mkdirSync(workParent, { recursive: true })
  const work = fs.mkdtempSync(path.join(workParent, 'pi-claude-capture-'))
  const cwd = options.cwd ? path.resolve(options.cwd) : path.join(work, 'scratch')
  fs.mkdirSync(cwd, { recursive: true })
  const startedAt = new Date().toISOString()
  let current = scenarios[0]
  let mock
  let manifest
  try {
    mock = await startCaptureServer({ out, getScenario: () => current, logger: options.logger || console.error })
    const env = isolatedEnvironment(work, mock.url)
    let version = options.version
    if (!version) {
      const result = await runChild(bin, [...prefix, '--version'], { cwd, env, timeoutMs, signal: options.signal })
      version = result.stdout.match(/\b\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\b/)?.[0]
      if (result.code !== 0 || !version) throw new Error('Cannot determine Claude Code version; supply --version for a test executable')
    }
    manifest = {
      schemaVersion: 1, claudeCodeVersion: version, versionSource: options.version ? 'declared' : 'binary --version',
      platform: options.platform || `${process.platform}-${process.arch}`, hostPlatform: `${process.platform}-${process.arch}`, entry: 'print',
      requestedTools: options.tools === undefined ? null : [...new Set(options.tools.split(',').map((s) => s.trim()).filter(Boolean))].sort(),
      enabledTools: [], startedAt, generatedAt: null, status: 'running',
      source: { executable: path.basename(bin), executableSha256: fs.existsSync(bin) ? await hashFile(bin) : null, prefixArgsSha256: sha256(JSON.stringify(prefix)), extraArgsSha256: sha256(JSON.stringify(options.arg || [])), scenariosSha256: sha256(JSON.stringify(scenarios)), runnerSha256: sha256(fs.readFileSync(new URL('./capture.mjs', import.meta.url))), scripts: Object.fromEntries(['capture.mjs', 'server.js', 'scenarios.mjs', 'common.mjs'].map((file) => [file, sha256(fs.readFileSync(new URL(file, import.meta.url)))])) },
      scenarios: [], requests: [],
    }
    fs.mkdirSync(out, { recursive: true })
    writeJSON(path.join(out, 'scenarios.json'), scenarios)
    for (const scenario of scenarios) {
      current = scenario
      const args = [...prefix, '--print', options.prompt ?? scenario.prompt ?? 'hi', '--verbose', '--output-format', 'stream-json', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', ...(options.tools === undefined ? [] : ['--tools', options.tools]), ...(scenario.args || []), ...(options.arg || [])]
      const result = await runChild(bin, args, { cwd, env, timeoutMs, signal: options.signal })
      let init
      for (const line of result.stdout.split(/\r?\n/)) {
        try { const item = JSON.parse(line); if (item.type === 'system' && item.subtype === 'init') { init = item; break } } catch { /* Non-JSON diagnostic lines are not capture data. */ }
      }
      if (init) {
        writeJSON(path.join(out, 'inits', scenario.run + '.json'), init)
        if (!fs.existsSync(path.join(out, 'init.json'))) writeJSON(path.join(out, 'init.json'), init)
      }
      const count = mock.counts.get(scenario.run) || 0
      manifest.scenarios.push({ run: scenario.run, exitCode: result.code, signal: result.signal, timedOut: result.timedOut, cancelled: result.aborted, requestCount: count, initTools: init?.tools || [], argsSha256: sha256(JSON.stringify(args.slice(prefix.length))) })
      if (result.timedOut || result.aborted || result.code !== 0 || !count) throw new Error(`Capture ${scenario.run} failed (${result.aborted ? 'cancelled' : result.timedOut ? 'timeout' : `exit ${result.code}, ${count} requests`}); partial manifest retained. Child output was not printed; inspect the isolated setup and scenario.`)
      console.log(`${scenario.run}: ${count} request(s), exit 0`)
    }
    manifest.status = 'complete'
    return manifest
  } finally {
    if (mock) { mock.server.closeAllConnections(); await mock.close() }
    if (manifest) {
      const tools = new Set()
      for (const scenario of manifest.scenarios) {
        const directory = path.join(out, 'requests', scenario.run)
        if (!fs.existsSync(directory)) continue
        for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.json')).sort()) {
          const body = fs.readFileSync(path.join(directory, file))
          const request = JSON.parse(body)
          for (const tool of request.tools || []) if (tool.name) tools.add(tool.name)
          manifest.requests.push({ path: `requests/${scenario.run}/${file}`, sha256: sha256(body), toolNames: (request.tools || []).map((t) => t.name).filter(Boolean).sort() })
        }
      }
      manifest.enabledTools = [...tools].sort()
      manifest.generatedAt = new Date().toISOString()
      if (manifest.status !== 'complete') manifest.status = 'failed'
      manifest.source.requestsSha256 = sha256(JSON.stringify(manifest.requests))
      writeJSON(path.join(out, 'manifest.json'), manifest)
    }
    const relative = path.relative(workParent, path.resolve(work))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Refusing to clean a workspace outside its temporary parent')
    fs.rmSync(work, { recursive: true, force: true })
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv, { values: ['out', 'bin', 'version', 'platform', 'entry', 'tools', 'scenarios', 'profile', 'only', 'prompt', 'cwd', 'work', 'timeout-ms'], repeated: ['scenario', 'bin-arg', 'arg'], flags: ['help'] })
  if (options.help) { console.log(HELP); return }
  if (options._.length) throw new Error('Unexpected positional argument; use --scenario FILE or --prompt TEXT')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, cancel)
  try { await capture({ ...options, signal: controller.signal }) }
  finally { for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, cancel) }
}

if (isMain(import.meta.url)) {
  try { await main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
