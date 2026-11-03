# 工具目录 (tools)

> Claude Code `2.1.316` · 由 `scripts/build-docs.mjs` 自动生成 · 请勿手改

共 **25** 个工具，全部取自真实 API 请求体的 `tools` 字段（已渲染，可直接复用）。

- `DeferredToolPlaceholder` 只是「保持延迟加载机制开启」的占位符，模型永远不会调用它。
- `defer_loading: true` 的工具默认只以**名字**出现在环境块里；模型必须先调 `ToolSearch` 拿到
  schema，工具才会出现在下一轮请求里。
- 机器可读版本：[`data/tools.json`](data/tools.json)

| 工具 | 加载 | 必填参数 | 首行描述 |
| --- | --- | --- | --- |
| `Agent` | eager | description, prompt | Launch a new agent to handle complex, multi-step tasks.  |
| `Bash` | eager | command | Executes a bash command and returns its output. |
| `CronCreate` | deferred | cron, prompt | Schedule a prompt to be enqueued at a future time. Use f |
| `CronDelete` | deferred | id | Cancel a cron job previously scheduled with CronCreate.  |
| `CronList` | deferred | — | List all cron jobs scheduled via CronCreate, both durabl |
| `DeferredToolPlaceholder` | deferred | — | Reserved placeholder that keeps deferred tool loading ac |
| `Edit` | eager | file_path, old_string, new_string | Performs exact string replacement in a file. |
| `EnterWorktree` | deferred | — | Use this tool ONLY when explicitly instructed to work in |
| `ExitWorktree` | deferred | action | Exit a worktree session created by EnterWorktree and ret |
| `Glob` | eager | pattern | Fast file pattern matching. Supports glob patterns like  |
| `Grep` | eager | pattern | Content search built on ripgrep. Prefer this over `grep` |
| `ListAgents` | eager | — | Lists agents you can SendMessage to — in-process subagen |
| `Monitor` | deferred | description, timeout_ms | Start a background monitor that streams events from a lo |
| `NotebookEdit` | deferred | notebook_path, new_source | Replaces, inserts, or deletes a single cell in a Jupyter |
| `Read` | eager | file_path | Reads a file from the local filesystem. |
| `ReportFindings` | eager | findings | Report code-review findings as a typed list so the host  |
| `ScheduleWakeup` | eager | — | Schedule when to resume work in /loop dynamic mode — the |
| `SendMessage` | deferred | to, message | # SendMessage |
| `Skill` | eager | skill | Invoke a skill. |
| `TaskStop` | deferred | — |  |
| `ToolSearch` | eager | query, max_results | Fetches full schema definitions for deferred tools so th |
| `WebFetch` | deferred | url, prompt | Fetches a URL, converts the page to markdown, and answer |
| `WebSearch` | deferred | query | Search the web. Returns result blocks with titles and UR |
| `Workflow` | eager | — | Execute a workflow script that orchestrates multiple sub |
| `Write` | eager | file_path, content | Writes a file to the local filesystem, overwriting if on |

---

---

## Agent

- `defer_loading`: **false**
- 描述长度: 3227 chars
- 必填参数: description, prompt

### 描述（原文）

```text
Launch a new agent to handle complex, multi-step tasks. Each agent type has specific capabilities and tools available to it.

Available agent types are listed in <system-reminder> messages in the conversation.

When using the Agent tool, specify a subagent_type to select an agent: `"fork"` forks yourself (the fork inherits your full conversation context and always runs on your model — a `model` override is ignored); any other type — or omitting it — starts a fresh agent (general-purpose by default).

## When to use

A fresh agent costs more than it looks. It knows only what you put in the prompt, and you see only the summary it sends back — both handoffs drop detail, and neither of you can tell what the other missed. You can't watch it work, only wait or cancel. Its mistakes come back in the same confident register as its findings, and an agent handed your hypothesis tends to return it confirmed. Several at once spend tokens in a burst the user didn't ask for. Weigh those tokens against the accuracy they buy: the user pays for agents you did not need, and pays again for work you redo because you skipped one.

Reach for this when you have independent work to run in parallel, when the user asks for a side quest that shouldn't block your main thread, or when answering would mean reading across several files — delegate that and you keep the conclusion, not the file dumps.

Do the work yourself when it is a handful of tool calls or a lookup whose target you already know; don't delegate a check you could run inline. Delegate review only when you want a read that isn't anchored on yours — then give it the code, not your conclusion. Once you've delegated something, don't also run it yourself; wait for the result. When in doubt, don't spawn.

When you do spawn one, brief it like the peer it is: state the goal and what you have already ruled out, point it at the files and docs worth reading instead of retyping them, and keep the scope explicit and narrow. That brief is the only context it will have, so it is your first lever on every cost above — and if you cannot write a clear one, you do not understand the task well enough to hand it off.

A fork keeps its tool output out of your context. If you are the fork, execute directly — don't re-delegate.

- The agent's final report is not shown to the user — relay what matters.
- Use SendMessage with the agent's ID or name to continue a previously spawned agent with its context intact; a new Agent call starts fresh (except subagent_type: "fork", which inherits your context).
- Each agent type's model, reasoning effort, and tools come from its definition (`.claude/agents/*.md` frontmatter or SDK `agents`).
- `isolation: "worktree"` gives the agent its own git worktree (auto-cleaned if unchanged).
- Subagents run in the background by default; you'll be notified when one completes. Pass `run_in_background: false` only when your very next action depends on the result and nothing else could usefully happen while it runs — otherwise background it so the user can interject. Never fabricate or predict a pending agent's results — the notification is never something you write yourself; if the user asks before it arrives, say it's still running.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `description` | string | ✅ | A short (3-5 word) description of the task |
| `prompt` | string | ✅ | The task for the agent to perform |
| `subagent_type` | string | — | The type of specialized agent to use for this task |
| `model` | string | — | Optional model override for this agent. Takes precedence over the agent definition's model frontmatter and the configured default subagent model. If omitted, uses the age |
| `effort` | string | — | Reasoning effort for this agent. Set this ONLY when the user, or instructions such as CLAUDE.md or a skill, explicitly ask that this agent or delegated work run at a spec |
| `run_in_background` | boolean | — | Agents run in the background by default; you will be notified when one completes. Set to false only when your very next action depends on this agent's result and nothing  |
| `isolation` | string | — | Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. "remote" launches the agent in a remote cloud environment  |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "description": {
      "description": "A short (3-5 word) description of the task",
      "type": "string"
    },
    "prompt": {
      "description": "The task for the agent to perform",
      "type": "string"
    },
    "subagent_type": {
      "description": "The type of specialized agent to use for this task",
      "type": "string"
    },
    "model": {
      "description": "Optional model override for this agent. Takes precedence over the agent definition's model frontmatter and the configured default subagent model. If omitted, uses the agent definition's model, else the default (inherits from the parent unless a default subagent model is configured). Ignored for subagent_type: \"fork\" — forks always inherit the parent model.",
      "type": "string",
      "enum": [
        "sonnet",
        "opus",
        "haiku",
        "fable"
      ]
    },
    "effort": {
      "description": "Reasoning effort for this agent. Set this ONLY when the user, or instructions such as CLAUDE.md or a skill, explicitly ask that this agent or delegated work run at a specific effort level, never on your own judgment; otherwise omit it and the agent runs at its usual effort. Ignored for subagent_type: \"fork\": a fork runs at your own effort.",
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ]
    },
    "run_in_background": {
      "description": "Agents run in the background by default; you will be notified when one completes. Set to false only when your very next action depends on this agent's result and nothing else could usefully happen while it runs — otherwise leave it in the background so the user can hand you other work.",
      "type": "boolean"
    },
    "isolation": {
      "description": "Isolation mode. \"worktree\" creates a temporary git worktree so the agent works on an isolated copy of the repo. \"remote\" launches the agent in a remote cloud environment (always runs in background; availability is gated).",
      "type": "string",
      "enum": [
        "worktree",
        "remote"
      ]
    }
  },
  "required": [
    "description",
    "prompt"
  ],
  "additionalProperties": false
}
```

---

## Bash

- `defer_loading`: **false**
- 描述长度: 2111 chars
- 必填参数: command

### 描述（原文）

```text
Executes a bash command and returns its output.

This tool runs Git Bash (POSIX sh), not cmd.exe or PowerShell. Use Unix shell syntax: `/dev/null` not `NUL`, forward slashes, `$VAR` not `%VAR%` or `$env:VAR`.

- `cd` carries to the next call only in the main session, if the command succeeds and ends inside the working directories. Outside them the shell returns to the start folder; otherwise it stays where it was. Prefer absolute paths — `cd` in a compound command can trigger a permission prompt. Shell state (env vars, functions) does not persist; the shell is initialized from the user's profile.
- IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.
- Command output is displayed to you, not reliably to the user.
- `timeout` is in milliseconds: default 120000, max 600000 for a foreground command.
- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. With it, `timeout` is how long the command may run in the background (default 600000, max 7200000); at that limit it is stopped and you are re-invoked. No `&` needed. Foreground `sleep` is blocked; use Monitor with an until-loop to wait on a condition.

# Git
- Interactive flags (`-i`, e.g. `git rebase -i`, `git add -i`) are not supported in this environment.
- Use the `gh` CLI for GitHub operations (PRs, issues, API).
- GitHub notifies the owner of any `@name` written in a PR, issue, or comment. Write a bare `@name` only for a real login you mean to notify. Put roles, placeholders, and code (`@human`, `@reviewer`, `@types/node`) in backticks or drop the `@`, even when copied from project files.
- Commit or push only when the user asks. If on the default branch, branch first.
- End git commit messages and PR bodies with the attribution lines given in the conversation's system-reminder, when one is present.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `command` | string | ✅ | The command to execute |
| `timeout` | number | — | Optional timeout in milliseconds (max 600000 for a foreground command) |
| `description` | string | — | Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does. Say what t |
| `run_in_background` | boolean | — | Set to true to run this command in the background. With it, `timeout` limits how long the command may run in the background before it is stopped (default 600000 ms, max 7 |
| `dangerouslyDisableSandbox` | boolean | — | Set this to true to dangerously override sandbox mode and run commands without sandboxing. |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "command": {
      "description": "The command to execute",
      "type": "string"
    },
    "timeout": {
      "description": "Optional timeout in milliseconds (max 600000 for a foreground command)",
      "type": "number"
    },
    "description": {
      "description": "Clear, concise description of what this command does in active voice. Never use words like \"complex\" or \"risk\" in the description - just describe what it does.\n\nSay what the command does in plain words: do not echo the command's text, its flags, or file paths - the user reads this description, often without seeing the command.\n\nFor simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):\n- ls → \"List files in current directory\"\n- git status → \"Show working tree status\"\n- npm install → \"Install package dependencies\"\n\nFor commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:\n- find . -name \"*.tmp\" -exec rm {} \\; → \"Find and delete all .tmp files recursively\"\n- git reset --hard origin/main → \"Discard all local changes and match remote main\"\n- curl -s url | jq '.data[]' → \"Fetch JSON from URL and extract data array elements\"",
      "type": "string"
    },
    "run_in_background": {
      "description": "Set to true to run this command in the background. With it, `timeout` limits how long the command may run in the background before it is stopped (default 600000 ms, max 7200000 ms).",
      "type": "boolean"
    },
    "dangerouslyDisableSandbox": {
      "description": "Set this to true to dangerously override sandbox mode and run commands without sandboxing.",
      "type": "boolean"
    }
  },
  "required": [
    "command"
  ],
  "additionalProperties": false
}
```

---

## CronCreate

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 3399 chars
- 必填参数: cron, prompt

### 描述（原文）

```text
Schedule a prompt to be enqueued at a future time. Use for both recurring schedules and one-shot reminders.

Uses standard 5-field cron in the user's local timezone: minute hour day-of-month month day-of-week. "0 9 * * *" means 9am local — no timezone conversion needed.

## One-shot tasks (recurring: false)

For "remind me at X" or "at <time>, do Y" requests — fire once then auto-delete.
Pin minute/hour/day-of-month/month to specific values:
  "remind me at 2:30pm today to check the deploy" → cron: "30 14 <today_dom> <today_month> *", recurring: false
  "tomorrow morning, run the smoke test" → cron: "57 8 <tomorrow_dom> <tomorrow_month> *", recurring: false

## Recurring jobs (recurring: true, the default)

For "every N minutes" / "every hour" / "weekdays at 9am" requests:
  "*/5 * * * *" (every 5 min), "0 * * * *" (hourly), "0 9 * * 1-5" (weekdays at 9am local)

## Avoid the :00 and :30 minute marks when the task allows it

Every user who asks for "9am" gets `0 9`, and every user who asks for "hourly" gets `0 *` — which means requests from across the planet land on the API at the same instant. When the user's request is approximate, pick a minute that is NOT 0 or 30:
  "every morning around 9" → "57 8 * * *" or "3 9 * * *" (not "0 9 * * *")
  "hourly" → "7 * * * *" (not "0 * * * *")
  "in an hour or so, remind me to..." → pick whatever minute you land on, don't round

Only use minute 0 or 30 when the user names that exact time and clearly means it ("at 9:00 sharp", "at half past", coordinating with a meeting). When in doubt, nudge a few minutes early or late — the user will not notice, and the fleet will.

## Durability

By default (durable: false) the job lives only in this Claude session — nothing is written to disk, and the job is gone when Claude exits. Pass durable: true to write to .claude/scheduled_tasks.json so the job survives restarts. Only use durable: true when the user explicitly asks for the task to persist ("keep doing this every day", "set this up permanently"). Most "remind me in 5 minutes" / "check back in an hour" requests should stay session-only.

## Not for live watching

CronCreate re-runs a prompt at fixed wall-clock intervals. To watch a log file, process, or command output and be notified the moment something changes, use the Monitor tool instead — Monitor streams events as they happen; cron polls on a schedule.

## Runtime behavior

Jobs only fire while the REPL is idle (not mid-query). Durable jobs persist to .claude/scheduled_tasks.json and survive session restarts — on next launch they resume automatically. One-shot durable tasks that were missed while the REPL was closed are surfaced for catch-up. Session-only jobs die with the process. The scheduler shifts each job by a fixed per-job offset on top of whatever you pick: by default a recurring job runs up to 50% of its period late (max 30 min), and a one-shot job landing on :00 or :30 runs up to 90 s early. The result of this tool and of CronList gives each job's actual next run time: when you tell the user when a job will run, give that time, not the minute in the cron expression. Picking an off-minute is still the bigger lever.

Recurring tasks auto-expire after 7 days — they fire one final time, then are deleted. This bounds session lifetime. Tell the user about the 7-day limit when scheduling recurring jobs.

Returns a job ID you can pass to CronDelete.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `cron` | string | ✅ | Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once). |
| `prompt` | string | ✅ | The prompt to enqueue at each fire time. |
| `recurring` | boolean | — | true (default) = fire on every cron match until deleted or auto-expired after 7 days. false = fire once at the next match, then auto-delete. Use false for "remind me at X |
| `durable` | boolean | — | true = persist to .claude/scheduled_tasks.json and survive restarts. false (default) = in-memory only, dies when this Claude session ends. Use true only when the user ask |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "cron": {
      "description": "Standard 5-field cron expression in local time: \"M H DoM Mon DoW\" (e.g. \"*/5 * * * *\" = every 5 minutes, \"30 14 28 2 *\" = Feb 28 at 2:30pm local once).",
      "type": "string"
    },
    "prompt": {
      "description": "The prompt to enqueue at each fire time.",
      "type": "string"
    },
    "recurring": {
      "description": "true (default) = fire on every cron match until deleted or auto-expired after 7 days. false = fire once at the next match, then auto-delete. Use false for \"remind me at X\" one-shot requests with pinned minute/hour/dom/month.",
      "type": "boolean"
    },
    "durable": {
      "description": "true = persist to .claude/scheduled_tasks.json and survive restarts. false (default) = in-memory only, dies when this Claude session ends. Use true only when the user asks the task to survive across sessions.",
      "type": "boolean"
    }
  },
  "required": [
    "cron",
    "prompt"
  ],
  "additionalProperties": false
}
```

---

## CronDelete

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 167 chars
- 必填参数: id

### 描述（原文）

```text
Cancel a cron job previously scheduled with CronCreate. Removes it from .claude/scheduled_tasks.json (durable jobs) or the in-memory session store (session-only jobs).
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | ✅ | Job ID returned by CronCreate. |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "id": {
      "description": "Job ID returned by CronCreate.",
      "type": "string"
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false
}
```

---

## CronList

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 106 chars
- 必填参数: —

### 描述（原文）

```text
List all cron jobs scheduled via CronCreate, both durable (.claude/scheduled_tasks.json) and session-only.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| — | — | — | 无参数 |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

---

## DeferredToolPlaceholder

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 83 chars
- 必填参数: —

### 描述（原文）

```text
Reserved placeholder that keeps deferred tool loading active; never call this tool.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| — | — | — | 无参数 |

### input_schema（原文）

```json
{
  "type": "object",
  "properties": {}
}
```

---

## Edit

- `defer_loading`: **false**
- 描述长度: 360 chars
- 必填参数: file_path, old_string, new_string

### 描述（原文）

```text
Performs exact string replacement in a file.

- You must Read the file in this conversation before editing, or the call will fail.
- `old_string` must match the file exactly, including indentation, and be unique — the edit fails otherwise. Strip the Read line prefix (line number + tab) before matching.
- `replace_all: true` replaces every occurrence instead.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file_path` | string | ✅ | The absolute path to the file to modify |
| `old_string` | string | ✅ | The text to replace |
| `new_string` | string | ✅ | The text to replace it with (must be different from old_string) |
| `replace_all` | boolean | — | Replace all occurrences of old_string (default false) |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "description": "The absolute path to the file to modify",
      "type": "string"
    },
    "old_string": {
      "description": "The text to replace",
      "type": "string"
    },
    "new_string": {
      "description": "The text to replace it with (must be different from old_string)",
      "type": "string"
    },
    "replace_all": {
      "description": "Replace all occurrences of old_string (default false)",
      "default": false,
      "type": "boolean"
    }
  },
  "required": [
    "file_path",
    "old_string",
    "new_string"
  ],
  "additionalProperties": false
}
```

---

## EnterWorktree

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 3220 chars
- 必填参数: —

### 描述（原文）

```text
Use this tool ONLY when explicitly instructed to work in a worktree — either by the user directly, or by project instructions (CLAUDE.md / memory). This tool creates an isolated git worktree and switches the current session into it.

## When to Use

- The user explicitly says "worktree" (e.g., "start a worktree", "work in a worktree", "create a worktree", "use a worktree")
- CLAUDE.md or memory instructions direct you to work in a worktree for the current task

## When NOT to Use

- The user asks to create a branch, switch branches, or work on a different branch — use git commands instead
- The user asks to fix a bug or work on a feature — use normal git workflow unless worktrees are explicitly requested by the user or project instructions
- Never use this tool unless "worktree" is explicitly mentioned by the user or in CLAUDE.md / memory instructions

## Requirements

- Must be in a git repository, OR have WorktreeCreate/WorktreeRemove hooks configured in settings.json
- Must not already be in a worktree session when creating a new worktree (`name`); switching into another existing worktree via `path` is allowed

## Behavior

- In a git repository: creates a new git worktree inside `.claude/worktrees/` on a new branch. The base ref is governed by the `worktree.baseRef` setting: `fresh` (default) branches from origin/<default-branch>; `head` branches from your current local HEAD
- Outside a git repository: delegates to WorktreeCreate/WorktreeRemove hooks for VCS-agnostic isolation
- Switches the session's working directory to the new worktree
- Use ExitWorktree to leave the worktree mid-session (keep or remove). On session exit, if still in the worktree, the user will be prompted to keep or remove it

## Entering an existing worktree

Pass `path` instead of `name` to switch the session into a worktree that already exists (e.g., one you just created with `git worktree add`). On first entry from the launch directory, the path must appear in `git worktree list` for the repository that owns it — the current repository or, in a multi-repo workspace, a repository nested inside it; paths registered by neither are rejected. ExitWorktree will not remove a worktree entered this way; use `action: "keep"` to return to the original directory.

Switching with `path` also works when the session is already in a worktree (the previous worktree is left on disk, untouched, and only the new one is tracked for exit-time cleanup), and from agents whose working directory was pinned at launch (subagent isolation or explicit cwd). In both cases the target must be a worktree under `.claude/worktrees/` of the same repository, and from a pinned agent the switch only affects this agent, not the parent session. After a further switch, previously-visited worktrees are no longer writable — re-issue EnterWorktree with `path` to return to one.

## Parameters

- `name` (optional): A name for a new worktree. If neither `name` nor `path` is provided, a random name is generated.
- `path` (optional): Path to an existing worktree to enter instead of creating one — of the current repository, or (on first entry from the launch directory) of a repository nested inside it. Mutually exclusive with `name`.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | — | Optional name for a new worktree. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generat |
| `path` | string | — | Path to an existing worktree to switch into instead of creating a new one. Must appear in `git worktree list` for the current repo — or, on first entry from the launch di |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "name": {
      "description": "Optional name for a new worktree. Each \"/\"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided. Mutually exclusive with `path`.",
      "type": "string"
    },
    "path": {
      "description": "Path to an existing worktree to switch into instead of creating a new one. Must appear in `git worktree list` for the current repo — or, on first entry from the launch directory, for a repo nested inside it (multi-repo workspace). Mutually exclusive with `name`.",
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

---

## ExitWorktree

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 1923 chars
- 必填参数: action

### 描述（原文）

```text
Exit a worktree session created by EnterWorktree and return the session to the original working directory.

## Scope

This tool ONLY operates on worktrees created by EnterWorktree in this session. It will NOT touch:
- Worktrees you created manually with `git worktree add`
- Worktrees from a previous session (even if created by EnterWorktree then)
- The directory you're in if EnterWorktree was never called

If called outside an EnterWorktree session, the tool is a **no-op**: it reports that no worktree session is active and takes no action. Filesystem state is unchanged.

## When to Use

- The user explicitly asks to "exit the worktree", "leave the worktree", "go back", or otherwise end the worktree session
- Do NOT call this proactively — only when the user asks

## Parameters

- `action` (required): `"keep"` or `"remove"`
  - `"keep"` — leave the worktree directory and branch intact on disk. Use this if the user wants to come back to the work later, or if there are changes to preserve.
  - `"remove"` — delete the worktree directory and its branch. Use this for a clean exit when the work is done or abandoned.
- `discard_changes` (optional, default false): only meaningful with `action: "remove"`. If the worktree has uncommitted files or commits not on the original branch, the tool will REFUSE to remove it unless this is set to `true`. If the tool returns an error listing changes, confirm with the user before re-invoking with `discard_changes: true`.

## Behavior

- Restores the session's working directory to where it was before EnterWorktree
- Clears CWD-dependent caches (system prompt sections, memory files, plans directory) so the session state reflects the original directory
- If a tmux session was attached to the worktree: killed on `remove`, left running on `keep` (its name is returned so the user can reattach)
- Once exited, EnterWorktree can be called again to create a fresh worktree
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `action` | string | ✅ | "keep" leaves the worktree and branch on disk; "remove" deletes both. |
| `discard_changes` | boolean | — | Required true when action is "remove" and the worktree has uncommitted files or unmerged commits. The tool will refuse and list them otherwise. |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "action": {
      "description": "\"keep\" leaves the worktree and branch on disk; \"remove\" deletes both.",
      "type": "string",
      "enum": [
        "keep",
        "remove"
      ]
    },
    "discard_changes": {
      "description": "Required true when action is \"remove\" and the worktree has uncommitted files or unmerged commits. The tool will refuse and list them otherwise.",
      "type": "boolean"
    }
  },
  "required": [
    "action"
  ],
  "additionalProperties": false
}
```

---

## Glob

- `defer_loading`: **false**
- 描述长度: 140 chars
- 必填参数: pattern

### 描述（原文）

```text
Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `pattern` | string | ✅ | The glob pattern to match files against |
| `path` | string | — | The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pattern": {
      "description": "The glob pattern to match files against",
      "type": "string"
    },
    "path": {
      "description": "The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - simply omit it for the default behavior. Must be a valid directory path if provided.",
      "type": "string"
    }
  },
  "required": [
    "pattern"
  ],
  "additionalProperties": false
}
```

---

## Grep

- `defer_loading`: **false**
- 描述长度: 477 chars
- 必填参数: pattern

### 描述（原文）

```text
Content search built on ripgrep. Prefer this over `grep`/`rg` via Bash — results integrate with the permission UI and file links.

- Full regex syntax (e.g. "log.*Error", "function\s+\w+"). Ripgrep, not grep — escape literal braces (`interface\{\}`).
- Filter with `glob` (e.g. "**/*.tsx") or `type` (e.g. "js", "py", "rust").
- `output_mode`: "content" (matching lines), "files_with_matches" (paths only, default), or "count".
- `multiline: true` for patterns that span lines.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `pattern` | string | ✅ | The regular expression pattern to search for in file contents |
| `path` | string | — | File or directory to search in (rg PATH). Defaults to current working directory. |
| `glob` | string | — | Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob |
| `output_mode` | string | — | Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" |
| `-B` | number | — | Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise. |
| `-A` | number | — | Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise. |
| `-C` | number | — | Alias for context. |
| `context` | number | — | Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise. |
| `-n` | boolean | — | Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true. |
| `-i` | boolean | — | Case insensitive search (rg -i) |
| `-o` | boolean | — | Print only the matched (non-empty) parts of each matching line, one match per output line (rg -o / --only-matching). Requires output_mode: "content", ignored otherwise. D |
| `type` | string | — | File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types. |
| `head_limit` | number | — | Limit output to first N lines/entries, equivalent to "\| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), c |
| `offset` | number | — | Skip first N lines/entries before applying head_limit, equivalent to "\| tail -n +N \| head -N". Works across all output modes. Defaults to 0. |
| `multiline` | boolean | — | Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false. |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pattern": {
      "description": "The regular expression pattern to search for in file contents",
      "type": "string"
    },
    "path": {
      "description": "File or directory to search in (rg PATH). Defaults to current working directory.",
      "type": "string"
    },
    "glob": {
      "description": "Glob pattern to filter files (e.g. \"*.js\", \"*.{ts,tsx}\") - maps to rg --glob",
      "type": "string"
    },
    "output_mode": {
      "description": "Output mode: \"content\" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), \"files_with_matches\" shows file paths (supports head_limit), \"count\" shows match counts (supports head_limit). Defaults to \"files_with_matches\".",
      "type": "string",
      "enum": [
        "content",
        "files_with_matches",
        "count"
      ]
    },
    "-B": {
      "description": "Number of lines to show before each match (rg -B). Requires output_mode: \"content\", ignored otherwise.",
      "type": "number"
    },
    "-A": {
      "description": "Number of lines to show after each match (rg -A). Requires output_mode: \"content\", ignored otherwise.",
      "type": "number"
    },
    "-C": {
      "description": "Alias for context.",
      "type": "number"
    },
    "context": {
      "description": "Number of lines to show before and after each match (rg -C). Requires output_mode: \"content\", ignored otherwise.",
      "type": "number"
    },
    "-n": {
      "description": "Show line numbers in output (rg -n). Requires output_mode: \"content\", ignored otherwise. Defaults to true.",
      "type": "boolean"
    },
    "-i": {
      "description": "Case insensitive search (rg -i)",
      "type": "boolean"
    },
    "-o": {
      "description": "Print only the matched (non-empty) parts of each matching line, one match per output line (rg -o / --only-matching). Requires output_mode: \"content\", ignored otherwise. Defaults to false.",
      "type": "boolean"
    },
    "type": {
      "description": "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.",
      "type": "string"
    },
    "head_limit": {
      "description": "Limit output to first N lines/entries, equivalent to \"| head -N\". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 250 when unspecified. Pass 0 for unlimited (use sparingly — large result sets waste context).",
      "type": "number"
    },
    "offset": {
      "description": "Skip first N lines/entries before applying head_limit, equivalent to \"| tail -n +N | head -N\". Works across all output modes. Defaults to 0.",
      "type": "number"
    },
    "multiline": {
      "description": "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.",
      "type": "boolean"
    }
  },
  "required": [
    "pattern"
  ],
  "additionalProperties": false
}
```

---

## ListAgents

- `defer_loading`: **false**
- 描述长度: 777 chars
- 必填参数: —

### 描述（原文）

```text
Lists agents you can SendMessage to — in-process subagents you spawned, the teammates on your team, other local Claude sessions on this machine, your Claude sessions running in the cloud (when this session has cloud access; a cloud session receives your message but cannot message any session back yet — do not ask it to reply, read its answer in its own transcript), and (when Remote Control is connected here) your account's other sessions — Remote Control sessions on other machines and cloud sessions, each row labeled by kind. Names are the address: send with `SendMessage({to: "<name>", message: "..."})`, copying the name exactly as a row prints it. Append a row's ` [ref]` only when the bare name is not enough — two rows share it, or an error asks you to disambiguate.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `channel` | string | — | Not available in this build; leave unset. |
| `q` | string | — | Not available in this build; leave unset. |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "channel": {
      "description": "Not available in this build; leave unset.",
      "type": "string",
      "maxLength": 256
    },
    "q": {
      "description": "Not available in this build; leave unset.",
      "type": "string",
      "maxLength": 256
    }
  },
  "additionalProperties": false
}
```

---

## Monitor

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 6354 chars
- 必填参数: description, timeout_ms

### 描述（原文）

```text
Start a background monitor that streams events from a long-running script. Each stdout line is an event — you keep working and notifications arrive in the chat. Events arrive on their own schedule and are not replies from the user, even if one lands while you're waiting for the user to answer a question.

Pick by how many notifications you need:
- **One** ("tell me when the server is ready / the build finishes") → use **Bash with `run_in_background`** and a command that exits when the condition is true, e.g. `until grep -q "Ready in" dev.log; do sleep 0.5; done`. You get a single completion notification when it exits.
- **One per occurrence, until the monitor expires (re-arm to continue)** ("tell me every time an ERROR line appears") → Monitor with an unbounded command (`tail -f`, `inotifywait -m`, `while true`).
- **One per occurrence, until a known end** ("emit each CI step result, stop when the run completes") → Monitor with a command that emits lines and then exits.

Your script's stdout is the event stream. Each line becomes a notification. Exit ends the watch.

  # Each matching log line is an event
  tail -f /var/log/app.log | grep --line-buffered "ERROR"

  # Each file change is an event
  inotifywait -m --format '%e %f' /watched/dir

  # Poll GitHub for new PR comments and emit one line per new comment
  last=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  while true; do
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    gh api "repos/owner/repo/issues/123/comments?since=$last" --jq '.[] | "\(.user.login): \(.body)"'
    last=$now; sleep 30
  done

  # Node script that emits events as they arrive (e.g. WebSocket listener)
  node watch-for-events.js

  # Per-occurrence with a natural end: emit each CI check as it lands, exit when the run completes
  prev=""
  while true; do
    s=$(gh pr checks 123 --json name,bucket)
    cur=$(jq -r '.[] | select(.bucket!="pending") | "\(.name): \(.bucket)"' <<<"$s" | sort)
    comm -13 <(echo "$prev") <(echo "$cur")
    prev=$cur
    jq -e 'all(.bucket!="pending")' <<<"$s" >/dev/null && break
    sleep 30
  done

**Don't use an unbounded command for a single notification.** `tail -f`, `inotifywait -m`, and `while true` never exit on their own, so the monitor stays armed until timeout even after the event has fired. For "tell me when X is ready," use Bash `run_in_background` with an `until` loop instead (one notification, ends in seconds). Note that `tail -f log | grep -m 1 ...` does *not* fix this: if the log goes quiet after the match, `tail` never receives SIGPIPE and the pipeline hangs anyway.

**Script quality:**
- Every pipe stage must flush per line or matches sit in its buffer unseen: `grep` needs `--line-buffered`, `awk` needs `fflush()`. `head` cannot flush at all — `| head -N` delivers nothing until N matches accumulate, then ends the stream.
- In poll loops, handle transient failures (`curl ... || true`) — one failed request shouldn't kill the monitor.
- Poll intervals: 30s+ for remote APIs (rate limits), 0.5-1s for local checks.
- Write a specific `description` — it appears in every notification ("errors in deploy.log" not "watching logs").
- Only stdout is the event stream. Stderr goes to the output file (readable via Read) but does not trigger notifications — for a command you run directly (e.g. `python train.py 2>&1 | grep --line-buffered ...`), merge stderr with `2>&1` so its failures reach your filter. (No effect on `tail -f` of an existing log — that file only contains what its writer redirected.)

**Coverage — silence is not success.** When watching a job or process for an outcome, your filter must match every terminal state, not just the happy path. A monitor that greps only for the success marker stays silent through a crashloop, a hung process, or an unexpected exit — and silence looks identical to "still running." Before arming, ask: *if this process crashed right now, would my filter emit anything?* If not, widen it.

  # Wrong — silent on crash, hang, or any non-success exit
  tail -f run.log | grep --line-buffered "elapsed_steps="

  # Right — one alternation covering progress + the failure signatures you'd act on
  tail -f run.log | grep -E --line-buffered "elapsed_steps=|Traceback|Error|FAILED|assert|Killed|OOM"

For poll loops checking job state, emit on every terminal status (`succeeded|failed|cancelled|timeout`), not just success. If you cannot confidently enumerate the failure signatures, broaden the grep alternation rather than narrow it — some extra noise is better than missing a crashloop.

**Output volume**: Every stdout line is a conversation message, so the filter should be selective — but selective means "the lines you'd act on," not "only good news." Never pipe raw logs; filter to exactly the success and failure signals you care about. Monitors that produce too many events are automatically stopped; restart with a tighter filter if this happens.

Stdout lines within 200ms are batched into a single notification, so multiline output from a single event groups naturally.

The script runs in the same shell environment as Bash. Exit ends the watch (exit code is reported). Every monitor expires after `timeout_ms` (default 5 minutes, at most 10 minutes): it is killed and you get one notice with the event count. Re-arm it if you still need the watch; for a long watch (PR monitoring, log tails) set `timeout_ms` to the maximum and re-arm on each expiry, and widen the filter if an expiry with no events was unexpected. Use TaskStop to cancel early.
**ws source** — open a WebSocket and stream each incoming text frame as an event. No shell, no polling: the server pushes, you get notified.

  Monitor({
    ws: {url: 'wss://events.example.com/stream', protocols: ['v1']},
    description: 'deploy events',
  })

Each text frame becomes one notification (multiline frames stay as one event). Binary frames are reported as `[binary frame, N bytes]` rather than passed through. Socket close ends the watch with the close code surfaced; errors are surfaced before close. Same rate limiting as bash — a firehose will be suppressed and eventually stopped, so subscribe to a filtered feed where one exists.

Prefer this over `command: 'websocat wss://…'` — it avoids the extra process and line-buffering pitfalls. Use bash when you need to transform or filter frames with shell tools before they become events.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `description` | string | ✅ | Short human-readable description of what you are monitoring (shown in notifications). |
| `timeout_ms` | number | ✅ | Kill the monitor after this deadline. Default 300000ms. Deadlines above 600000ms are capped to 600000ms. You are notified at expiry and can re-arm. |
| `command` | string | — | Shell command or script. Each stdout line is an event; exit ends the watch. |
| `ws` | object | — | WebSocket to open. Each text frame is an event; binary frames are reported as a placeholder line. Socket close ends the watch. Cannot be combined with command. |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "description": {
      "description": "Short human-readable description of what you are monitoring (shown in notifications).",
      "type": "string"
    },
    "timeout_ms": {
      "description": "Kill the monitor after this deadline. Default 300000ms. Deadlines above 600000ms are capped to 600000ms. You are notified at expiry and can re-arm.",
      "default": 300000,
      "type": "number",
      "minimum": 1000,
      "maximum": 3600000
    },
    "command": {
      "description": "Shell command or script. Each stdout line is an event; exit ends the watch.",
      "type": "string"
    },
    "ws": {
      "description": "WebSocket to open. Each text frame is an event; binary frames are reported as a placeholder line. Socket close ends the watch. Cannot be combined with command.",
      "type": "object",
      "properties": {
        "url": {
          "type": "string"
        },
        "protocols": {
          "type": "array",
          "items": {
            "type": "string",
            "pattern": "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$"
          }
        }
      },
      "required": [
        "url"
      ],
      "additionalProperties": false
    }
  },
  "required": [
    "description",
    "timeout_ms"
  ],
  "additionalProperties": false
}
```

---

## NotebookEdit

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 619 chars
- 必填参数: notebook_path, new_source

### 描述（原文）

```text
Replaces, inserts, or deletes a single cell in a Jupyter notebook (.ipynb file).

Usage:
- You must use the Read tool on the notebook in this conversation before editing — this tool will fail otherwise.
- `notebook_path` must be an absolute path.
- `cell_id` is the `id` attribute shown in the Read tool's `<cell id="...">` output. It is required for `replace` and `delete`.
- `edit_mode` defaults to `replace`. Use `insert` to add a new cell after the cell with the given `cell_id` (or at the beginning of the notebook if `cell_id` is omitted) — `cell_type` is required when inserting. Use `delete` to remove the cell.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `notebook_path` | string | ✅ | The absolute path to the Jupyter notebook file to edit (must be absolute, not relative) |
| `cell_id` | string | — | The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified. |
| `new_source` | string | ✅ | The new source for the cell |
| `cell_type` | string | — | The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required. |
| `edit_mode` | string | — | The type of edit to make (replace, insert, delete). Defaults to replace. |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "notebook_path": {
      "description": "The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)",
      "type": "string"
    },
    "cell_id": {
      "description": "The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.",
      "type": "string"
    },
    "new_source": {
      "description": "The new source for the cell",
      "type": "string"
    },
    "cell_type": {
      "description": "The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required.",
      "type": "string",
      "enum": [
        "code",
        "markdown"
      ]
    },
    "edit_mode": {
      "description": "The type of edit to make (replace, insert, delete). Defaults to replace.",
      "type": "string",
      "enum": [
        "replace",
        "insert",
        "delete"
      ]
    }
  },
  "required": [
    "notebook_path",
    "new_source"
  ],
  "additionalProperties": false
}
```

---

## Read

- `defer_loading`: **false**
- 描述长度: 790 chars
- 必填参数: file_path

### 描述（原文）

```text
Reads a file from the local filesystem.

- `file_path` must be an absolute path.
- Reads up to 2000 lines by default.
- When you already know which part of the file you need, only read that part. This can be important for larger files.
- Results are returned using cat -n format, with line numbers starting at 1
- Reads images (PNG, JPG, …) and presents them visually. Reads PDFs via the `pages` parameter (e.g. "1-5", max 20 pages/request; required for PDFs over 10 pages). Reads Jupyter notebooks (.ipynb) as cells with outputs.
- Reading a directory, a missing file, or an empty file returns an error or system reminder rather than content.
- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file_path` | string | ✅ | The absolute path to the file to read |
| `offset` | integer | — | The line number to start reading from. Only provide if the file is too large to read at once |
| `limit` | integer | — | The number of lines to read. Only provide if the file is too large to read at once. |
| `pages` | string | — | Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request. |
| `allow_large` | boolean | — | Set to true to read a text file, or a line range of one, that is over the usual size limits, up to what still fits in your context. Only use this when you genuinely need  |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "description": "The absolute path to the file to read",
      "type": "string"
    },
    "offset": {
      "description": "The line number to start reading from. Only provide if the file is too large to read at once",
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    },
    "limit": {
      "description": "The number of lines to read. Only provide if the file is too large to read at once.",
      "type": "integer",
      "exclusiveMinimum": 0,
      "maximum": 9007199254740991
    },
    "pages": {
      "description": "Page range for PDF files (e.g., \"1-5\", \"3\", \"10-20\"). Only applicable to PDF files. Maximum 20 pages per request.",
      "type": "string"
    },
    "allow_large": {
      "description": "Set to true to read a text file, or a line range of one, that is over the usual size limits, up to what still fits in your context. Only use this when you genuinely need all of it or the user asked for the whole file; otherwise read it in parts with offset and limit, or search it.",
      "type": "boolean"
    }
  },
  "required": [
    "file_path"
  ],
  "additionalProperties": false
}
```

---

## ReportFindings

- `defer_loading`: **false**
- 描述长度: 574 chars
- 必填参数: findings

### 描述（原文）

```text
Report code-review findings as a typed list so the host UI can render them. Use this only when the active code-review instructions tell you to report findings with this tool; otherwise follow whatever output format those instructions specify. When reporting a review's results, call it once with the verified findings ranked most-severe first (empty array if nothing survived verification) and do not also print the findings as text. When re-reporting after applying fixes (only if the apply instructions ask for it), set `outcome` on each finding to what actually happened.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `level` | string | — | Effort level the review ran at |
| `findings` | array | ✅ | Verified findings, most-severe first; empty if none survived |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "level": {
      "description": "Effort level the review ran at",
      "type": "string",
      "enum": [
        "low",
        "medium",
        "high",
        "xhigh",
        "max"
      ]
    },
    "findings": {
      "description": "Verified findings, most-severe first; empty if none survived",
      "maxItems": 32,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "file": {
            "description": "Repo-relative path of the file the finding is in",
            "type": "string"
          },
          "line": {
            "description": "1-indexed line the finding anchors to",
            "type": "integer",
            "minimum": -9007199254740991,
            "maximum": 9007199254740991
          },
          "summary": {
            "description": "One-sentence statement of the defect",
            "type": "string"
          },
          "short_summary": {
            "description": "Compressed label for compact UI (≤60 chars): the claim alone, no rationale or consequence clause",
            "type": "string",
            "maxLength": 60
          },
          "failure_scenario": {
            "description": "Concrete inputs/state → wrong output/crash",
            "type": "string"
          },
          "category": {
            "description": "Short kebab-case slug of the finding type, e.g. \"correctness\", \"simplification\", \"efficiency\", \"test-coverage\"",
            "type": "string",
            "maxLength": 40
          },
          "verdict": {
            "description": "Set when a verify pass ran; absent on inline-only reviews",
            "type": "string",
            "enum": [
              "CONFIRMED",
              "PLAUSIBLE"
            ]
          },
          "outcome": {
            "description": "Set ONLY when re-reporting after applying fixes: what happened to this finding",
            "type": "string",
            "enum": [
              "fixed",
              "skipped",
              "no_change_needed"
            ]
          }
        },
        "required": [
          "file",
          "summary",
          "failure_scenario"
        ],
        "additionalProperties": false
      }
    }
  },
  "required": [
    "findings"
  ],
  "additionalProperties": false
}
```

---

## ScheduleWakeup

- `defer_loading`: **false**
- 描述长度: 3396 chars
- 必填参数: —

### 描述（原文）

```text
Schedule when to resume work in /loop dynamic mode — the user invoked /loop without an interval, asking you to self-pace iterations of a specific task.

Do NOT schedule a short-interval wakeup to poll for background work you started — when harness-tracked work finishes, you are re-invoked automatically, so polling is wasted. Instead schedule a long fallback (1200s+) so the loop survives if the work hangs or never notifies. The exception is external work the harness cannot track (a CI run, a deploy, a remote queue) — there, pick a delay matched to how fast that state actually changes.

Pass the same /loop prompt back via `prompt` each turn so the next firing repeats the task. For an autonomous /loop (no user prompt), pass the literal sentinel `<<autonomous-loop-dynamic>>` as `prompt` instead — the runtime resolves it back to the autonomous-loop instructions at fire time. (There is a similar `<<autonomous-loop>>` sentinel for CronCreate-based autonomous loops; do not confuse the two — ScheduleWakeup always uses the `-dynamic` variant.) To end the loop, call this tool with `stop: true` (omit every other field) — the loop ends immediately and no further wakeups fire.

Set `noop: true` if nothing changed — you checked and there's nothing to report ("no change", "still waiting", "quiet hold"). Set `noop: false` if something happened worth keeping — you edited a file, posted a message, advanced state, or surfaced a finding. Consecutive `noop: true` ticks are collapsed in the user's terminal view and tracked as a streak, so long quiet holds stay legible to the user without scrolling. Omit `noop` when stopping (`stop: true`).

## Picking delaySeconds

This session's requests use the default 5-minute Anthropic prompt-cache TTL. Sleeping past 300 seconds means the next wake-up reads your full conversation context uncached — slower and more expensive. So the natural breakpoints:

- **Under 5 minutes (60s–270s)**: cache stays warm. Right for actively polling external state the harness can't notify you about — a CI run, a deploy, a remote queue.
- **5 minutes to 1 hour (300s–3600s)**: pay the cache miss. Right when there's no point checking sooner — waiting on something that takes minutes to change, genuinely idle, or as the long fallback heartbeat when something else is the primary wake signal.

**Don't pick 300s.** It's the worst-of-both: you pay the cache miss without amortizing it. If you're tempted to "wait 5 minutes," either drop to 270s (stay in cache) or commit to 1200s+ (one cache miss buys a much longer wait). Don't think in round-number minutes — think in cache windows.

For idle ticks with no specific signal to watch, default to **1200s–1800s** (20–30 min). The loop checks back, you don't burn cache 12× per hour for nothing, and the user can always interrupt if they need you sooner.

Think about what you're actually waiting for, not just "how long should I sleep." If you're polling a CI run that takes ~8 minutes, sleeping 60s burns the cache 8 times before it finishes — sleep ~270s twice instead.

The runtime clamps to [60, 3600], so you don't need to clamp yourself.

## The reason field

One short sentence on what you chose and why. Goes to telemetry and is shown back to the user. "watching CI run" beats "waiting." The user reads this to understand what you're doing without having to predict your cadence in advance — make it specific.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `delaySeconds` | number | — | Seconds from now to wake up. Clamped to [60, 3600] by the runtime. Required unless `stop` is true. |
| `reason` | string | — | One short sentence explaining the chosen delay. Goes to telemetry and is shown to the user. Be specific. Required unless `stop` is true. |
| `prompt` | string | — | The /loop input to fire on wake-up. Pass the same /loop input verbatim each turn so the next firing re-enters the skill and continues the loop. For autonomous /loop (no u |
| `stop` | boolean | — | Set to true to end the dynamic loop immediately instead of scheduling another wakeup. When true, all other fields are ignored and no further wakeups fire. |
| `noop` | boolean | — | true = nothing changed (you checked and there is nothing to report). false = something happened worth keeping (edited a file, posted a message, advanced state, surfaced a |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "delaySeconds": {
      "description": "Seconds from now to wake up. Clamped to [60, 3600] by the runtime. Required unless `stop` is true.",
      "type": "number"
    },
    "reason": {
      "description": "One short sentence explaining the chosen delay. Goes to telemetry and is shown to the user. Be specific. Required unless `stop` is true.",
      "type": "string"
    },
    "prompt": {
      "description": "The /loop input to fire on wake-up. Pass the same /loop input verbatim each turn so the next firing re-enters the skill and continues the loop. For autonomous /loop (no user prompt), pass the literal sentinel `<<autonomous-loop-dynamic>>` instead (the dynamic-pacing variant, not the CronCreate-mode `<<autonomous-loop>>`). Required unless `stop` is true.",
      "type": "string"
    },
    "stop": {
      "description": "Set to true to end the dynamic loop immediately instead of scheduling another wakeup. When true, all other fields are ignored and no further wakeups fire.",
      "type": "boolean"
    },
    "noop": {
      "description": "true = nothing changed (you checked and there is nothing to report). false = something happened worth keeping (edited a file, posted a message, advanced state, surfaced a finding). Consecutive noop:true ticks are collapsed in the user's terminal view and tracked as a streak. Required unless `stop` is true.",
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

---

## SendMessage

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 4259 chars
- 必填参数: to, message

### 描述（原文）

````text
# SendMessage

Send a message to another agent.

```json
{"to": "researcher", "summary": "assign task 1", "message": "start on task #1"}
```

| `to` | |
|---|---|
| `"researcher"` | Teammate by name |
| `"main"` | The main conversation (background subagents only) |
| `"worker"` | Any agent from `ListAgents` — subagent, another local Claude session |
| `"worker [3fa9c1]"` | Same, plus its `[ref]` — only when a listing or an error shows one |

Your plain text output is NOT visible to other agents — to communicate, you MUST call this tool. Messages from teammates are delivered automatically; you don't check an inbox. Refer to agents by name — names keep working after an agent completes (a send resumes it from its transcript). Use the raw `agentId` (format `a...-...`) from its spawn result only when the agent has no name, or when a newer agent took the name (latest wins). When relaying, don't quote the original — it's already rendered to the user.

## Cross-session

Use `ListAgents` to discover targets. Every row leads with the agent's `name [ref]` — the name IS the address; there is no separate address syntax.

```json
{"to": "worker", "message": "check if tests pass over there"}
{"to": "worker [3fa9c1]", "message": "you, specifically"}
```

Send the bare name — a name that exactly matches one live agent or session (on this machine, on another machine, or in the cloud) delivers directly. Append the ` [ref]` only when the bare name is not enough — `ListAgents` shows two rows with it, or an error asks you to disambiguate (you typed only a prefix, or a session list could not be checked). A ref you did not just read from a listing or an error will not resolve, and if the same name also names an in-process agent, the bare name always wins — use the in-process one.

A listed peer is alive and will receive your message; messages enqueue and drain at the receiver's next tool round (its `ListAgents` row says whether it is busy or idle right now). A successful send means the message reached that session, not that its Claude read it: a session running in a different permission mode than yours holds cross-session messages for its user's approval (and may let them expire), and a session can refuse them outright — for a session on this machine a `[Cross-session delivery notice]` tells you when that happens (the tool result says when this session has no inbox for one to reach); for a Remote Control, cloud or Claude Desktop session nothing reports back, so never treat silence as agreement. Your message arrives wrapped as `<cross-session-message from="...">`. **To reply to an incoming message, copy its `from` attribute as your `to`.** Cross-session messages travel between SESSIONS: if you are a subagent, your send goes out under your parent session's address, and any reply is delivered to the parent session's conversation, not to you. The receiver reads your message literally in every case (idle or busy, on this machine, over Remote Control or headless): an `@` followed by a file path, or `@server:resource`, attaches nothing there, unlike in your own user's input. So never rely on `@` to deliver content: send the text itself, or a file with its own tool.

To hear when a session ON THIS MACHINE finishes what it is doing, pass `notify_when_idle: true` (from the main conversation only) — one-shot and opt-in: exactly one `[Cross-session idle notice]` arrives when it next goes idle (or exits) — shown to you, or only to your user when this session holds peer messages for approval (the tool result says which); if it never signals within the subscription's lifetime (it may still be busy, may refuse inbound requests, or may have ended abruptly) the notice says the subscription expired instead. Omit `message` for a pure subscription that costs that session nothing; include one to deliver it now AND subscribe. Never poll `ListAgents` in a loop or send "are you done?" messages instead.

Permission boundaries are per-session: NEVER ask a peer to perform an action that was denied or blocked in your session, or that you expect your own permission settings would block — a peer doing it for you bypasses the user's permission decision (cross-session permission laundering). Route blocked work back to your user instead.
````

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `to` | string | ✅ | Recipient: a name from ListAgents (append its " [ref]" only when a listing or an error shows one), a teammate name, "main", or a background agent's agentId |
| `summary` | string | — | A 5-10 word label for your own transcript row (not transmitted — the recipient previews the first line of `message`). Truncated to 200 characters rather than rejected. |
| `message` | string | ✅ | Plain text message content. The recipient's human sees only the FIRST LINE as a one-line preview until they expand it, so make the first line a clear, self-contained sent |
| `notify_when_idle` | boolean | — | Ask a session ON THIS MACHINE to send you ONE notice when it next goes idle (finishes its turn with nothing queued) or exits — opt-in, one-shot, no polling. With a messag |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "to": {
      "description": "Recipient: a name from ListAgents (append its \" [ref]\" only when a listing or an error shows one), a teammate name, \"main\", or a background agent's agentId",
      "type": "string",
      "allOf": [
        {
          "pattern": "^[^\\n\\r]*$"
        },
        {
          "pattern": "^[\\s\\S]{0,300}$"
        }
      ]
    },
    "summary": {
      "description": "A 5-10 word label for your own transcript row (not transmitted — the recipient previews the first line of `message`). Truncated to 200 characters rather than rejected.",
      "type": "string",
      "maxLength": 200
    },
    "message": {
      "default": "",
      "description": "Plain text message content. The recipient's human sees only the FIRST LINE as a one-line preview until they expand it, so make the first line a clear, self-contained sentence saying what this is about — not a greeting, preamble, or bare @-mention.",
      "type": "string"
    },
    "notify_when_idle": {
      "description": "Ask a session ON THIS MACHINE to send you ONE notice when it next goes idle (finishes its turn with nothing queued) or exits — opt-in, one-shot, no polling. With a message: deliver it now AND subscribe. Without a message (omit it): a pure subscription that costs the other session nothing.",
      "type": "boolean"
    }
  },
  "required": [
    "to",
    "message"
  ],
  "additionalProperties": false
}
```

---

## Skill

- `defer_loading`: **false**
- 描述长度: 1417 chars
- 必填参数: skill

### 描述（原文）

```text
Invoke a skill.

A skill is a packaged set of instructions the user or project has set up for a particular kind of task (deploy steps, a review checklist, a repo-specific workflow). Available skills appear in a system-reminder listing with one-line descriptions. When the task at hand is one a listed skill covers, call this tool first — the skill's instructions load into the turn for you to follow in place of your default approach; some skills instead run in a subagent and return the finished result. A skill that runs in the background returns only the agent's name — its result arrives later as a task notification, so don't wait on it or invoke it again in the meantime. Users may also ask for one by name (`/<name>`, or "slash command"); that's a request to invoke it.

- `skill`: exact name from the listing, no leading slash. Plugin skills use `plugin:skill`. Directory-scoped skills are listed with a path prefix (`apps/web:deploy`); when both scoped and unscoped variants of a name exist, pick the one whose directory contains the files you're working on (most specific wins; unscoped otherwise).
- `args`: optional arguments to pass through.

Only names from the listing (or that the user typed explicitly) are valid. Built-in CLI commands (`/help`, `/clear`, …) aren't skills. If a `<command-name>` block is already present this turn, the skill is loaded — follow it directly rather than calling again.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `skill` | string | ✅ | The name of a skill from the available-skills list. Do not guess names. |
| `args` | string | — | Optional arguments for the skill |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "skill": {
      "description": "The name of a skill from the available-skills list. Do not guess names.",
      "type": "string"
    },
    "args": {
      "description": "Optional arguments for the skill",
      "type": "string"
    }
  },
  "required": [
    "skill"
  ],
  "additionalProperties": false
}
```

---

## TaskStop

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 364 chars
- 必填参数: —

### 描述（原文）

```text

- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- To stop an agent-team teammate, pass its agent ID or bare teammate name as task_id
- To stop a background agent spawned with a name, pass that name as task_id
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `task_id` | string | — | The ID of the background task to stop. Agent-team teammates and named background agents are also accepted by agent ID or name. |
| `shell_id` | string | — | Deprecated: use task_id instead |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "task_id": {
      "description": "The ID of the background task to stop. Agent-team teammates and named background agents are also accepted by agent ID or name.",
      "type": "string"
    },
    "shell_id": {
      "description": "Deprecated: use task_id instead",
      "type": "string"
    }
  },
  "additionalProperties": false
}
```

---

## ToolSearch

- `defer_loading`: **false**
- 描述长度: 953 chars
- 必填参数: query, max_results

### 描述（原文）

```text
Fetches full schema definitions for deferred tools so they can be called.

Deferred tools appear by name in <system-reminder> messages. Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. This tool takes a query, matches it against the deferred tool list, and returns the matched tools' complete JSONSchema definitions inside a <functions> block. Once a tool's schema appears in that result, it is callable exactly like any tool defined at the top of the prompt.

Result format: each matched tool appears as one <function>{"description": "...", "name": "...", "parameters": {...}}</function> line inside the <functions> block — the same encoding as the tool list at the top of this prompt.

Query forms:
- "select:Read,Edit,Grep" — fetch these exact tools by name
- "notebook jupyter" — keyword search, up to max_results best matches
- "+slack send" — require "slack" in the name, rank by remaining terms
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | ✅ | Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search. |
| `max_results` | number | ✅ | Maximum number of results to return (default: 5) |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "query": {
      "description": "Query to find deferred tools. Use \"select:<tool_name>\" for direct selection, or keywords to search.",
      "type": "string"
    },
    "max_results": {
      "description": "Maximum number of results to return (default: 5)",
      "default": 5,
      "type": "number"
    }
  },
  "required": [
    "query",
    "max_results"
  ],
  "additionalProperties": false
}
```

---

## WebFetch

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 469 chars
- 必填参数: url, prompt

### 描述（原文）

```text
Fetches a URL, converts the page to markdown, and answers `prompt` against it using a small fast model.

- Fails on authenticated/private URLs — use an authenticated MCP tool or `gh` for those instead.
- Fails on localhost and other hostnames without a dot; for a local server, use curl via Bash.
- HTTP is upgraded to HTTPS. Cross-host redirects are returned to you rather than followed; call again with the redirect URL.
- Responses are cached for 15 minutes per URL.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | ✅ | The URL to fetch content from |
| `prompt` | string | ✅ | The prompt to run on the fetched content |
| `offset` | integer | — | Character position in the page text to start reading from. Use it to read on through a page too long for one call, with the value the previous result gave. |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "url": {
      "description": "The URL to fetch content from",
      "type": "string",
      "format": "uri"
    },
    "prompt": {
      "description": "The prompt to run on the fetched content",
      "type": "string"
    },
    "offset": {
      "description": "Character position in the page text to start reading from. Use it to read on through a page too long for one call, with the value the previous result gave.",
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991
    }
  },
  "required": [
    "url",
    "prompt"
  ],
  "additionalProperties": false
}
```

---

## WebSearch

- `defer_loading`: **true**（必须先经 ToolSearch 加载才能调用）
- 描述长度: 334 chars
- 必填参数: query

### 描述（原文）

```text
Search the web. Returns result blocks with titles and URLs. US-only.

- The current month is (provided in the conversation below) — use this when searching for recent information.
- `allowed_domains` / `blocked_domains` filter results.
- After answering from results, end with a "Sources:" list of the URLs you used as markdown links.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `query` | string | ✅ | The search query to use |
| `allowed_domains` | array | — | Only include search results from these domains |
| `blocked_domains` | array | — | Never include search results from these domains |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "query": {
      "description": "The search query to use",
      "type": "string",
      "minLength": 2
    },
    "allowed_domains": {
      "description": "Only include search results from these domains",
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "blocked_domains": {
      "description": "Never include search results from these domains",
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "query"
  ],
  "additionalProperties": false
}
```

---

## Workflow

- `defer_loading`: **false**
- 描述长度: 3480 chars
- 必填参数: —

### 描述（原文）

```text
Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a task ID, and a <task-notification> arrives when the workflow completes. Use /workflows to watch live progress.

ONLY call this tool when the user has explicitly opted into multi-agent orchestration. Workflows can spawn dozens of agents and consume a large amount of tokens; the user must request that scale, not have it inferred. Explicit opt-in means one of:
- The user included the keyword "ultracode" in their prompt (you'll see a system-reminder confirming it).
- Ultracode is on for the session (a system-reminder confirms it) — see **Ultracode** in the workflow authoring reference.
- The user directly asked you to run a workflow or use multi-agent orchestration in their own words ("use a workflow", "run a workflow", "fan out agents", "orchestrate this with subagents"). The ask must be in the user's words — a task that would merely benefit from a workflow does not count.
- The user invoked a skill or slash command whose instructions tell you to call Workflow.
- The user asked you to run a specific named or saved workflow.

For any other task — even one that would clearly benefit from parallelism — do NOT call this tool. Use the Agent tool (if available) for individual subagents, or briefly describe what a multi-agent workflow could do and how much it would roughly cost, and ask the user whether to run it. Mention they can ask for one with "use a workflow" in a future message to skip the ask.

Every script must begin with `export const meta = {...}`: a PURE LITERAL (no variables, calls or interpolation) giving the workflow's `name`, a one-line `description` (shown in the permission dialog) and optionally `phases` — one `{ title, detail? }` per phase() call, titles matched exactly. Pass the script inline via `script` — do not Write it to a file first, and do not also set the tool's `name` input (that selects a saved workflow); it is plain JavaScript, not TypeScript.

The canonical multi-stage pattern — pipeline by default, each dimension verifies as soon as its review completes:
  export const meta = {
    name: 'review-changes',
    description: 'Review changed files across dimensions, verify each finding',
    phases: [{ title: 'Review' }, { title: 'Verify' }],
  }
  const DIMENSIONS = [{key: 'bugs', prompt: '...'}, {key: 'perf', prompt: '...'}]
  const results = await pipeline(
    DIMENSIONS,
    d => agent(d.prompt, {label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA}),
    review => parallel(review.findings.map(f => () =>
      agent(`Adversarially verify: ${f.title}`, {label: `verify:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA})
        .then(v => ({...f, verdict: v}))
    ))
  )
  const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
  return { confirmed }
  // Dimension 'bugs' findings verify while dimension 'perf' is still reviewing. No wasted wall-clock.

Before writing a script, load the `workflow-authoring` skill — the workflow authoring reference: script API and gotchas, resume, the **Ultracode** section, quality patterns, worked examples.

This session has the default workflow size guideline: medium — keep workflows under 10 agents. This is a guideline, not a hard limit — follow it unless the user's prompt calls for a different scale. The user can raise or remove it with "Dynamic workflow size" in /config.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `script` | string | — | Self-contained workflow script. Must begin with `export const meta = { name, description, phases }` (pure literal, no computed values) followed by the script body using a |
| `name` | string | — | Name of a predefined workflow (built-in or from .claude/workflows/). Resolves to a self-contained script. |
| `description` | string | — | Ignored — set the workflow description in the script's `meta` block. |
| `title` | string | — | Ignored — set the workflow title in the script's `meta` block. |
| `args` | — | — | Optional input value exposed to the script as the global `args`, verbatim. Pass arrays/objects as actual JSON values, NOT as a JSON-encoded string — a stringified list br |
| `scriptPath` | string | — | Path to a workflow script file on disk. Every Workflow invocation persists its script under the session directory and returns the path in the tool result. To iterate, edi |
| `resumeFromRunId` | string | — | Run ID of a prior Workflow invocation to resume from. Completed agent() calls with unchanged (prompt, opts) return their cached results instantly; only edited or new call |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "script": {
      "description": "Self-contained workflow script. Must begin with `export const meta = { name, description, phases }` (pure literal, no computed values) followed by the script body using agent()/parallel()/pipeline()/phase().",
      "type": "string",
      "maxLength": 524288
    },
    "name": {
      "description": "Name of a predefined workflow (built-in or from .claude/workflows/). Resolves to a self-contained script.",
      "type": "string"
    },
    "description": {
      "description": "Ignored — set the workflow description in the script's `meta` block.",
      "type": "string"
    },
    "title": {
      "description": "Ignored — set the workflow title in the script's `meta` block.",
      "type": "string"
    },
    "args": {
      "description": "Optional input value exposed to the script as the global `args`, verbatim. Pass arrays/objects as actual JSON values, NOT as a JSON-encoded string — a stringified list breaks `args.filter`/`args.map` in the script. Use for parameterized named workflows (e.g. a research question)."
    },
    "scriptPath": {
      "description": "Path to a workflow script file on disk. Every Workflow invocation persists its script under the session directory and returns the path in the tool result. To iterate, edit that file with Write/Edit and re-invoke Workflow with the same `scriptPath` instead of re-sending the full script. Takes precedence over `script` and `name`.",
      "type": "string"
    },
    "resumeFromRunId": {
      "description": "Run ID of a prior Workflow invocation to resume from. Completed agent() calls with unchanged (prompt, opts) return their cached results instantly; only edited or new calls re-run. Same-session only. Stop the prior run first (TaskStop) before resuming.",
      "type": "string",
      "pattern": "^wf_[a-z0-9-]{6,}$"
    }
  },
  "additionalProperties": false
}
```

---

## Write

- `defer_loading`: **false**
- 描述长度: 240 chars
- 必填参数: file_path, content

### 描述（原文）

```text
Writes a file to the local filesystem, overwriting if one exists.

When to use: creating a new file, or fully replacing one you've already Read. Overwriting an existing file you haven't Read will fail. For partial changes, use Edit instead.
```

### 参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `file_path` | string | ✅ | The absolute path to the file to write (must be absolute, not relative) |
| `content` | string | ✅ | The content to write to the file |

### input_schema（原文）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "file_path": {
      "description": "The absolute path to the file to write (must be absolute, not relative)",
      "type": "string"
    },
    "content": {
      "description": "The content to write to the file",
      "type": "string"
    }
  },
  "required": [
    "file_path",
    "content"
  ],
  "additionalProperties": false
}
```
