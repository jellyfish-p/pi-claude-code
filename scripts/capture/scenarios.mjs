const text = (text = 'ok') => ({ blocks: [{ type: 'text', text }] })
const tool = (name, input) => ({ blocks: [{ type: 'tool_use', name, input }] })
const skills = ['dataviz', 'update-config', 'keybindings-help', 'simplify', 'fewer-permission-prompts', 'loop', 'claude-api', 'workflow-authoring', 'run', 'plugin-authoring', 'init', 'security-review']
const agents = ['claude', 'Explore', 'general-purpose', 'Plan', 'statusline-setup']
const deferred = ['Agent', 'CronCreate', 'CronDelete', 'CronList', 'EnterWorktree', 'ExitWorktree', 'ListAgents', 'Monitor', 'NotebookEdit', 'ReportFindings', 'ScheduleWakeup', 'SendMessage', 'Skill', 'TaskStop', 'WebFetch', 'WebSearch', 'Workflow']

export function scenariosFor(profile = 'base') {
  if (profile === 'base') return [
    { run: 'toolsearch', prompt: 'hi', steps: [tool('ToolSearch', { query: 'select:' + deferred.join(',') }), text()] },
    { run: 'plan-mode', prompt: 'hi', args: ['--permission-mode', 'plan'], steps: [text()] },
  ]
  const skillRuns = (prefix = '', args = []) => skills.map((skill) => ({ run: prefix + 'skill-' + skill, prompt: `Use the ${skill} skill.`, args, steps: [tool('Skill', { skill }), text(), text()] }))
  if (profile === 'skills') return skillRuns()
  if (profile === 'agents') return agents.map((agent) => ({ run: 'agent-' + agent, prompt: 'spawn agent', steps: [tool('Agent', { description: 'probe', prompt: 'Say hi.', subagent_type: agent }), text('subagent done'), text('main done')] }))
  if (profile === 'legacy') return [...skillRuns(), ...scenariosFor('agents')]
  if (profile === 'skills-permissive') return [
    { run: 'skip-default', prompt: 'hi', args: ['--dangerously-skip-permissions'], steps: [text()] },
    ...skillRuns('sd-', ['--dangerously-skip-permissions']),
  ]
  throw new Error(`Unknown profile: ${profile}`)
}
