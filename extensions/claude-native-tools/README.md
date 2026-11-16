# claude-native-tools

First implementation step from
[`docs/research/claude-native-tool-format.md`](../../docs/research/claude-native-tool-format.md).

When the active model id contains `claude`, this extension exposes Claude-native
variants for the currently active pi tools:

- `Read` — Claude Code's `file_path` / `offset` / `limit` schema (pi-supported subset)
- `Write` — Claude Code's native `file_path` / `content` schema and description
- `Bash` — Claude Code's millisecond timeout and `run_in_background` flag
- `TaskOutput` / `TaskStop` — inspect or stop a background Bash task by `task_id`
- `Edit` — Claude Code's native `file_path` / `old_string` / `new_string` / `replace_all` schema
- `Grep` — Claude Code's native ripgrep-style schema

> pi's default active tools are `read` / `bash` / `edit` / `write`, so
> `Read` / `Write` / `Bash` / `Edit` are covered by default. `grep` is not active
> by default; enable it with `--tools +grep` (or `defaultTools` in settings) if
> you want the Claude-native `Grep` profile as well.

The tool catalog is generated from
[`docs/data/tools.json`](../../docs/data/tools.json) by
[`scripts/generate-claude-tools.mjs`](../../scripts/generate-claude-tools.mjs).

## What it does

- Switches the active tool set between `read` / `write` / `bash` / `edit` / `grep`
  and the Claude-native names based on the model id.
- Reuses pi's existing tool execution paths through `ctx.executeTool()`. No
  second filesystem, shell, or ripgrep implementation.
- Translates the whole conversation before each request:
  - pi tool calls become Claude calls for Claude models
  - Claude calls become pi calls for non-Claude models
  - one pi `edit` with `edits[]` becomes multiple Claude `Edit` calls
  - multiple Claude `Edit` calls stay separate and are never merged into one
    pi `edits[]` call
- The Claude adapters preserve their original arguments in the session so the
  matching result can reflect `Edit.replace_all` and `Grep.output_mode`. The
  conversation translator also accepts sessions stored with pi tool names.
- The adapters format the returned text after the pi tool runs. `Read` numbers
  text lines from the requested offset. `Edit` and `Write` confirm the type of
  change. `Grep` defaults to matching file paths and supports `content` mode.
  Foreground `Bash` puts a nonzero exit code before the combined output.
- `Edit.replace_all: true` delegates one pi `edit` whose `oldText` spans the
  first through last occurrence and whose `newText` replaces each occurrence.
- `Write` uses Claude Code's native description and schema verbatim, including
  its stricter wording: `file_path` must be absolute, and overwriting an
  existing file requires a prior `Read`. pi's `write` is more permissive (it
  accepts relative paths and does not require a prior read). The stricter CC
  wording is deliberately kept as prompt guidance; this first step does not add
  an execution-time absolute-path or read-before-write guard.

## Run

```bash
pi -e ./extensions/claude-native-tools/index.ts
```

Or install the local package:

```bash
pi install ./ 
```

For a local test without a provider call:

```bash
pi -e ./extensions/claude-native-tools/index.ts --list-models
```

## Background Bash

Set `run_in_background: true` to receive a task ID immediately. Pass `task_id`
to `TaskOutput` for the current status and captured stdout and stderr. Call
`TaskStop` to request cancellation. Once the process exits, the session sends
the model a completion message with the task ID and status, starting a turn if
the model is idle or queuing a follow-up if it is busy.

The background `timeout` defaults to 600,000 ms and accepts up to 7,200,000 ms.
Task records stay in memory for the running session. Exiting, switching, or
reloading the session cancels outstanding tasks and clears their records. Keep
a TUI or RPC session open to receive completion notifications between turns.

## Known limitations

These are intentionally left for later phases so the first step stays small:

- `Write` keeps Claude Code's stricter prompt, but the adapter and the base pi
  `write` path do not enforce absolute paths or read-before-overwrite. Those are
  prompt-level constraints, not execution-level constraints yet.
- `Read` intentionally exposes only pi-supported fields: no `pages` / PDF
  selection and no `allow_large`. Its prompt is trimmed accordingly.
- `Bash` uses pi's existing shell configuration and permissions for both modes.
  The captured `dangerouslyDisableSandbox` field has no effect in this extension.
- `Grep` supports `files_with_matches` and `content`. The output is subject to
  pi's search limits. The `count` mode and the `-o`, `type`, `offset`, and
  `multiline` fields are unsupported. `-A` and `-B` use pi's symmetric context
  window.
- The extension gates only on `ctx.model.id` matching `/claude/i`; it does not
  inspect the provider API or the outbound HTTP payload.

## Test

```bash
npm test
```

The translation module has no pi runtime imports and is tested with plain
`node --test`.
