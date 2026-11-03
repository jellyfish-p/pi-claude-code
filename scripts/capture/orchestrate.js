// Runs a list of experiments against the mock server, one claude invocation each.
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = process.env.CC_WORK || path.join(__dirname, '..', '..', '.work')
const CL = process.env.CC_BIN || path.join(ROOT, 'bin/package/claude.exe')

const SKILLS = ['dataviz','update-config','keybindings-help','simplify','fewer-permission-prompts','loop','claude-api','workflow-authoring','run','plugin-authoring','init','security-review']
const AGENTS = ['claude','Explore','general-purpose','Plan','statusline-setup']

const experiments = []
for (const s of SKILLS) experiments.push({ run: `skill-${s}`, prompt: `Use the ${s} skill.`, steps: [
  { blocks: [{ type: 'tool_use', name: 'Skill', input: { skill: s } }] },
  { blocks: [{ type: 'text', text: 'ok' }] }, { blocks: [{ type: 'text', text: 'ok' }] },
]})
for (const a of AGENTS) experiments.push({ run: `agent-${a}`, prompt: 'spawn agent', steps: [
  { blocks: [{ type: 'tool_use', name: 'Agent', input: { description: 'probe', prompt: 'Say hi.', subagent_type: a } }] },
  { blocks: [{ type: 'text', text: 'subagent done' }] }, { blocks: [{ type: 'text', text: 'main done' }] },
]})

const only = process.argv[2]
for (const e of experiments) {
  if (only && !e.run.includes(only)) continue
  fs.writeFileSync(path.join(__dirname, 'scenario.json'), JSON.stringify({ run: e.run, steps: e.steps }, null, 1))
  const env = { ...process.env,
    ANTHROPIC_BASE_URL: process.env.CC_MOCK||'http://127.0.0.1:8790', ANTHROPIC_API_KEY: 'sk-ant-api03-dummy',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_AUTOUPDATER: '1',
    HOME: path.join(ROOT, 'home'), USERPROFILE: path.join(ROOT, 'home'),
  }
  const r = spawnSync(CL, ['--print', e.prompt], { cwd: path.join(ROOT, 'scratch'), env, encoding: 'utf8', timeout: 90000 })
  console.log(`${e.run}: exit=${r.status} ${(r.stdout||'').trim().slice(0,80)} ${(r.stderr||'').trim().slice(0,120)}`)
}
