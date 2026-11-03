# claude-native-tools

First implementation step from
[`docs/research/claude-native-tool-format.md`](../../docs/research/claude-native-tool-format.md).

When the active model id contains `claude`, this extension exposes Claude-native
variants for the currently active pi tools:

- `Read` — Claude Code's `file_path` / `offset` / `limit` schema (pi-supported subset)
- `Write` — Claude Code's native `file_path` / `content` schema and description
- `Bash` — Claude Code's native milliseconds timeout and background/sandbox fields
- `Edit` — Claude Code's native `file_path` / `old_string` / `new_string` / `replace_all` schema
- `Grep` — Claude Code's native ripgrep-style schema

> pi's default active tools are `read` / `bash` / `edit` / `write`, so
> `Read` / `Write` / `Bash` / `Edit` are covered by default. `grep` is not active
> by default; enable it with `--tools +grep` (or `defaultTools` in settings) if
> you want the Claude-native `Grep` profile as well.

The tool descriptions and JSON schemas are generated verbatim from
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
- Session JSONL always stores pi's native/base shape. `message_end` normalizes
  Claude tool calls back to `read` / `write` / `bash` / `edit` / `grep` before
  pi persists the assistant message and dispatches tools. Claude names are only
  a request-time projection.
- The registered Claude tools also have adapters that delegate to
  `ctx.executeTool()` as a fallback for direct/API calls; normal model calls
  are normalized to pi base first.
- `Edit.replace_all: true` is converted into one base pi `edit` whose
  `oldText` spans the first through last occurrence and whose `newText`
  replaces every occurrence in that span. This keeps JSONL in pi's native
  `edit` shape instead of falling back to `write`.
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

## Known limitations

These are intentionally left for later phases so the first step stays small:

- `Write` keeps Claude Code's stricter prompt, but the adapter and the base pi
  `write` path do not enforce absolute paths or read-before-overwrite. Those are
  prompt-level constraints, not execution-level constraints yet.
- `Read` intentionally exposes only pi-supported fields: no `pages` / PDF
  selection and no `allow_large`. Its prompt is trimmed accordingly.
- `Bash.run_in_background` is still unsupported; normal model calls drop it
  when normalized to pi base.
- `Grep` supports the common fields (`pattern`, `path`, `glob`, `-i`, `context`,
  `-C`, `-A`, `-B`, `head_limit`); `output_mode`, `-o`, `type`, `offset`, and
  `multiline` are not supported. `-A` / `-B` are approximated with pi's single
  symmetric `context` window.
- The extension gates only on `ctx.model.id` matching `/claude/i`; it does not
  inspect the provider API or the outbound HTTP payload.

## Test

```bash
npm test
```

The translation module has no pi runtime imports and is tested with plain
`node --test`.
