#!/usr/bin/env node
// Regenerates docs/01..08 from docs/data + docs/skills.
// Usage: node scripts/build-docs.mjs
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const DOCS = path.join(ROOT, 'docs')
const DATA = path.join(DOCS, 'data')

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const read = (p) => fs.readFileSync(p, 'utf8')
const write = (name, body) => {
  fs.writeFileSync(path.join(DOCS, name), body)
  console.log('wrote docs/' + name + '  (' + body.length + ' chars)')
}

const BT = String.fromCharCode(96)
const code = (x) => BT + x + BT
const fence = (lang, body) => {
  // pick a fence longer than any backtick run inside the body (system prompts contain ``` blocks)
  const runs = body.match(/`{3,}/g)
  const n = Math.max(3, runs ? Math.max(...runs.map((x) => x.length)) + 1 : 0)
  const d = BT.repeat(n)
  return d + (lang || '') + '\n' + body + '\n' + d
}
const lines = (...xs) => xs.flat().filter((x) => x !== null && x !== undefined).join('\n')

const VERSION = '2.1.316'
const tools = readJSON(path.join(DATA, 'tools.json'))
const system = readJSON(path.join(DATA, 'system-prompt.json'))
const envBlock = read(path.join(DATA, 'environment-block.md'))
const init = readJSON(path.join(DATA, 'init.json'))
const envelope = readJSON(path.join(DATA, 'request-envelope.json'))
const agentFiles = fs.readdirSync(path.join(DATA, 'agents')).filter((f) => f.endsWith('.md')).sort()
const skillFiles = fs.readdirSync(path.join(DOCS, 'skills')).filter((f) => f.endsWith('.md')).sort()

const header = (title, note) =>
  lines(
    '# ' + title,
    '',
    '> Claude Code ' + code(VERSION) + ' · 由 ' + code('scripts/build-docs.mjs') + ' 自动生成 · 请勿手改',
    note ? '\n' + note.trim() : '',
    '',
    '---',
    ''
  )

/* ------------------------------------------------------------------ 01 */
{
  const blocks = system
    .map((b, i) => {
      const tag = i === 0 ? 'billing header' : i === 1 ? 'SDK identity' : 'main prompt'
      return lines(
        '## system[' + i + '] · ' + (b.text || '').length + ' chars · ' + tag,
        '',
        fence('text', (b.text || '').trimEnd()),
        ''
      )
    })
    .join('\n')

  write(
    '01-system-prompt.md',
    header(
      '主系统提示词 (system)',
      `
这是每次请求都会发送的 \`system\` 数组原文（3 个 block）。

- \`system[0]\` 是计费/遥测头，**不是给模型看的指令**，可以丢弃。
- \`system[1]\` 是 SDK/子代理身份句，只有 \`--print\`/SDK 入口才出现；子代理里会附带 \`cc_is_subagent=true\`。
- \`system[2]\` 是真正的 Claude Code 主提示词。它由代码**动态拼装**：\`# Memory\` 段的路径、
  \`# Environment\` 段的模型名都会随环境变化。
`
    ) + blocks
  )
}

/* ------------------------------------------------------------------ 02 */
{
  write(
    '02-environment-block.md',
    header(
      '环境块 (role: "system" 的 message)',
      `
抓包发现一个非常关键的 quirk：Claude Code 把「环境信息 + 工具/代理/skill 清单」放在
\`messages[1]\`，而且这条消息的 **\`role\` 是 \`"system"\`**（不是 user）。

真实请求里的消息顺序：

${fence('text', lines(
  'messages[0] user   : <system-reminder>…attribution…</system-reminder> + 用户输入',
  'messages[1] system : # Environment …（下面这一整块）',
  'messages[2] user   : 后续对话'
))}

要 1:1 复刻 Claude Code 的行为，pi 也必须把同样的内容放在同样的位置，否则模型对
「有哪些工具 / 哪些代理 / 哪些 skill」的认知会不同。
`
    ) +
      lines(
        '## 原文',
        '',
        fence('text', envBlock.trimEnd()),
        '',
        '## 动态片段一览',
        '',
        '| 片段 | 来源 |',
        '| --- | --- |',
        '| `Primary working directory` / `Additional working directories` | cwd 与 `--add-dir` |',
        '| `Is a git repository` | 是否 git repo（是的话还会带 git 状态） |',
        '| `Platform` / `Shell` / `OS Version` | 运行时探测 |',
        '| `You are powered by the model named …` | 模型别名 + 精确 model id + 知识截止日期 |',
        '| `The following deferred tools are now available via ToolSearch` | 延迟加载工具名单（见 03 / 08） |',
        '| `Available agent types for the Agent tool` | 内置 agent 列表（见 04） |',
        '| `The following skills are available for use with the Skill tool` | 内置 + 用户 skill 列表（见 05） |',
        "| `Today's date` | 会话日期 |",
        ''
      )
  )
}

/* ------------------------------------------------------------------ 03 */
{
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name))
  const table = sorted
    .map((t) => {
      const req = t.input_schema?.required || []
      const first = (t.description || '').split('\n')[0].slice(0, 56).replace(/\|/g, '\\|')
      return '| ' + code(t.name) + ' | ' + (t.defer_loading ? 'deferred' : 'eager') + ' | ' + (req.length ? req.join(', ') : '—') + ' | ' + first + ' |'
    })
    .join('\n')

  const body = sorted
    .map((t) => {
      const props = t.input_schema?.properties || {}
      const req = new Set(t.input_schema?.required || [])
      const rows = Object.entries(props)
        .map(([k, v]) => {
          const type = v.type || (v.anyOf ? 'anyOf' : v.$ref ? 'ref' : '—')
          const desc = String(v.description || '').replace(/\n+/g, ' ').replace(/\|/g, '\\|').slice(0, 170)
          return '| ' + code(k) + ' | ' + type + ' | ' + (req.has(k) ? '✅' : '—') + ' | ' + desc + ' |'
        })
        .join('\n')

      return lines(
        '## ' + t.name,
        '',
        '- `defer_loading`: **' + !!t.defer_loading + '**' + (t.defer_loading ? '（必须先经 ToolSearch 加载才能调用）' : ''),
        '- 描述长度: ' + (t.description || '').length + ' chars',
        '- 必填参数: ' + ([...req].join(', ') || '—'),
        '',
        '### 描述（原文）',
        '',
        fence('text', (t.description || '').trimEnd()),
        '',
        '### 参数',
        '',
        '| 参数 | 类型 | 必填 | 说明 |',
        '| --- | --- | --- | --- |',
        rows || '| — | — | — | 无参数 |',
        '',
        '### input_schema（原文）',
        '',
        fence('json', JSON.stringify(t.input_schema, null, 2)),
        ''
      )
    })
    .join('\n---\n\n')

  write(
    '03-tool-catalog.md',
    header(
      '工具目录 (tools)',
      `
共 **${tools.length}** 个工具，全部取自真实 API 请求体的 \`tools\` 字段（已渲染，可直接复用）。

- \`DeferredToolPlaceholder\` 只是「保持延迟加载机制开启」的占位符，模型永远不会调用它。
- \`defer_loading: true\` 的工具默认只以**名字**出现在环境块里；模型必须先调 \`ToolSearch\` 拿到
  schema，工具才会出现在下一轮请求里。
- 机器可读版本：[\`data/tools.json\`](data/tools.json)

| 工具 | 加载 | 必填参数 | 首行描述 |
| --- | --- | --- | --- |
${table}
`
    ) +
      '\n---\n\n' +
      body
  )
}

/* ------------------------------------------------------------------ 04 */
{
  const body = agentFiles
    .map((f) => {
      const name = f.replace(/\.md$/, '')
      const src = read(path.join(DATA, 'agents', f))
      const m = src.match(/<!-- tools: (.*?) -->/)
      const toolsLine = m ? m[1] : ''
      const prompt = src.replace(/<!-- tools: .*? -->/, '').trimEnd()
      const parts = prompt.split('\n\n---\n\n')
      return lines(
        '## ' + name,
        '',
        '- 可用工具: ' + (toolsLine ? toolsLine.split(',').map((s) => code(s.trim())).join(', ') : '—'),
        '- system blocks: ' + parts.length + '（block0 = billing header，block1 = SDK identity，block2 = 该代理真正的提示词）',
        '',
        '### 提示词（原文，去掉 block0/block1）',
        '',
        fence('text', parts.slice(2).join('\n\n---\n\n').trimEnd()),
        ''
      )
    })
    .join('\n---\n\n')

  write(
    '04-subagents.md',
    header(
      '子代理 (Agent tool / subagents)',
      `
通过让 mock API 返回一次 \`Agent\` 工具调用，触发真实的子代理请求，从而抓到每个内置 agent 的
system prompt 与工具白名单。

要点：

1. 子代理的 \`system[0]\` 会多一个 \`cc_is_subagent=true\` 标记。
2. 子代理的**工具集合被裁剪**（例如 \`Explore\` 只有只读工具）——「只读」是在 schema 层面落实的，
   不只是提示词约束。
3. \`Explore\` 与 \`Plan\` 的差别主要在**搜索广度**与**是否允许写文件**。
4. \`statusline-setup\` 只有 \`Read\` + \`Edit\`，提示词约 14K，是一个「专项小代理」的范例。

机器可读：[\`data/agents/\`](data/agents/)
`
    ) + body
  )
}

/* ------------------------------------------------------------------ 05 */
{
  const index = skillFiles
    .map((f) => {
      const name = f.replace(/\.md$/, '')
      const body = read(path.join(DOCS, 'skills', f))
      const first = body.split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---')) || ''
      return '| ' + code(name) + ' | [' + f + '](skills/' + f + ') | ' + body.length + ' | ' + first.trim().slice(0, 64) + ' |'
    })
    .join('\n')

  const intro = lines(
    'Claude Code ' + code(VERSION) + ' 自带 **' + skillFiles.length + '** 个 skill。抓取方式：让 mock API 返回',
    code('Skill') + ' 工具调用，并且用 ' + code('--dangerously-skip-permissions') + '（否则有副作用的 skill 会被权限系统直接拒绝）。',
    'skill 正文会作为 ' + code('tool_result') + ' 之后的 ' + code('text') + ' block 注入同一条消息——和 pi 注入 skill 内容的方式本质相同。',
    '',
    '正文逐字保存在 [' + code('docs/skills/') + '](skills/)。',
    '',
    '| Skill | 文件 | 大小(chars) | 首行 |',
    '| --- | --- | --- | --- |',
    index,
    '',
    '## Skill 调用协议（重要）',
    '',
    fence('text', lines(
      'assistant: tool_use { name: "Skill", input: { skill: "init", args?: string } }',
      'user     : tool_result "Launching skill: init"',
      '           + text block = SKILL.md 正文（同一轮注入）'
    )),
    '',
    '- 有副作用的 skill 在 ' + code('--print') + ' 下会被权限系统拒绝，返回 ' + code('Execute skill: X') + ' + ' + code('is_error: true') + '。',
    '- 部分 skill 声明了 ' + code('allowedTools') + '，执行期间工具集会被收窄。',
    '',
    '## 附：skill 正文不是静态的',
    '',
    '- 正文里的 shell 注入语法（' + code('!') + ' + 反引号包住的命令）会在**注入前先执行**：',
    '  ' + code('security-review') + ' 就是靠 ' + code('!git diff --name-only origin/HEAD...') + ' 填 GIT STATUS / FILES MODIFIED 两段，',
    '  所以同一个 skill 在不同仓库状态下正文不同。',
    '- 开头常见 ' + code('Base directory for this skill: …') + ' 前缀，指向运行时临时目录（环境相关）。',
    '- ' + code('security-review') + ' 在非 git 目录下只返回一句「需要在 git 仓库里跑」（506 chars）；',
    '  这里保存的是在 git 仓库里跑出来的完整版（10.6K）。'
  )

  const [introNote, introBody] = intro.split('## 附')
  write('05-skills.md', header('内置 Skills', introNote) + '## 附' + introBody)
}

/* ------------------------------------------------------------------ 07 */
{
  const it = init.tools
  const out = lines(
    '## tools（' + it.length + '）',
    '',
    it.map((t) => code(t)).join('、'),
    '',
    '> 注意：API 请求里实际叫 `Agent`，init 里叫 `Task`（旧名保留）。',
    '',
    '## agents（' + init.agents.length + '）',
    '',
    init.agents.map((a) => code(a)).join('、'),
    '',
    '## plugins',
    '',
    (init.plugins || []).map((p) => '- ' + code(p.name) + ' — path: `' + p.path + '`, source: `' + p.source + '`').join('\n'),
    '',
    '## skills（' + init.skills.length + '）',
    '',
    init.skills.map((s) => code(s)).join('、'),
    '',
    '## slash_commands（' + init.slash_commands.length + '）',
    '',
    init.slash_commands.map((s) => code('/' + s)).join('、'),
    '',
    '## capabilities',
    '',
    (init.capabilities || []).map((c) => code(c)).join('、'),
    '',
    '## 其他字段',
    '',
    fence(
      'json',
      JSON.stringify(
        Object.fromEntries(
          Object.entries(init).filter(([k]) => !['tools', 'slash_commands', 'skills', 'agents', 'plugins', 'capabilities'].includes(k))
        ),
        null,
        2
      )
    ),
    ''
  )

  write(
    '07-inventory.md',
    header(
      '运行时清单 (SDK init message)',
      `
\`--output-format stream-json\` 的第一条消息是 \`{"type":"system","subtype":"init"}\`。
它是 Claude Code 对「我是谁、我有什么能力」的完整自述——做兼容时这是最好的对照表。

机器可读原文：[\`data/init.json\`](data/init.json)

` + out
    )
  )
}

/* ------------------------------------------------------------------ 08 */
{
  const builtin = [
    'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit', 'WebFetch', 'WebSearch',
    'Task', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop',
    'Skill', 'REPL', 'JavaScript', 'AskUserQuestion', 'ToolSearch', 'SendUserMessage',
  ]
  const enabled = new Set(init.tools.map((t) => (t === 'Task' ? 'Agent' : t)))
  const gated = builtin.filter((n) => !enabled.has(n) && n !== 'Task')
  const rows = builtin
    .map((n) => '| ' + code(n) + ' | ' + (enabled.has(n) ? '✅ 本次发送' : '❌ 未启用') + ' |')
    .join('\n')

  write(
    '08-gated-tools.md',
    header(
      '未加载的内置工具 / 历史工具',
      `
\`BUILTIN_TOOL_NAMES\` 是二进制里那份"内置工具名单"（用于 \`Tool(pattern)\` 权限规则校验），
共 ${builtin.length} 个名字。它和本次会话实际启用的 ${init.tools.length} 个工具（见 07）**并不重合**：

- 会话里有、名单里没有：\`CronCreate\` \`CronDelete\` \`CronList\` \`EnterWorktree\` \`ExitWorktree\`
  \`Monitor\` \`SendMessage\` \`ListAgents\` \`ReportFindings\` \`ScheduleWakeup\` \`Workflow\`
- 名单里有、会话里没有：\`TodoWrite\` \`TaskCreate\` \`TaskGet\` \`TaskList\` \`TaskUpdate\`
  \`REPL\` \`JavaScript\` \`AskUserQuestion\` \`SendUserMessage\`

后者被远端 feature gate 关掉了（例如 TodoWrite 的开关 \`tengu_humble_zephyr\` 默认 false）。

**结论**：在 \`${VERSION}\` 的 \`-p\` 路径里，这些工具根本不会发给模型。所以
「Claude 在 pi 里应该看到 TodoWrite」这个假设**不成立**——除非 pi 自己想提供。

${fence('text', 'BUILTIN_TOOL_NAMES = ' + JSON.stringify(builtin))}

| 工具 | 本次会话 |
| --- | --- |
${rows}

未启用的：${gated.map((n) => code(n)).join('、')}

## 附：TodoWrite 提示词（二进制内静态提取）

虽然本次运行没有加载，但提示词完整存在于二进制里：从某个偏移量连续 stitch（跳过短二进制
间隙）得到，以 \`</example>\` 结尾，因此可确认没有被截断。pi 想实现 Claude Code 风格的
todo 工具时，这份文本最接近参考。

${fence('text', read(path.join(DATA, 'gated-todowrite.md')).trimEnd())}
`
    )
  )
}

/* ------------------------------------------------------------------ 06 */
{
  const top = Object.fromEntries(Object.entries(envelope).filter(([k]) => k !== 'metadata'))
  const body = lines(
    '# API 请求结构',
    '',
    '> Claude Code ' + code(VERSION) + ' 的 `POST /v1/messages?beta=true` 请求体骨架',
    '',
    '## 顶层字段',
    '',
    fence('json', JSON.stringify(top, null, 2)),
    '',
    '| 字段 | 值 | 说明 |',
    '| --- | --- | --- |',
    '| `model` | `' + envelope.model + '` | 会话模型 id |',
    '| `max_tokens` | `' + envelope.max_tokens + '` | 128k |',
    '| `thinking` | `{"type":"adaptive","display":…}` | 自适应思考；`display` 可为 `omitted` / `updates` |',
    '| `context_management` | `{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}` | 服务端清理 thinking 的 beta |',
    '| `output_config` | `{"effort":"medium"}` | 随 `--effort` 变化 |',
    '| `stream` | `true` | 始终流式 |',
    '',
    '## metadata',
    '',
    fence('json', JSON.stringify(envelope.metadata, null, 2)),
    '',
    '`user_id` 是一个 **JSON 字符串**（双重编码），内部含 device_id / account_uuid / session_id。',
    '',
    '## messages 的非标准点',
    '',
    '1. **存在 `role: "system"` 的 message**（见 [02-environment-block.md](02-environment-block.md)）。',
    '2. 用户消息常被 `<system-reminder>` 包裹（attribution、skill 清单、todo 提醒都走这里）。',
    '3. `tool_result` 里可以是 `tool_reference` block（延迟加载工具时使用）：',
    '   `{"type":"tool_result","content":[{"type":"tool_reference","tool_name":"WebFetch"}]}`。',
    '   这是 beta 能力，服务端负责把 schema 展开。',
    '',
    '## 工具延迟加载协议',
    '',
    fence(
      'text',
      lines(
        'tools 里带 {"name":"DeferredToolPlaceholder","defer_loading":true}   → 开启延迟加载',
        'tools 里带 {"name":"WebFetch","defer_loading":true}                  → 只给名字，不给 schema',
        'Claude 调 ToolSearch{"query":"select:WebFetch,WebSearch"}            → 客户端回 tool_reference',
        '下一轮请求的 tools 里出现完整 schema                                   → 变成可调用'
      )
    ),
    '',
    '## 其他观察',
    '',
    '- `--permission-mode plan` 时会额外加顶层 `safeguards`（classifier 上下文：cwd、rules、git 状态、',
    '  trusted_directories…），见 `data/` 下的抓包。',
    '- `system[0]` 里 `cc_version=2.1.316.8dc` 的 `.8dc` 是每次构建都不同的指纹后缀。',
    ''
  )
  write('06-api-request-shape.md', body)
}

console.log('\ndone')
