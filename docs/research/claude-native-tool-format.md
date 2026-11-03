# Claude 模型的原生工具格式：研究与实施计划

> 状态：计划（未实施）
>
> 适用快照：pi `1.4.0`、Claude Code `2.1.316`、本文仓库的抓包 `docs/data/tools.json`
>
> 目标：当会话模型 id 中含 `claude` 时，让 pi 发给 Anthropic Messages 的工具声明更接近 Claude Code 的原生契约；不影响非 Claude 模型。

---

## 0. 结论先说

1. **外层 wire format 已经是原生的。** pi 的 `anthropic-messages` 适配器已经把内部 `Tool` 转成 Anthropic 的
   `{ name, description, input_schema }`，不存在“套了一层 OpenAI function”这种问题。真正缺的是
   **Claude Code 的工具命名、参数 schema、描述文本和 MCP 命名空间**。
2. **pi 目前只在 OAuth token 下做 Claude Code 工具名规范化。** 见 `pi-ai/dist/api/anthropic-messages.js`
   的 `isOAuthToken()` 与 `toClaudeCodeName()`：API key、代理供应商、普通 Claude 模型走的是原始小写名
   （`read` / `bash` / `edit`…），不会变成 `Read` / `Bash` / `Edit`。
3. **pi-ai 内置的 canonical 名单已经过期。** 它基于 Claude Code `2.1.280` / prompts-2.1.11，缺少本仓库
   `2.1.316` 抓到的 `Agent`、`Monitor`、`Workflow`、`Cron*`、`EnterWorktree` 等，反而保留了
   `AskUserQuestion`、`EnterPlanMode`、`TaskOutput` 等旧名。
4. **只改名字不够，甚至可能更危险。** 例如 `read` 的参数是 `path`，Claude Code `Read` 是 `file_path`；
   `edit` 是批量 `edits[]`，Claude Code `Edit` 是单点 `old_string/new_string`；`bash` 的 `timeout`
   单位是秒，Claude Code `Bash` 是毫秒。名字对齐而 schema 不对齐，会直接制造参数错误。
5. **建议分两层落地：先做“名字桥接”，再做“契约适配”。** 第一版只对 schema 可无损转换的工具启用
   canonical 名（优先 `Write`，其次 `Read`/`Glob` 的子集）；`Edit`、`Bash`、`Agent` 等必须等 adapter
   写好后再开。
6. **优先做扩展，不要先改 pi 安装包。** pi 的 `before_provider_request` + `message_end` 足以完成
   出站改名/改 schema、入站反向映射；核心补丁更适合在上游提案，作为第二阶段。
7. **已有先例，但不要照抄它的全部结论。** `@blackbelt-technology/pi-anthropic-messages` 实现了同样的
   `/claude/i` 门控和 wire 改名，但已退役：它的实测显示改名**不影响 Claude 订阅计费**，并且改名在
   “对话中途移除工具”时会触发 400。我们要吸收设计，避开这两个坑。

---

## 1. “原生工具格式”到底指什么

先把三种“格式”拆开，否则容易做错层：

| 层 | 内容 | pi 现状 | 是否需要改 |
| --- | --- | --- | --- |
| 请求封装 | `anthropic-messages` 的 `tools[]`、`input_schema`、`tool_choice`、`tool_use` / `tool_result` | 已由 pi-ai 适配器生成 | 不需要改外层形状 |
| 工具身份 | 工具名大小写、`mcp__<server>__<tool>` 命名空间、canonical Claude Code 名 | 仅 OAuth 路径做 canonical casing；自定义工具不加 MCP 前缀 | **主要缺口** |
| 工具契约 | `description`、`input_schema` 字段、单位、必填项、输出形状 | 仍是 pi 自己的工具契约 | **第二缺口** |

本文把“原生工具格式”定义为：

> 在 `anthropic-messages` 请求中，发给 Claude 模型的工具声明，尽量使用 Claude Code 2.1.316
> 的 canonical 名称、参数 schema 和描述；pi 侧仍用原有工具处理器执行。

**非目标：**

- 不模拟 Claude Code 的延迟加载 / `ToolSearch`。pi 全量给 schema 更简单，`docs/09-pi-compat-notes.md`
  已明确不建议假装有延迟加载。
- 不复制 Claude Code 的整套 system prompt、memory、权限系统。本文只处理工具声明。
- 不为“计费”而改名。已有实测表明工具名不影响订阅计费；如果目标是计费/额度，应另做验证。
- 不改非 `anthropic-messages` 的 API（Bedrock Converse、OpenAI-compatible、Google 等）。

---

## 2. 现状证据

### 2.1 pi 的请求构造路径

pi 的内部工具类型是 provider-neutral 的：

```ts
// pi-ai/dist/types.d.ts
interface Tool {
  name: string;
  description: string;
  parameters: TSchema;       // TypeBox
  constrainedSampling?: ...
}
```

`anthropic-messages` 适配器在 `buildParams()` 里把它转成 Anthropic 形状：

```js
// pi-ai/dist/api/anthropic-messages.js:1298
return {
  name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
  description: tool.description,
  ...(supportsEagerToolInputStreaming ? { eager_input_streaming: true } : {}),
  ...(strict === true ? { strict: true } : {}),
  input_schema: inputSchema,
  ...(cacheControl && index === tools.length - 1 ? { cache_control: cacheControl } : {}),
};
```

关键点：

- `toClaudeCodeName()` 只在 `isOAuthToken === true` 时调用；`isOAuthToken()` 的判断是
  `apiKey.includes("sk-ant-oat")`（`anthropic-messages.js:780`）。
- OAuth 路径还会加 `claude-code-20250219`、`oauth-2025-04-20` beta、Claude Code identity system 文本；
  这些是 **OAuth 身份**，不应该因为模型名含 `claude` 就复制。
- 入站也在 OAuth 下用 `fromClaudeCodeName()` 把 `Read` 之类映射回当前工具名
  （`anthropic-messages.js:500` 附近）。
- `claudeCodeTools` 名单硬编码在 `anthropic-messages.js:47`，当前是 17 个旧名。
- `AnthropicMessagesCompat` 没有“工具命名格式”字段；只有 `supportsEagerToolInputStreaming`、
  `supportsStrictTools`、`supportsMidConvoToolChanges` 等（`pi-ai/dist/providers/compat-schema.d.ts:147`）。
  因此仅靠 `models.json` 无法开启“Claude 原生工具名”。

### 2.2 可用的 pi 扩展钩子

pi 文档（`docs/extensions.md`，在线版 `https://pi.dev/docs/latest/extensions`）给出的请求钩子顺序：

```text
context
context_with_system
before_provider_headers
before_provider_request   ← 可以替换序列化后的 payload
after_provider_response
provider_stream_event
message_start / message_update / message_end
```

其中：

- `before_provider_request` 的 `event.payload` 就是已经转换好的 Anthropic 请求体，可以返回新 payload。
- `message_end` 可以替换最终 assistant message；在工具执行前运行，可把 `toolCall.name` 反向映射。
- `pi.registerTool()` / `pi.setActiveTools()` / `prepareLoadout` 可用于“注册 canonical 工具”的备选方案。
- `pi.getAllTools()` 可用于只映射当前真实存在的工具，避免把未注册的名字映射到处理器。

### 2.3 Claude Code 2.1.316 的工具目录

本仓库抓包得到的 25 个工具名（`docs/data/tools.json`）：

```text
Agent, Bash, CronCreate, CronDelete, CronList, Edit, EnterWorktree, ExitWorktree,
Glob, Grep, ListAgents, Monitor, NotebookEdit, Read, ReportFindings, ScheduleWakeup,
SendMessage, Skill, TaskStop, ToolSearch, WebFetch, WebSearch, Workflow, Write,
DeferredToolPlaceholder
```

与 pi-ai 当前名单的差异：

| 当前 pi-ai 有 | 2.1.316 抓包有 | 说明 |
| --- | --- | --- |
| `Read` `Write` `Edit` `Bash` `Grep` `Glob` `WebFetch` `WebSearch` `Skill` `TodoWrite` `AskUserQuestion` `EnterPlanMode` `ExitPlanMode` `KillShell` `NotebookEdit` `Task` `TaskOutput` | `Read` `Write` `Edit` `Bash` `Grep` `Glob` `WebFetch` `WebSearch` `Skill` `Agent` `Monitor` `Workflow` `Cron*` `EnterWorktree` `ExitWorktree` `ListAgents` `ReportFindings` `ScheduleWakeup` `SendMessage` `TaskStop` `ToolSearch` `NotebookEdit` | 旧名单当作兼容并集保留即可，但不能作为 2.1.316 的唯一事实来源 |

`docs/03-tool-catalog.md` 有每个工具的逐字描述和 schema；`docs/data/tools.json` 是机器可读原件。

### 2.4 先例：blackbelt 的 bridge

`@blackbelt-technology/pi-anthropic-messages` 的设计（pi.dev package 页、GitHub README）：

- 门控最初是 `model.api === "anthropic-messages" && /claude/i.test(model.id)`。
- 出站把 `read/write/bash/grep` 改成 `Read/Write/Bash/Grep`，其余非 canonical 工具改成
  `mcp__pi__<name>`；同时改 `tool_choice.name` 和历史 `tool_use`。
- 入站 `message_end` 用反向 map 改回 pi 名，并防御性剥离服务端追加的 `_ide` 后缀。
- 它明确承认：name alias 不够；`WebSearch`/`WebFetch`/`TaskOutput` 等需要 schema adapter，`AskUserQuestion`
  则因为 pi 的 discriminated union 与 CC 差异太大而放弃。

它的退役说明（CHANGELOG 0.3.5 / README）给我们的三个警告：

1. 改名**不影响 Claude 订阅计费**；如果只是“看起来像 Claude Code”，不要用它来承诺省钱。
2. 改名在“对话中途移除工具”时会触发 **400**；pi 1.4.0 支持 `tool_addition` / `tool_removal`，
   桥接必须处理这些块，而不只是 `tools[]`。
3. 旧版本曾把完整 payload 写到 `/tmp`；任何实现都不能记录 prompt/tool 内容。

---

## 3. 方案比较

| 方案 | 做法 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- | --- |
| A. 改 pi-ai 核心 | 把 `isOAuthToken` 拆成 `useClaudeCodeNames`，Claude 模型也走 `toClaudeCodeName` | 一处生效、无扩展、入站出站一致 | 需要 fork/上游发版；只能改名字，改不了 schema；可能影响 API-key 用户缓存/行为 | 作为上游提案 |
| B. 扩展桥接（推荐） | `before_provider_request` 改 payload，`message_end` 反向映射 | 可灰度、可开关、可做 schema adapter、不动安装包 | 要自己维护映射；要处理历史/工具增删/缓存 | **第一版** |
| C. canonical 工具 profile | 注册 `Read`/`Write`/... 新工具，按模型 `setActiveTools()` 切换 | 名字、描述、schema 都是真原生 | 工具重复、prompt 需同步、执行适配复杂、与其他扩展的 `Agent` 冲突 | 第二阶段备选 |
| D. HTTP 代理 | pi 与上游之间重写 JSON | 与 harness 解耦 | 看不到 pi 内部工具语义、双向映射脆弱、安全面大 | 不推荐 |

**推荐路线：B 先落地，验证后再决定是否把 A 推到上游；C 只在 B 的 schema adapter 不够时启用。**

---

## 4. 推荐设计（扩展桥接）

### 4.1 门控：模型名 + API 形状

不要只看模型名。必须同时确认 wire 是 `anthropic-messages`，否则改的是错误的 payload 形状。

```ts
function shouldUseClaudeTools(payload: any, ctx: ExtensionContext): boolean {
  if (ctx.model?.api !== "anthropic-messages") return false;

  // 优先用真正发出去的 model id；虚拟模型/路由代理下 ctx.model 可能不是最终模型
  const modelId =
    typeof payload?.model === "string" ? payload.model : (ctx.model?.id ?? "");

  return /claude/i.test(modelId);
}
```

用 routing id（`payload.model` / `ctx.model.id`），不要用 `ctx.model.name`；后者是展示名，可能被 catalog 或用户改写。

建议加三个逃生口：

| 配置 | 作用 |
| --- | --- |
| `PI_CLAUDE_NATIVE_TOOLS=off` | 强制关闭 |
| `PI_CLAUDE_NATIVE_TOOLS=force` | 即使模型名不匹配也开启（仅限 `anthropic-messages`） |
| `PI_CLAUDE_NATIVE_TOOLS_MODEL_RE=<regex>` | 覆盖默认 `/claude/i`，用于 `c4-omega` 之类别名 |

不要对 `bedrock-converse-stream` 或 `openai-completions` 下的 Claude 启用；它们的工具封装不同。

### 4.2 出站名字解析优先级

只在门控打开时执行。顺序建议：

```text
1. 已经是 canonical 精确名（Read/Write/Agent…）        → 原样
2. 已经是 mcp__*                                     → 原样
3. 显式 native alias（需 schema adapter 验证）          → canonical 名
4. pi core 名且 schema 可适配                         → canonical 名
5. 其他自定义工具                                     → mcp__pi__<name>（可选）
6. 其他情况                                          → 原名
```

第 5 步要谨慎：`mcp__pi__` 是 Claude Code 订阅端点的约定，不是标准 Anthropic API 的要求。
建议只在以下情况启用：

- OAuth / Claude Code 订阅端点；
- 明确知道代理会剥离未知 flat 工具；
- 用户显式开启 `PI_CLAUDE_NATIVE_MCP_PREFIX=1`。

标准 API key 直连 Anthropic 时，自定义工具保持原名即可，避免无谓的 prompt cache 变化。

### 4.3 schema binding：名字和参数必须一起换

为每个要 canonical 化的工具定义 binding：

```ts
interface ToolBinding {
  piName: string;                 // read
  wireName: string;               // Read
  strategy: "passthrough" | "hybrid" | "canonical";
  wireSchema?: TSchema;           // 发给模型的 schema
  toWire?: (piArgs: any) => any;  // 历史 tool_use 回放时可选
  fromWire: (wireArgs: any) => any; // 模型调用 → pi handler
  adaptOutput?: (result: any) => any;
}
```

策略含义：

- `passthrough`：名字换，schema 用 pi 的。只适合 schema 完全一致的工具。
- `hybrid`：wire schema 暴露 canonical 字段 + 少量 pi 扩展；`fromWire` 归一化。
- `canonical`：只暴露 CC schema；必须提供 `fromWire`，不支持的字段要拒绝或忽略并告知模型。

**优先只对可无损转换的工具开 canonical：**

| Claude Code 2.1.316 | pi 1.4.0 | schema 差异 | 第一版建议 |
| --- | --- | --- | --- |
| `Write` (`file_path`, `content`) | `write` (`path`, `content`) | 仅参数名不同 | **可开**，`file_path → path` |
| `Read` (`file_path`, `offset`, `limit`, `pages`, `allow_large`) | `read` (`path`, `offset`, `limit`) | `path` vs `file_path`；pi 不支持 `pages`/`allow_large` | 先开 hybrid 子集 `file_path/offset/limit`；`pages` 不广告 |
| `Glob` (`pattern`, `path`) | `find` (`pattern`, `path`, `limit`) | 基本一致，多一个 `limit` | 可开 hybrid；`limit` 可选 |
| `Grep` (`pattern`, `path`, `glob`, `output_mode`, `-A/-B/-C`, `-i`, `head_limit`, …) | `grep` (`pattern`, `path`, `glob`, `ignoreCase`, `literal`, `context`, `limit`) | CC 参数多，语义有重叠 | 先开 hybrid 子集；不要声称完整 CC Grep |
| `Bash` (`command`, `timeout` ms, `description`, `run_in_background`, `dangerouslyDisableSandbox`) | `bash` (`command`, `timeout` s) | **单位不同**，pi 无后台/沙箱参数 | 暂缓；至少做 ms↔s 转换并忽略缺失能力 |
| `Edit` (`file_path`, `old_string`, `new_string`, `replace_all`) | `edit` (`path`, `edits[]`) | 单点 vs 批量；`replace_all` 无直接对应 | 暂缓；需要专门 adapter 或独立 `Edit` 工具 |
| `Agent` (`description`, `prompt`, `subagent_type`, `model`, `effort`, `run_in_background`, `isolation`) | pi `Agent`（字段接近） | 需按实际注册 schema 核对 | 核对后再开；不要假设 |
| `TodoWrite` | `manage_todo_list` | 状态集合接近，参数结构不同 | 不开；走 MCP 名 |
| `AskUserQuestion` | `ask_user` | CC 扁平 questions/options；pi discriminated union | 明确不开 |
| `WebSearch` / `WebFetch` | `web_search` / `fetch_content` | CC 是严格子集，pi 额外支持多 query/多 URL | 可做 hybrid，但第一版不开 |
| `Skill` | 无（pi 直接读 SKILL.md） | 语义不同 | 不开 |
| `Monitor` / `Workflow` / `Cron*` / `SendMessage` … | 部分有 pi 对应 | 语义/参数差异大 | 不开；不要广告不存在的工具 |

> `docs/03-tool-catalog.md` 与 `docs/data/tools.json` 是 CC 侧事实来源；不要凭记忆写 schema。
>
> 另一个容易漏的点：CC 的 `Read`/`Write`/`Edit` 要求**绝对路径**，pi 的 `path` 支持相对路径。
> adapter 不能只把 `file_path` 改成 `path`；要么按 `ctx.cwd` 解析，要么明确拒绝相对路径，否则同一个名字下的路径语义并不一致。

### 4.4 出站 transform 必须覆盖所有工具名出现的位置

`payload.tools[]` 只是其中一处。至少处理：

```text
payload.tools[].name
payload.tools[].description              // 仅 binding 有 canonical 描述时
payload.tools[].input_schema             // binding 有 wireSchema 时
payload.tool_choice.name
payload.messages[].content[].type=tool_use      .name（历史回放）
payload.messages[].content[].type=tool_result   .content[].type=tool_reference .name
payload.messages[].content[].type=tool_addition .tool.definition.name
payload.messages[].content[].type=tool_removal  .tool.name
```

其中 `tool_addition` / `tool_removal` 是 pi 1.4.0 在 `supportsMidConvoToolChanges` 模型上会发的
原生工具变更块（见 `anthropic-messages.js:1042` 附近）。**只改 `tools[]` 不改这里，就是 blackbelt
遇到的 400 来源之一。**

替换 schema 时保留 pi 已经加上的字段：

- `eager_input_streaming`
- `strict`
- `cache_control`（只在最后一个工具上）

不要重排 `tools[]`；Anthropic 的 cache breakpoint 和模型对工具顺序的感知都可能受影响。

### 4.5 入站 transform

`message_end` 里对 assistant message 的 `toolCall` 块做两件事：

1. `name`：按反向 map 改回 pi 注册名；容忍服务端追加的 `_ide` 后缀。
2. `arguments`：如果 binding 有 `fromWire`，把 canonical 参数改回 pi 参数。

反向 map 必须由 `pi.getAllTools()` 当前注册名构建，避免把 `Read` 映射到一个不存在的 `read` handler。
对未识别的名字保持原样，让 pi 自己报错，而不是猜。

### 4.6 配置与可观测性

建议第一版暴露：

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `PI_CLAUDE_NATIVE_TOOLS` | `auto` | `off` / `auto` / `force` |
| `PI_CLAUDE_NATIVE_TOOL_CONTRACTS` | `safe` | `names`（只改名）/ `safe`（仅无损 adapter）/ `all`（实验） |
| `PI_CLAUDE_NATIVE_MCP_PREFIX` | `auto` | 仅 OAuth/显式开启时给自定义工具加 `mcp__pi__` |
| `PI_CLAUDE_NATIVE_DEBUG` | `0` | 只输出“工具名映射表”，绝不输出 prompt/参数内容 |

日志只记录：模型 id、API、工具名映射、跳过的工具、adapter 名称。不要记录 payload。

### 4.7 建议的代码位置

本仓库目前是抓包/文档仓库，不建议把运行时扩展塞进这里。若要做成 pi 扩展，建议独立包：

```text
pi-claude-native-tools/
  src/index.ts          // gate + before_provider_request + message_end
  src/names.ts          // canonical 名单、优先级、反向 map
  src/bindings.ts       // ToolBinding + schema adapters
  src/transform.ts      // 出站 payload 深拷贝/改写
  src/inbound.ts        // 入站 name/args 映射
  test/                 // 纯函数单测 + mock payload 集成测试
```

本仓库只保留 `docs/research/` 下的结论和 `docs/data/tools.json` 作为 schema 事实来源。

---

## 5. 推荐的第一版范围

**第一版（可发布）：**

- 门控：`anthropic-messages` + `payload.model` 含 `claude`。
- 只做 **名字 + 安全 schema adapter**：
  - `write` ↔ `Write`（`file_path`/`path` 转换）
  - `read` ↔ `Read`（hybrid：`file_path`/`offset`/`limit`；不广告 `pages`/`allow_large`）
  - `find` ↔ `Glob`（hybrid）
  - `grep` ↔ `Grep`（hybrid 子集：`pattern`/`path`/`glob`/`ignoreCase`/`context`/`limit`）
- 其他工具保持 pi 名；若用户开启 MCP 前缀，再变成 `mcp__pi__<name>`。
- 完整处理 `tool_use`、`tool_reference`、`tool_addition`、`tool_removal`。
- 入站反向映射 + `_ide` 防御。
- 非 Claude / 非 anthropic-messages 请求 deep-equal 不变。

**第二版：**

- `Bash` adapter：ms↔s，`description` 丢弃/保留策略，`run_in_background` 不支持时显式拒绝。
- `Edit`：单独 adapter 或独立 `Edit` 工具，处理 `replace_all`。
- `Agent`：按实际注册 schema 核对后开启。
- `WebSearch`/`WebFetch` hybrid，可选。

**第三版（可选）：**

- 向上游 pi-ai 提案：把 `isOAuthToken` 拆成 `useClaudeCodeNames`，让所有 Claude 模型都能 canonical
  casing；同时把 `claudeCodeTools` 更新到 2.1.316 并集。这个补丁只解决名字，不解决 schema。
- 如果模型行为仍不够“原生”，再考虑注册 canonical 工具 profile（方案 C）。

---

## 6. 测试计划

### 6.1 纯函数单测

- 门控矩阵：
  - `claude-sonnet-5` + `anthropic-messages` → on
  - `claude-*` + `openai-completions` → off
  - `us.anthropic.claude-*` + `bedrock-converse-stream` → off
  - `glm-5` + `anthropic-messages` → off
  - `my-claude-proxy` + `anthropic-messages` → on（然后靠 disable 逃生口）
- 名字解析优先级与大小写。
- `write/read/find/grep` 的 `fromWire` / `toWire`。
- 反向 map：canonical、`mcp__pi__*`、已注册的 `Agent`、`_ide` 后缀、未知名字。
- payload transform 是纯函数，不修改输入。

### 6.2 mock payload 集成测试

用本仓库 `docs/data/tools.json` 的 schema 做 fixture，构造：

1. 首轮请求：工具名/schema 与预期快照一致。
2. 模型返回 `tool_use`：`message_end` 后 name/args 变回 pi 形状。
3. 第二轮历史回放：`tool_use` / `tool_result` / `tool_reference` 名字一致。
4. `tool_addition` / `tool_removal`：中途增删工具不产生 400。
5. OAuth 路径：pi-ai 已 canonical 化，bridge 必须幂等（`Read` 不被二次改名）。
6. 非 Claude：payload deep-equal。
7. 模型切换：Claude ↔ 非 Claude，历史转换按请求独立计算。
8. 子代理 / 嵌套工具 / compaction / resume：工具名与 registry 一致。

### 6.3 验收标准

- Claude 会话的 `tools[]` 中，所有启用的 canonical 工具都同时满足：名字、schema、描述与 binding 一致。
- 模型发出的所有 `tool_use` 都能在 pi registry 找到对应 handler，零 “unknown tool”。
- 工具增删、历史回放、跨模型切换不出现 400。
- 非 Claude 请求与未安装扩展时 deep-equal。
- 日志中不出现 prompt、文件内容、密钥、完整 payload。

---

## 7. 风险与缓解

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 假阳性 | 非 Claude 模型 id 含 `claude`（代理别名） | `off` / `MODEL_RE` 逃生口；只对 `anthropic-messages` 开 |
| 名字对、schema 错 | `Read` 用 `path`、`Bash` 单位不同 | 第一版只开无损 adapter；其余走 MCP 名 |
| 中途工具变更 400 | `tool_addition`/`tool_removal` 未改名 | 覆盖全部 name 出现位置；专项测试 |
| 缓存失效 | payload 改名/换 schema 改变前缀 | 同一模型下映射稳定；记录变更；不要重排工具 |
| 重复 canonical 工具 | 其他扩展也注册 `Agent`/`Read` | 反向 map 以 `pi.getAllTools()` 为准；冲突时禁用该 binding |
| schema 漂移 | CC 版本升级 | 以 `docs/data/tools.json` 为 fixture；版本注释；回归测试 |
| 计费误解 | 改名不影响订阅计费 | 文档明确；不以省钱为卖点 |
| 安全/隐私 | payload 含 prompt/文件内容 | 禁止 payload 日志；只记录映射元数据 |
| 权限/审批 | 改名后权限扩展按名字判断 | 保留 pi 原工具名执行；权限仍看 pi 名；不要绕过 `tool_call` |
| 流式 UI | 入站映射在 `message_end` 才发生 | 可接受；不要在 `message_update` 做可变映射 |

---

## 8. 待确认问题

1. 目标端点是 **标准 Anthropic API key**，还是 **Claude Code 订阅 / OAuth / 代理**？
   前者不需要 `mcp__pi__` 前缀和 Claude Code identity；后者可能需要。
2. “原生”是要求 **名字**、**完整 schema**，还是 **行为/计费**？
   如果是计费，现有证据表明改名无效，应直接停止这个方向。
3. `Edit` 是否要采用 CC 的单点替换语义？这会改变 pi 的批量编辑习惯，属于行为变更，需要单独决策。
4. 是否接受第一版只覆盖 `Write/Read/Glob/Grep` 子集？`Bash/Edit/Agent` 暂缓。
5. 扩展放独立包，还是等上游 pi-ai 接受 `useClaudeCodeNames` 补丁？
6. 是否需要支持 Bedrock / Vertex 上的 Claude？它们的 API 不是 `anthropic-messages`，应另开方案。

---

## 9. 第一步实现记录

已实现一个可试用的扩展：`extensions/claude-native-tools/`。

- 模型 id 含 `claude` 时，把当前 active 的 `read` / `write` / `bash` / `edit` / `grep` 切换成
  `Read` / `Write` / `Bash` / `Edit` / `Grep`，描述与 `input_schema` 由 `docs/data/tools.json` 生成
  （`scripts/generate-claude-tools.mjs`）。pi 默认不启用 `grep`，需要 `--tools +grep`。
- pi 原有 `read` / `write` / `bash` / `edit` / `grep` 仍保持 active，但通过
  `prepareLoadout().hiddenDeclarations` 从模型可见的工具清单中隐藏；这样
  `ctx.executeTool()` 仍能调用它们，不需要复制文件/Shell/ripgrep 实现。
- `context` 按模型 id 把 **base pi 历史**投影成当前模型格式：一个 pi `edit` 的
  `edits[]` 会展开成多个 Claude `Edit`；反向时每个 Claude `Edit` 保持独立，不合并成 `edits[]`。
- JSONL 始终存 **base pi 格式**：`message_end` 只把 Claude 调用还原成
  `read` / `write` / `bash` / `edit` / `grep`，再交给 pi 持久化和执行。Claude 名称是请求期投影。
- `Read` 的 prompt 和 schema 已裁成 pi 能力子集：不再广告 `pages` / `allow_large`，
  PDF 页码和大文件 opt-in 不属于当前实现。
- `Edit.replace_all` 已实现：在归一化到 pi base 时，构造一个 `oldText` 从第一次到最后一次
  出现的 `edit`，`newText` 替换其中所有出现位置；JSONL 里仍是 pi `edit`，不是 `write`。
- `Write` 已接入：`write {path, content}` ↔ `Write {file_path, content}`，描述和 schema
  原样来自 `docs/data/tools.json`，保留 CC 的“绝对路径 + 覆盖前先 Read”严格措辞。
  这一版没有实现执行层 guard，所以严格约束目前是提示词约束，不是执行约束；JSONL 仍存 base pi `write`。
- 仍暂不支持 `Bash.run_in_background` 和 `Grep` 的 `output_mode` / `-o` / `type` /
  `offset` / `multiline`；正常模型调用在归一化到 pi base 时会被丢弃或近似。
- 22 个 `node --test` 用例通过（翻译 / replace_all / Read prompt / Write prompt）；并用本地 fake provider
  验证了 Claude 模式工具名、`prepareLoadout` 隐藏、`edits[]` 拆分执行、`replace_all`
  实际改写、`Write` 实际写文件与 JSONL 存 base `write`，以及切回普通模型后的反向翻译。

使用方式与限制见 `extensions/claude-native-tools/README.md`。

---

## 10. 参考来源

### 本仓库

- `docs/03-tool-catalog.md`：Claude Code 2.1.316 的 25 个工具、描述、schema。
- `docs/data/tools.json`：机器可读工具原件（本文 schema 对照的事实来源）。
- `docs/06-api-request-shape.md`：请求体骨架、`tool_use` / `tool_reference`。
- `docs/09-pi-compat-notes.md`：pi 工具映射与“不要伪造延迟加载”等结论。
- `docs/README.md`：抓包方法与局限。

### pi 文档（本机 1.4.0 快照）

- `docs/how-pi-works.md`：agent loop、context、工具声明。
- `docs/extensions.md`：事件顺序、`before_provider_request`、`message_end`、`registerTool`、
  `setActiveTools`、`prepareLoadout`。
- `docs/custom-provider.md`：provider 扩展与 `streamSimple` 的适用边界。
- `docs/models-configuration.md`：`anthropic-messages` 的 `compat` 字段；目前没有工具命名开关。
- `docs/message-types.md`：`ToolCall`、`AssistantMessage`、`ToolResultMessage` 结构。
- 在线对应页面：`https://pi.dev/docs/latest/extensions`、
  `https://pi.dev/docs/latest/custom-provider`、
  `https://pi.dev/docs/latest/models-configuration`、
  `https://pi.dev/docs/latest/message-types`。

### pi-ai 1.4.0 源码快照

安装根目录：

```text
C:\Users\36026\.pi\agent\install\releases\1.4.0\node_modules\@earendil-works\pi-ai
```

关键位置（行号按该快照）：

- `dist/api/anthropic-messages.js:43-69`：`claudeCodeTools`、`toClaudeCodeName`、`fromClaudeCodeName`。
- `:500-550`：入站 `tool_use` 的 OAuth 反向映射。
- `:780-850`：`isOAuthToken`、OAuth client/headers。
- `:852-888`：beta features；`claude-code-20250219` 只在 OAuth 下加。
- `:890-970`：`buildParams`、`nativeToolChanges`、工具列表。
- `:1042-1085`：`tool_addition` / `tool_removal` / `tool_reference`。
- `:1298-1325`：`convertTools` 的 canonical 名与 `input_schema`。
- `dist/providers/compat-schema.d.ts:147-174`：Anthropic compat 字段，无工具命名项。

### 先例

- pi.dev package：`@blackbelt-technology/pi-anthropic-messages`
  `https://pi.dev/packages/@blackbelt-technology/pi-anthropic-messages`
- GitHub：`https://github.com/BlackBeltTechnology/pi-anthropic-messages`
  - `extensions/index.ts`：`/claude/i` 门控、出站/入站钩子。
  - `extensions/core-tools.ts`：canonical 名单、`mcp__pi__` 前缀、优先级。
  - `extensions/transform.ts`：payload 改写。
  - `extensions/inbound.ts`：反向 map、`_ide` 处理。
  - `CHANGELOG.md` 0.3.5：退役原因（计费无效、工具移除 400、日志安全问题）。
