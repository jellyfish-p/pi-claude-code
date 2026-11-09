# Claude Code 逆向参考（用于提升 Claude 在 pi 里的兼容性）

把 Anthropic **Claude Code `2.1.316`**（npm `@anthropic-ai/claude-code`，2026-10-30 构建）里
**真正发给模型的东西**全部挖出来，存成可以直接照抄的文档。

不是"看源码猜"，而是**让 Claude Code 自己把请求打到本地 mock API 上**，然后把请求体原样落盘：

```text
Claude Code (bin/claude.exe)
      │  ANTHROPIC_BASE_URL=http://127.0.0.1:8790
      ▼
mock /v1/messages  ──►  抓下完整 body（system / tools / messages）
      │
      └──►  按剧本返回 tool_use（ToolSearch / Skill / Agent），逼出下一层内容
```

因此下面的文本都是**逐字**的：系统提示词、25 个工具的 description + JSON Schema、
5 个内置子代理的提示词、12 个内置 skill 正文、API 请求封装。

---

## 目录

| 文件 | 内容 |
| --- | --- |
| [01-system-prompt.md](01-system-prompt.md) | 主 `system` 数组原文（3 个 block），含计费头 |
| [02-environment-block.md](02-environment-block.md) | `role: "system"` 的环境块：工具/代理/skill 清单都在这 |
| [03-tool-catalog.md](03-tool-catalog.md) | **25 个工具**：描述原文 + 参数表 + input_schema |
| [04-subagents.md](04-subagents.md) | 5 个内置子代理（claude / Explore / Plan / general-purpose / statusline-setup） |
| [05-skills.md](05-skills.md) | 12 个内置 skill 的索引与调用协议 |
| [06-api-request-shape.md](06-api-request-shape.md) | 请求体骨架：`thinking` / `context_management` / `metadata` / 延迟加载协议 |
| [07-inventory.md](07-inventory.md) | SDK `init` 消息：24 个工具、53 个 skill、全部斜杠命令、capabilities |
| [08-gated-tools.md](08-gated-tools.md) | 没被启用的内置工具（TodoWrite 等）+ TodoWrite 提示词原文 |
| [09-pi-compat-notes.md](09-pi-compat-notes.md) | **落到 pi 的具体改法**：工具映射、提示词怎么拼、哪些地方别自作聪明 |
| [npm-publishing.md](npm-publishing.md) | npm 包内容、GitHub Actions 发布和 Trusted Publisher 配置 |
| [research/](research/) | 专题研究与实施计划（如 Claude 模型的原生工具格式） |
| [skills/](skills/) | 12 个内置 skill 的逐字正文 |
| [data/](data/) | 机器可读原件（tools.json / init.json / system-prompt.json …） |

项目使用相关的入口说明见根目录 [README.md](../README.md)。

---

## 关键结论（先看这个）

1. **Claude Code 把 `role: "system"` 当成消息发**。工具清单、代理清单、skill 清单、模型自述
   全在 `messages[1]`，不在 `system` 里。这是和大多数 SDK 最大的差异。
2. **工具是延迟加载的**。首轮 `tools` 只有 14 个；其余 11 个只以**名字**列在环境块里，
   模型必须用 `ToolSearch` 换取 schema，之后它们才进入 `tools`（并带 `defer_loading: true`）。
   这直接影响模型的"工具意识"。
3. **工具描述本身就是提示词**。`Bash` 的描述 2.1KB、`Agent` 3.2KB、`Monitor` 6.3KB，
   里面有大量行为规约（引号、sleep、并行、何时委派…）。改名/改写会直接改变行为。
4. **`2.1.316` 里没有 TodoWrite / AskUserQuestion**。它们在 `BUILTIN_TOOL_NAMES` 里存在，
   但被远端 feature gate 关掉，`-p` 路径下根本不会发给模型（见 08）。
5. **子代理的"只读"是 schema 级约束**：`Explore` 的 tools 里根本没有 `Edit`/`Write`。
6. **skill = 一轮注入的 text block**，紧跟 `tool_result "Launching skill: X"`。`--print` 下
   有副作用的 skill 会被权限系统直接拒绝（`Execute skill: X` + `is_error`）。

## 抓取方法（可复现）

工具链在 [`../scripts/`](../scripts/)：

```bash
# 1. 取包（npm 包只是个壳，真正的二进制在平台包里）
npm pack @anthropic-ai/claude-code-win32-x64@2.1.316

# 2. 起 mock API，把 ANTHROPIC_BASE_URL 指过去
node scripts/capture/server.js

# 3. 按剧本触发不同分支（ToolSearch / Skill / Agent / plan mode）
node scripts/capture/orchestrate.js

# 4. 从抓包结果生成 data/ 与本文档
node scripts/collect.mjs && node scripts/build-docs.mjs
```

## 局限（诚实说明）

- 只覆盖 **`-p/--print` 入口**（`cc_entrypoint=sdk-cli`）。交互式 TUI 入口的 `system[0]` 会不同，
  且 TUI 专属工具（`--brief` 的 SendUserMessage 等）没有覆盖。
- 环境块里的日期、路径、模型名、`cc_version` 指纹后缀都是本机快照，非固定值。
- 被 feature gate 关掉的工具，只能给出"名字 + 存在性"，描述只有 TodoWrite 一份是从二进制
  里静态 stitch 出来的（见 08）。
- 版本会变。换版本后请重跑上面的 4 条命令。
