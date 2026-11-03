# 内置 Skills

> Claude Code `2.1.316` · 由 `scripts/build-docs.mjs` 自动生成 · 请勿手改

Claude Code `2.1.316` 自带 **12** 个 skill。抓取方式：让 mock API 返回
`Skill` 工具调用，并且用 `--dangerously-skip-permissions`（否则有副作用的 skill 会被权限系统直接拒绝）。
skill 正文会作为 `tool_result` 之后的 `text` block 注入同一条消息——和 pi 注入 skill 内容的方式本质相同。

正文逐字保存在 [`docs/skills/`](skills/)。

| Skill | 文件 | 大小(chars) | 首行 |
| --- | --- | --- | --- |
| `claude-api` | [claude-api.md](skills/claude-api.md) | 108306 | Base directory for this skill: C:\Users\36026\AppData\Local\Temp |
| `dataviz` | [dataviz.md](skills/dataviz.md) | 7223 | Base directory for this skill: C:\Users\36026\AppData\Local\Temp |
| `fewer-permission-prompts` | [fewer-permission-prompts.md](skills/fewer-permission-prompts.md) | 7647 | Look through my transcripts' MCP and bash tool calls, and based  |
| `init` | [init.md](skills/init.md) | 1593 | Please analyze this codebase and create a CLAUDE.md file, which  |
| `keybindings-help` | [keybindings-help.md](skills/keybindings-help.md) | 14951 | Create or modify `~/.claude/keybindings.json` to customize keybo |
| `loop` | [loop.md](skills/loop.md) | 8144 | The user invoked `/loop` with no prompt and no interval. Run the |
| `plugin-authoring` | [plugin-authoring.md](skills/plugin-authoring.md) | 9201 | Base directory for this skill: C:\Users\36026\AppData\Local\Temp |
| `run` | [run.md](skills/run.md) | 3330 | Base directory for this skill: C:\Users\36026\AppData\Local\Temp |
| `security-review` | [security-review.md](skills/security-review.md) | 10621 | You are a senior security engineer conducting a focused security |
| `simplify` | [simplify.md](skills/simplify.md) | 2817 | `/simplify → 4 cleanup agents in parallel → apply the fixes` |
| `update-config` | [update-config.md](skills/update-config.md) | 299097 | Modify Claude Code configuration by updating settings.json files |
| `workflow-authoring` | [workflow-authoring.md](skills/workflow-authoring.md) | 16967 | A workflow structures work across many agents — to be comprehens |

## Skill 调用协议（重要）

```text
assistant: tool_use { name: "Skill", input: { skill: "init", args?: string } }
user     : tool_result "Launching skill: init"
           + text block = SKILL.md 正文（同一轮注入）
```

- 有副作用的 skill 在 `--print` 下会被权限系统拒绝，返回 `Execute skill: X` + `is_error: true`。
- 部分 skill 声明了 `allowedTools`，执行期间工具集会被收窄。

---
## 附：skill 正文不是静态的

- 正文里的 shell 注入语法（`!` + 反引号包住的命令）会在**注入前先执行**：
  `security-review` 就是靠 `!git diff --name-only origin/HEAD...` 填 GIT STATUS / FILES MODIFIED 两段，
  所以同一个 skill 在不同仓库状态下正文不同。
- 开头常见 `Base directory for this skill: …` 前缀，指向运行时临时目录（环境相关）。
- `security-review` 在非 git 目录下只返回一句「需要在 git 仓库里跑」（506 chars）；
  这里保存的是在 git 仓库里跑出来的完整版（10.6K）。