# 运行时清单 (SDK init message)

> Claude Code `2.1.316` · 由 `scripts/build-docs.mjs` 自动生成 · 请勿手改

`--output-format stream-json` 的第一条消息是 `{"type":"system","subtype":"init"}`。
它是 Claude Code 对「我是谁、我有什么能力」的完整自述——做兼容时这是最好的对照表。

机器可读原文：[`data/init.json`](data/init.json)

## tools（24）

`Task`、`Bash`、`CronCreate`、`CronDelete`、`CronList`、`Edit`、`EnterWorktree`、`ExitWorktree`、`Glob`、`Grep`、`ListAgents`、`Monitor`、`NotebookEdit`、`Read`、`ReportFindings`、`ScheduleWakeup`、`SendMessage`、`Skill`、`TaskStop`、`ToolSearch`、`WebFetch`、`WebSearch`、`Workflow`、`Write`

> 注意：API 请求里实际叫 `Agent`，init 里叫 `Task`（旧名保留）。

## agents（5）

`claude`、`Explore`、`general-purpose`、`Plan`、`statusline-setup`

## plugins

- `cc-plugin-agents-md` — path: `builtin`, source: `cc-plugin-agents-md@builtin`
- `cc-plugin-plugin-authoring` — path: `builtin`, source: `cc-plugin-plugin-authoring@builtin`

## skills（53）

`ask-matt`、`claude-handoff`、`code-review`、`codebase-design`、`diagnosing-bugs`、`domain-modeling`、`git-guardrails-claude-code`、`grill-me`、`grill-with-docs`、`grilling`、`handoff`、`implement`、`implement-spec`、`improve-codebase-architecture`、`loop-me`、`migrate-to-shoehorn`、`prototype`、`research`、`resolving-merge-conflicts`、`retro`、`scaffold-exercises`、`setup-matt-pocock-skills`、`setup-pre-commit`、`setup-ts-deep-modules`、`taste-skill`、`tdd`、`teach`、`to-questionnaire`、`to-spec`、`to-tickets`、`triage`、`wait-what`、`wayfinder`、`wizard`、`writing-beats`、`writing-for-agents`、`writing-fragments`、`writing-shape`、`deep-research`、`dataviz`、`update-config`、`verify`、`debug`、`simplify`、`batch`、`fewer-permission-prompts`、`doctor`、`loop`、`claude-api`、`workflow-authoring`、`run`、`run-skill-generator`、`plugin-authoring`

## slash_commands（81）

`/ask-matt`、`/claude-handoff`、`/code-review`、`/codebase-design`、`/diagnosing-bugs`、`/domain-modeling`、`/git-guardrails-claude-code`、`/grill-me`、`/grill-with-docs`、`/grilling`、`/handoff`、`/implement`、`/implement-spec`、`/improve-codebase-architecture`、`/loop-me`、`/migrate-to-shoehorn`、`/prototype`、`/research`、`/resolving-merge-conflicts`、`/retro`、`/scaffold-exercises`、`/setup-matt-pocock-skills`、`/setup-pre-commit`、`/setup-ts-deep-modules`、`/taste-skill`、`/tdd`、`/teach`、`/to-questionnaire`、`/to-spec`、`/to-tickets`、`/triage`、`/wait-what`、`/wayfinder`、`/wizard`、`/writing-beats`、`/writing-for-agents`、`/writing-fragments`、`/writing-shape`、`/deep-research`、`/dataviz`、`/update-config`、`/verify`、`/debug`、`/simplify`、`/batch`、`/fewer-permission-prompts`、`/doctor`、`/loop`、`/claude-api`、`/workflow-authoring`、`/run`、`/run-skill-generator`、`/plugin-authoring`、`/agents`、`/auto-mode-setup`、`/autocompact`、`/clear`、`/color`、`/compact`、`/config`、`/output-style`、`/context`、`/effort`、`/fast`、`/focus`、`/heapdump`、`/init`、`/mcp`、`/model`、`/__remote-workflow`、`/workflow-launch-exec`、`/reload-plugins`、`/reload-skills`、`/rename`、`/security-review`、`/usage`、`/insights`、`/recap`、`/goal`、`/list-agents`、`/team-onboarding`

## capabilities

`interrupt_receipt_v1`、`interrupt_cancel_queued_v1`、`interrupt_send_now_v1`、`interrupt_requeue_taken_v1`、`msg_lifecycle_v1`、`request_marker_lists_v1`、`ask_user_question_unanswered_v1`、`lifecycle_wakeup_source_v1`、`sdk_mcp_tools_list_changed`、`sdk_mcp_manifests`、`mcp_read_resource_v1`、`mcp_tool_ui_meta_v1`、`ui_surface_v1`、`mcp_call_result_not_for_model_v1`

## 其他字段

```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "C:\\Users\\36026\\Documents\\Github\\pi-claude-code\\.work\\scratch",
  "session_id": "ef96c476-8b6e-4ace-befc-9248e2f388bb",
  "mcp_servers": [],
  "model": "claude-opus-5-5",
  "permissionMode": "plan",
  "terminal_slash_commands": [
    "doctor",
    "color",
    "focus",
    "reload-plugins"
  ],
  "apiKeySource": "ANTHROPIC_API_KEY",
  "claude_code_version": "2.1.316",
  "output_style": "default",
  "analytics_disabled": true,
  "product_feedback_disabled": true,
  "uuid": "ef15e57e-843c-4fa1-802f-0aba7df45b8c",
  "memory_paths": {
    "auto": "C:\\Users\\36026\\Documents\\Github\\pi-claude-code\\.work\\home\\.claude\\projects\\C--Users-36026-Documents-Github-pi-claude-code--work-scratch\\memory\\"
  },
  "original_cwd": "C:\\Users\\36026\\Documents\\Github\\pi-claude-code\\.work\\scratch",
  "additional_directories": [
    "C:/Users/36026/Documents/Github/pi-claude-code/.work/scratch"
  ],
  "messaging_socket_path": "\\\\.\\pipe\\LOCAL\\cc-msg-d60c9e27f1150e8852e56853b0011d0a",
  "fast_mode_state": "off",
  "fast_mode_disabled_reason": "sdk_opt_in_required",
  "per_turn_effort_active": true,
  "ultrathink_available": false,
  "view_mode": "default",
  "powershell_path": "C:\\Users\\36026\\AppData\\Local\\Microsoft\\WindowsApps\\Microsoft.PowerShell_8wekyb3d8bbwe\\pwsh.exe"
}
```

---
