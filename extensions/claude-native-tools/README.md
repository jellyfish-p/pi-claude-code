# claude-native-tools

A pi tool profile with Claude Code names and supported parameter contracts.
Requires Node.js >=22.19.0 and pi >=1.6.0 <1.7.0. Compatibility tests target pi 1.6.0 and 1.6.1.

| Claude tool | pi counterpart | Execution |
| --- | --- | --- |
| Read | read | Delegates through `ctx.executeTool()` |
| Write | write | Delegates through `ctx.executeTool()` |
| Bash | bash | Delegates through `ctx.executeTool()` |
| Edit | edit | Delegates through `ctx.executeTool()` |
| Grep | grep | Delegates through `ctx.executeTool()` |
| Glob | find | Independent Claude-compatible file search; history is translated |
| TaskOutput / TaskStop | — | Controls this extension's background Bash tasks |

Only currently enabled tool families are adapted. pi's default tools cover Read, Write, Bash and Edit. Add search tools with `--tools +grep,+find` or through pi's `defaultTools` setting. A strict replacement allowlist must allow both names, for example `--tools read,Read,find,Glob`. The extension respects pi's allowlists and disabled tools; it does not grant additional capabilities.

## Run and configure

```bash
npm ci
pi -e ./extensions/claude-native-tools/index.ts
pi --claude-tools=off
pi --claude-tools=force
pi --claude-tools-model-pattern="claude|my-model"
```

`auto` is the default and matches model IDs against the case-insensitive pattern `claude`. `off` uses pi names; `force` enables the Claude profile for other IDs, including model aliases. Invalid modes fall back to off; an invalid regular expression disables automatic activation and appears in diagnostics.

Use `/claude-tools status` for the pi version, effective mode, current tools, host-filtered aliases and known capability limits. `/claude-tools auto`, `/claude-tools off` and `/claude-tools force` change the loaded session's mode. After extension reload or session replacement, startup flags apply again. Diagnostics do not record prompts or tool arguments. Loader errors remain the source of truth for conflicts with other extensions.

When the npm package is already installed, disable automatic discovery before loading a local copy to avoid duplicate registrations. This also disables other discovered extensions:

```bash
pi --no-extensions --no-mcp -e ./extensions/claude-native-tools/index.ts --list-models
```

This checks extension loading without making a provider request.

## Contracts and history

The catalog is generated from [`docs/data/tools.json`](../../docs/data/tools.json) by [`scripts/generate-claude-tools.mjs`](../../scripts/generate-claude-tools.mjs). Captured source data is preserved; generated descriptions and schemas are trimmed to the adapter's actual capabilities.

- Read supports `file_path`, `offset` and `limit`, including pi's image reads. Text lines are numbered. PDF page selection and `allow_large` are not exposed.
- Write keeps Claude Code's path/content schema and prompt guidance about absolute paths and reading before overwrite. Those stricter constraints are guidance; pi's execution still accepts relative paths and does not require a prior read.
- Edit supports single replacements and `replace_all`. The latter constructs one pi edit spanning the first through last occurrence. Path handling is shared with the other adapters, including `file://`, `@` and `~` forms.
- Foreground Bash uses millisecond timeouts: default 120,000, maximum 600,000. Invalid or excessive values are rejected. Shell choice, working-directory behavior and permission hooks remain pi's. No sandbox override is exposed.
- Grep exposes `files_with_matches` and `content`, plus `path`, `glob`, `-i`, `-n`, symmetric `context`/`-C`, and `head_limit`. Unsupported `count`, `type`, `offset`, `multiline`, `-o`, `-A` and `-B` are excluded. Both modes use pi's bounded content search: many matches in one file may exhaust its budget before every matching file is found. Truncation notices remain visible.

Before each model request, conversation calls and matching result names are projected into the selected profile and its actually available aliases. A host-filtered alias leaves that tool's history in pi form; other available aliases still use Claude form. Session storage keeps original calls. One pi `edit` with `edits[]` expands to separate Claude Edit calls with unique IDs; separate Edit calls stay separate on the return projection. Legacy calls that cannot be faithfully converted retain their original name and arguments. Historical calls are not re-executed.

## Glob and find compatibility

Glob uses a separate filesystem backend to match the verified default behavior of Claude Code **2.1.316**. It does not call or replace pi's find implementation. The outer Glob call goes through pi's tool hooks before any directory is read.

- Includes hidden and gitignored files; returns files, not directories.
- Does not traverse directory symlinks.
- A basename pattern such as `*.ts` matches at every depth, case-sensitively.
- Relative patterns containing a slash match paths relative to the session working directory. `path` limits enumeration for these relative patterns.
- A positive absolute pattern determines its own search directory and takes precedence over `path`, matching the reference CLI behavior. Negated patterns keep the specified search scope.
- Returns paths relative to the session working directory, sorted by modification time from oldest to newest. At most 100 files are returned, with a truncation notice and structured status when there are more matches.
- Cancellation is checked during traversal. A missing or non-directory explicit search path, or null bytes, is an error. A nonexistent directory derived from a positive absolute pattern yields no matches.

These choices were checked against the repository's reference binary using local mock API responses, including nested patterns, hidden/ignored files, mtime order, case sensitivity, absolute paths and more than 100 matches. They describe this pinned reference, not every Claude Code version or its permission/configuration system. Claude-specific environment switches for hidden files and ignore handling are not imported into pi.

`find ↔ Glob` call and result-name translation remains available in history. The pi-only `find.limit` field is omitted from a Glob historical projection; the original stored call and result remain intact. In non-Claude mode, find continues to use pi's own ignore rules, limits and execution path.

## Background Bash

`run_in_background: true` returns a task ID immediately. TaskOutput reads its status and captured output; TaskStop requests cancellation. Completion sends a message, starting a turn when idle or queuing a follow-up when the agent is busy.

Background timeouts default to 600,000 ms and accept up to 7,200,000 ms. Task records stay in memory for the running session. Exiting, replacing, forking or reloading the session cancels outstanding tasks and clears their records. Keep a TUI or RPC session running to receive completion notifications between turns. TaskOutput and TaskStop are this adapter's task controls; their contracts are not a claim to match every current Claude Code task interface.

## Validation

```bash
npm ci
npm test
npm run test:integration
npm run generate:claude-tools
git diff --exit-code -- extensions/claude-native-tools/catalog.ts
```

Tests cover pure translation and formatting, runtime contracts, Glob behavior, mode selection, real pi extension execution with local fake providers, capture tooling and release integrity. CI checks Windows and Ubuntu with the supported Node/pi combinations. No real model credentials are needed.

The historical design is in [`claude-native-tool-format.md`](../../docs/research/claude-native-tool-format.md). For current capture and catalog-diff commands, see [`scripts/capture/README.md`](../../scripts/capture/README.md).
