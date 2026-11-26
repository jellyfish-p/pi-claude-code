# 可复现的 Claude Code 抓包与工具差分

Claude Code 的模型 API 指向本地 mock，按场景返回 SSE。请求体保存在 `快照/requests/<run>/`，供 collect 蒸馏和 catalog diff 使用。mock 只监听 `127.0.0.1`，不转发请求，也不保存 HTTP headers。

```text
capture.mjs → 隔离配置的 Claude Code --print → loopback mock
                                             ↓
snapshot/{manifest.json,init.json,inits/,scenarios.json,requests/}
                                             ↓ collect --raw snapshot --docs output
output/{data/,skills/} → build-docs --docs output
```

需要 Node 22 或更新版本。先准备所需平台与版本的 Claude Code **可执行文件**；命令不会下载或安装 Claude Code。本仓库已有二进制时可以直接使用 `.work/bin/package/claude.exe`。不要将真实 API key 放进场景、prompt 或额外参数。

## 一条命令抓取

在仓库根目录执行（PowerShell、bash 都可使用这些单行 Node 命令）：

```powershell
node scripts/capture/capture.mjs --bin .work/bin/package/claude.exe --out .work/snapshots/cc-current
```

默认 `base` profile 会依次抓取 `toolsearch` 和 `plan-mode`。前者先请求 ToolSearch 加载常见延迟工具，再结束；后者使用 `--permission-mode plan`。不同版本可能没有某些工具，最终观察结果以快照为准。命令自动启动随机空闲端口的本地 mock，运行结束或单次调用超时后关闭服务。每个子进程默认最多 90 秒，`--timeout-ms 180000` 可调整。失败返回非零退出码，并在已开始抓取时留下 `status: failed` 的 manifest。

每次使用**新的输出目录**；已有任何内容的目录都会被拒绝，避免混合版本或覆盖历史数据。默认输出是 `data/raw`，因此此仓库已有离线数据时必须传 `--out`。临时 HOME、Claude 配置、AppData、缓存和 scratch 均在新的临时目录中；结束后清理。不会复用 `.work/home` 或宿主 HOME，不继承 API/OAuth token、代理和 `NODE_OPTIONS`。模型 API 使用固定假 key；加上关闭非必要流量、禁用用户/项目 settings 和空 MCP 配置，普通回归不需要真实凭据或付费模型。

版本默认通过同一隔离环境中的 `--version` 获取。需要显式标注外部来源或测试客户端时用 `--version 2.1.316`；manifest 会将来源标为 `declared`。平台默认是 Node 的 `platform-arch`，可用 `--platform win32-x64` 显式标注；实际宿主另记为 `hostPlatform`。目前仅支持 `--entry print`。

```powershell
node scripts/capture/capture.mjs --bin .work/bin/package/claude.exe --out .work/snapshots/read-grep --tools Read,Grep --platform win32-x64
node scripts/capture/capture.mjs --help
```

`--tools` 记录为 `requestedTools`；`enabledTools` 是实际请求体中观察到的工具名并集。各场景的 init 工具清单、各请求工具名和 SHA-256 单独记录，不把请求选项等同于实际工具。manifest 还包含版本、平台、入口、开始/生成时间、执行状态、二进制和脚本摘要、场景摘要、额外参数摘要和所有请求摘要。manifest 不保存环境变量、HTTP headers 或完整命令行。原始请求体、init 和场景本身仍可能包含你主动提供的文件路径或 prompt，分享前应检查。

## 自定义场景与原有批量入口

场景 JSON 格式如下；`run` 必须是简单目录名，不可含路径分隔符。`steps` 在本场景内从 1 计数，超过步数后重复最后一步。

```json
{
  "run": "read-only",
  "prompt": "Say hello.",
  "steps": [
    { "blocks": [{ "type": "text", "text": "ok" }] }
  ]
}
```

```powershell
node scripts/capture/capture.mjs --bin .work/bin/package/claude.exe --scenario path/to/scenario.json --out .work/snapshots/custom
node scripts/capture/capture.mjs --bin .work/bin/package/claude.exe --scenarios path/to/scenarios --out .work/snapshots/suite
```

`--scenario` 可重复，每个文件接受对象或对象数组。`--scenarios` 按文件名读取目录内全部 `.json`。场景的 `args` 数组提供 Claude Code 参数；全局额外参数用重复的 `--arg`，flag 值写为 `--arg=--flag`。`--only TEXT` 按 run 名筛选，`--prompt TEXT` 覆盖 prompt。`--cwd DIR` 可显式使用受控的测试项目；默认是全新空 scratch。`--work DIR` 仅指定临时目录的父目录，仍会创建独立子目录。

旧批量命令保持可用，现已自行启动 mock 并复用统一入口，无需预先起 server：

```powershell
node scripts/capture/orchestrate.js --out .work/snapshots/ordinary
node scripts/capture/orchestrate.js agent-Explore --out .work/snapshots/explore
node scripts/capture/orchestrate2.js --out .work/snapshots/skills-permissive
```

`orchestrate.js` 保留 12 个普通权限 skill 和 5 个 agent 场景（`--profile legacy`）；`orchestrate2.js` 保留一次默认请求和 12 个带 `--dangerously-skip-permissions` 的 skill 场景（`--profile skills-permissive`）。也可单独选择 `--profile agents` 或 `--profile skills`。skill 或 agent 可能运行文件/命令工具，需按实际研究目的选择；默认 base profile 只触发 ToolSearch。涉及仓库状态的 skill 需要显式 `--cwd` 指向你准备的测试仓库；空 scratch 中的 security-review 不能代表其完整内容。

`CC_BIN` 仍可指定二进制，`CC_WORK` 仍可指定旧二进制布局的根目录。二进制默认位于 `<CC_WORK 或 repo/.work>/bin/package/claude.exe`（其他平台为 `claude`）。这些环境变量不会用于复用旧 HOME。`CC_MOCK` 不再参与自带 mock 的单命令流程；独立客户端应直接设置 `ANTHROPIC_BASE_URL`。

bash 的 `run.sh <scenario.json> <prompt> [cwd] [extra claude args...]` 也转发统一入口；使用 `CC_OUT` 指定新的快照目录。

## 蒸馏、文档与差分

```powershell
node scripts/collect.mjs --raw .work/snapshots/cc-current --docs .work/derived/cc-current
node scripts/build-docs.mjs --docs .work/derived/cc-current
node scripts/capture/inspect.js --raw .work/snapshots/cc-current
node scripts/catalog-diff.mjs .work/snapshots/cc-before .work/snapshots/cc-current --out .work/reports/tool-diff.md
node scripts/catalog-diff.mjs .work/derived/cc-before .work/derived/cc-current --format json --out .work/reports/tool-diff.json
```

差分支持原始快照根目录、蒸馏文档根目录、其 `data` 目录或单独的 `tools.json`。报告包含工具增删、字段增删和类型等值变化、各层 `required` 增删、工具和字段 description 变化；对象 key 顺序和 required 顺序不会形成噪音。原始快照中同名工具优先选展开了 schema 的声明，避免被 deferred 占位符覆盖。

collect 和差分读取 raw 时共用工具合并逻辑，合并所有场景和请求中的工具，分别抓 Read、Glob 的场景也会得到同一份完整目录。存在 `toolsearch` 时优先沿用其完整请求中的工具顺序，再补入其他场景独有的工具；system/environment 仍使用一个代表请求。

报告同时展示版本、平台、入口、请求工具、实际工具和时间。平台、入口、请求工具或场景/额外参数摘要不同会明确标出。即使这些字段相同，远端 feature gate 也可能不同；单份快照不能代表所有平台和入口的标准工具集。缺 manifest 的历史数据仍可使用，报告会标注可比性未知。

默认 `node scripts/collect.mjs` 仍读取 `data/raw`、写 `docs/data` 和 `docs/skills`；默认 `node scripts/build-docs.mjs` 仍生成 `docs` 下研究文档。新 manifest 会透传到 `docs/data`，文档版本从 manifest 获取；旧离线数据回退到 init 或 system billing header 的版本，不要求补写 manifest。新快照可以没有 agent、skill、plan-mode 或二进制静态提取文件。

collect 可重复写入同一 `--docs` 目录。固定的 `data` 产物属于生成器；新源不再提供 manifest、init、plan-mode 或静态提取文件时，会同步移除旧文件。`data/.collect-manifest.json` 记录本次生成的文件和摘要，下次只据此清理消失的 agent/skill，其他手写文档保留。build-docs 在存在清单时仅渲染本次登记的 agent/skill，磁盘上保留的未登记文件不会被称为本次版本的内置能力；无清单时仍使用旧目录扫描行为。已被手动修改的清单内文件，以及与新产物重名且内容不同的未登记 agent/skill，会在任何文件写入前报错，需先移走该文件或选择新的 `--docs` 目录。升级前没有产物清单的历史 agent/skill 无法可靠区分手写内容，首次运行会保留它们但不自动纳入新清单。默认历史数据流程继续可用，不要求清空现有 docs。

生成文本、首次迁移的内容比较和产物摘要统一使用 LF 换行。Windows checkout 的 CRLF 与 LF 仅换行差异不会被误认为手动修改；旧清单的原始 LF/CRLF 摘要也可迁移，实际文字变化仍会受到上述保护。

## 单独调试 mock 与离线回归

```powershell
node scripts/capture/server.js --scenario path/to/scenario.json --out .work/manual-capture --port 8790
node --experimental-strip-types --test test/capture.test.ts test/catalog-diff.test.ts
```

单独运行 server 时默认监听 8790、写 `data/raw/requests`；若不提供 `--scenario`，读取 `scripts/capture/scenario.json`，文件不存在则返回默认 `ok`。使用新目录可避免向旧快照追加。`--port 0` 自动选择端口。仅 `POST /v1/messages` 会落盘并消耗场景步骤；`/v1/messages/count_tokens` 返回固定计数，health 和其他路由不消耗步骤。SSE 的 text block 只在 delta 中发送一次文本。

回归测试用临时 Node 假客户端向本地 HTTP 发请求，覆盖隔离环境、来源摘要、实际工具、逐场景计数、失败/超时清理、蒸馏和文档闭环、旧数据兼容和差分，不执行 Claude Code，不下载二进制，不调用付费模型。

`stitch-once.js` 是按二进制偏移静态提取提示词的辅助工具，偏移取决于具体构建，不能跨版本复用。现须显式传 `--start OFFSET --out NEW_FILE [--bin BINARY]`，不会覆盖旧文件。它不属于 HTTP 抓包的必需步骤。
