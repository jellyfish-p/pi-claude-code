# 落到 pi：兼容性改造清单

目标不是"把 Claude Code 抄一遍"，而是**让 Claude 在 pi 里看到它熟悉的契约**。
模型的"像不像 Claude Code"几乎完全由三件事决定，按影响力排序：

1. **工具的 name + description**（最容易被忽略，也最值钱）
2. **系统提示词的段落结构**（`# Harness` / `# Environment` / tone 规则）
3. **注入位置**（哪些内容放 `system`，哪些放 `role:"system"` 的消息，哪些包 `<system-reminder>`）

---

## 1. 工具映射表

| Claude Code | pi 现状 | 建议 |
| --- | --- | --- |
| `Bash`（`command` / `timeout` / `description` / `run_in_background`） | `bash`（`command` / `timeout`） | 名字相同、语义相同，**直接把 03 里 Bash 的描述原文搬过去**。它包含引号、`cd`、`sleep`、git 规约、超时单位等 30+ 条行为约束。`description` 参数缺失会让模型的并行工具调用缺少"给人看的标签"。 |
| `Read`（`file_path` / `offset` / `limit` / `pages` / `allow_large`） | `read`（`path` / `offset` / `limit`） | **参数名不一致是最大的坑**：`path` vs `file_path`。建议把 pi 的 `read` 改成 `file_path`（或至少加别名并在描述里显式说明）。 |
| `Edit`（`file_path` / `old_string` / `new_string` / `replace_all`，**单点替换**） | `edit`（`edits[]`，**批量**） | 结构不同，模型会写错。二选一：<br>① 增加一个 CC 形状的 `Edit` 工具；<br>② 在 `edit` 描述里明确写出"一次传多个 edits 是允许的，不要逐条调用"——否则模型会退化成逐条调用，回合数翻倍。 |
| `Write`（`file_path` / `content`） | `write`（`path` / `content`） | 只差路径字段名。但 CC 要求绝对路径、覆盖已有文件前必须 Read；pi 允许相对路径、自动建父目录、不强制先 Read。照抄描述要同步改这两条语义。 |
| `Glob` / `Grep` | 无（走 `bash`） | CC 的系统提示词明说 *"Prefer the dedicated file/search tools over shell commands"*。pi 没有这两个工具时，这段指引会变成空话，模型会用 `bash find/grep`——噪声更大。要么补工具，要么把提示词里这句改成 pi 的实际工具名（`read` / `bash`）。 |
| `TodoWrite`（**本次未启用**） | `manage_todo_list` | 状态集合 `pending / in_progress / completed` 完全一致。想更贴近就用 `TodoWrite` 这个名字 + 08 里的提示词原文。 |
| `AskUserQuestion`（**本次未启用**） | `ask_user` | 语义一致，参数不同（CC 是 `questions[]` + `options[]` + `multiSelect`）。 |
| `Agent` / `Task`（`description` / `prompt` / `subagent_type` / `model` / `effort` / `run_in_background` / `isolation`） | `Agent`（`subagent_type` + `description` + `prompt`） | 已经非常接近。03 里 `Agent` 的描述（3.2KB）包含"什么时候该委派 / 什么时候别委派 / 怎么下 brief"的完整决策指南，**建议整段替换**。 |
| `WebSearch` / `WebFetch` | `web_search` / `fetch_content` | 语义一致，名字不同。CC 的描述很短（334 / 469 字符），好搬。 |
| `Skill` | 无（pi 直接 `read` SKILL.md） | CC 是"工具调用 + 同轮注入正文"。如果 pi 加一个 `Skill` 工具，行为会更接近（模型不必自己拼路径）。 |
| `ToolSearch` / `DeferredToolPlaceholder` | 无 | pi 不需要延迟加载，但**要意识到**：CC 的模型习惯了"工具可能要现查 schema"。pi 全量给 schema 反而更简单，不必模拟。 |
| `Monitor` / `CronCreate` / `SendMessage` / `ScheduleWakeup` / `Workflow` / `ReportFindings` / `EnterWorktree` … | 部分对应（`SubagentWorkflow` / `steer_subagent` / `ask_user`） | 这些是 CC 特有的编排工具。**不建议硬塞**，但 `Workflow` 的脚本 API 和 pi 的 `SubagentWorkflow` 高度相似，可以互相对照（见 03）。 |
| — | `computer_use_*`（一整套） | CC 没有这些（它用 Chrome 集成 / MCP）。工具数量多会让模型的"工具选择"分布变散，必要时用工具分组或描述里的使用条件收窄。 |

## 2. 提示词怎么拼

按 01 + 02 的结构复刻，最小改动版：

```text
system = [
  "You are a Claude agent, built on Anthropic's Claude Agent SDK.",   // 可留可去
  <01 的 system[2] 全文，把 # Memory / # Environment 段换成 pi 的实际值>
]

messages = [
  { role: "user",   content: "<system-reminder>…attribution…</system-reminder>\n" + 用户输入 },
  { role: "system", content: <02 的环境块：cwd / git / OS / 模型 / 工具清单 / agent 清单 / skill 清单> },
  … 后续对话 …
]
```

要点：

- **`# Harness` 段别删**。它定义了"输出是终端 markdown"、"权限被拒说明用户不同意，
  别原样重试"、"独立工具调用可并行"、"代码引用写成 `file:line`"。这几句话直接改变交互行为。
- **`# Memory` 段**是 Claude Code 的 auto-memory（一文件一事实 + `MEMORY.md` 索引）。
  pi 如果不做这件事，**整段删掉**，不要留着让模型去写一个不存在的目录。
- **`# Environment` 里的模型自述**（`You are powered by the model named Opus 5.5 … knowledge cutoff`）
  必须替换成真实值，否则模型会自称错误的模型。
- **tone 规则**（代词 they/them、不可逆操作先确认、失败要如实报告）在 `system[2]` 中部，
  属于"Claude Code 味"的重要来源，建议原样保留。

## 3. 环境块是独立消息，不是 system

这是最容易漏的一点。CC 把工具/代理/skill 清单放在 `role: "system"` 的 **message** 里
（顺序是 `user → system → user`）。如果把这些塞进 `system` 数组，模型对"
清单是可变上下文"的认知会变，且缓存命中也不同。

如果 pi 的消息类型只允许 `user` / `assistant`，退而求其次的做法是把它作为**第一条 user 消息的
第二段**，并保留 `# Environment` 标题 —— 至少让模型能靠标题定位。

## 4. 子代理：用 schema 裁剪，而不是只在提示词里说"只读"

见 04。CC 的 `Explore` 之所以真的只读，是因为它的 tools 里没有 `Edit`/`Write`。
pi 的 `Explore` 如果只是提示词说"不要改文件"，会有一定概率违反。**工具白名单要在 API 层裁剪。**

可直接复用的提示词：

- `Explore`（3.2K）：搜索广度、并行 grep、绝对路径、"不要把报告写成文件"。
- `Plan`（3.6K）：架构设计、权衡、不改代码。
- `general-purpose`（2.9K）：多步任务。
- `statusline-setup`（14.5K）：只有一个专项职责 + 两个工具的范例。

## 5. skills：目录已经天然互通

CC `2.1.316` 的二进制里含 `.agents/skills` 这个路径；本机 `~/.claude/skills` 与
`~/.pi/agent/skills` 都是指向 `~/.agents/skills` 的符号链接 —— 也就是说 skill 文件本身
早就共享了，差异只在**清单的描述怎么给模型**。

建议：让 pi 用与 CC 一致的单行格式（`- name: description`，含"什么时候用"的触发语），
并把"用户输入 `/<name>` 等于调用该 skill"这条规则写进 `# Session-specific guidance`。

## 6. 请求参数对齐

| 参数 | CC 的值 | 说明 |
| --- | --- | --- |
| `thinking` | `{"type":"adaptive","display":"omitted"}` | 自适应思考；`display` 可切 `updates` |
| `output_config.effort` | `{"effort":"medium"}` | 随 `--effort` 变 |
| `context_management` | `{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}` | 清 thinking 的 beta |
| `max_tokens` | `128000` | |
| `metadata.user_id` | 双重编码的 JSON 字符串 | 不是明文 id |

如果 pi 走的是同一套 Anthropic API，这三项直接抄，thinking 的清理行为会一致。

## 7. 别做的事

1. **不要改写工具描述**。CC 的 `Bash` / `Agent` / `Monitor` 描述长度分别是 2.1K / 3.2K / 6.3K，
   它们是**行为规约**，不是文档。改一个字都会让行为漂移。
2. **不要给模型两套等价工具**（例如同时给 `Grep` 和"用 bash grep"的指引）。CC 明确写了
   "优先用专用搜索工具"，矛盾指引会让模型在两套之间摇摆。
3. **不要保留不适用的段落**（`# Memory` 指向不存在的目录、`WebFetch` 的域名白名单等）。
   幻觉式配置比缺配置更糟。
4. **不要为了"兼容"而假装有延迟加载**。pi 全量给 schema 更简单，模型也更容易一次做对。

## 8. 验证方法

改完用同一批 prompt 对比 pi 与 Claude Code 的行为差异，重点看：

- 是否还会用 `bash grep` 而不是专用搜索工具（说明工具描述没生效）。
- 多文件改动时是否一次给多个 `edit`（说明批量语义没讲清）。
- 是否会主动 `TodoWrite`（说明 todo 提示词缺失或状态集合不同）。
- 子代理是否越权写文件（说明工具白名单没裁剪）。
