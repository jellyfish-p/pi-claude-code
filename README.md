# pi-claude-code

把 **Claude Code** 里真正发给模型的东西全部挖出来，做成可以直接照抄的开发参考，
用来提升 Claude 在 [pi](https://github.com/) 这类 harness 里的兼容性。

抓的是 **Claude Code `2.1.316`**（npm `@anthropic-ai/claude-code`，2026-10-30 构建）。

## 方法：不一定读源码，直接抓包

Claude Code 支持 `ANTHROPIC_BASE_URL`。把它指到本地 mock 服务，请求体就全落盘了；
再按剧本返回 `tool_use`，让 Claude Code 自己把下一层内容吐出来。

```text
claude.exe ──► mock /v1/messages ──► 原始请求体（system / tools / messages）
                    │
                    ├─ 返回 ToolSearch tool_use ──► 11 个延迟工具的完整 schema
                    ├─ 返回 Skill tool_use      ──► 12 个内置 skill 的正文
                    └─ 返回 Agent tool_use      ──► 5 个子代理各自的系统提示词
```

所以下面每一段文本都是**逐字原文**，不是从源码猜的。

## 产出

```text
docs/
  README.md                 总览 + 关键结论 + 局限
  01-system-prompt.md       主 system 数组原文（含计费头）
  02-environment-block.md   role:"system" 的环境块（工具/代理/skill 清单）
  03-tool-catalog.md        25 个工具：描述原文 + 参数表 + JSON Schema
  04-subagents.md           5 个内置子代理的提示词 + 工具白名单
  05-skills.md              12 个内置 skill 的索引与调用协议
  06-api-request-shape.md   请求体骨架、thinking/effort/context_management、延迟加载协议
  07-inventory.md           SDK init 清单（工具 / 53 个 skill / 全部斜杠命令 / capabilities）
  08-gated-tools.md         没启用的内置工具（TodoWrite 等，含提示词原文）
  09-pi-compat-notes.md     ★ 落到 pi 的具体改法：工具映射 + 提示词拼装 + 反例
  skills/                   12 个内置 skill 逐字正文
  data/                     机器可读原件（tools.json / init.json / system-prompt.json …）
  research/                 专题研究与第一步实现记录

data/raw/                   原始抓包（mock API 收到的请求体，证据）
scripts/
  capture/                  抓取工具链（mock server / 批量触发 / 二进制 stitch）
  collect.mjs               原始抓包 → docs/data + docs/skills
  build-docs.mjs            docs/data → docs/*.md
  generate-claude-tools.mjs docs/data → Claude 原生工具 catalog
extensions/
  claude-native-tools/      第一步实现：Claude 模型下切换 Read/Write/Bash/Edit/Grep
```

## 第一步实现：Claude 原生工具 profile

当模型 id 含 `claude` 时，`extensions/claude-native-tools/` 会把当前启用的
`read` / `write` / `bash` / `edit` / `grep` 切换成 Claude Code 的
`Read` / `Write` / `Bash` / `Edit` / `Grep`，使用抓包得到的原生描述与 schema，
并通过 `ctx.executeTool()` 复用 pi 原有执行路径。
pi 默认只启用 `read` / `bash` / `edit` / `write`，前四个已经覆盖；
需要 `Grep` 时加 `--tools +grep`。

```bash
# 试用
pi -e ./extensions/claude-native-tools/index.ts
# 纯翻译层测试
npm test
```

实现细节与限制见 [extensions/claude-native-tools/README.md](extensions/claude-native-tools/README.md)。

## 五个最有价值的发现

1. **工具清单不在 `system` 里**：Claude Code 用一条 `role: "system"` 的 **message**
   （`messages[1]`）承载 "环境 + 工具 + 代理 + skill 清单"，顺序是 `user → system → user`。
2. **工具延迟加载**：首轮 `tools` 只有 14 个；其余 11 个只以**名字**列在环境块里，
   模型调 `ToolSearch` 之后它们才进入 `tools`（带 `defer_loading: true`）。
   这直接塑造了模型的"工具意识"。
3. **工具描述就是提示词**：`Bash` 2.1K、`Agent` 3.2K、`Monitor` 6.3K 字符，里面全是行为规约。
   改名或改写会直接改变行为。
4. **`2.1.316` 没有 TodoWrite / AskUserQuestion**：它们在 `BUILTIN_TOOL_NAMES` 里存在，
   但被 feature gate 关掉，`-p` 路径下不会发送（08 里有 TodoWrite 的提示词原文）。
5. **子代理的"只读"是 schema 级约束**：`Explore` 的工具表里直接没有 `Edit` / `Write`。

## 重新生成

```bash
# 只在改了 data/raw 之后需要
node scripts/collect.mjs
# 重新生成 docs/01..08
node scripts/build-docs.mjs
```

换 Claude Code 版本要重抓，步骤见 [scripts/capture/README.md](scripts/capture/README.md)。

## GitHub Actions 打包

仓库远端正指向 [jellyfish-p/pi-claude-code](https://github.com/jellyfish-p/pi-claude-code)。

`.github/workflows/package.yml` 使用 Node 22。

触发与行为：

- push 到 `master` / `main`、pull request、手动 `workflow_dispatch`：只跑 `npm test`，不打包
- push `v*.*.*` tag（例如 `v0.1.0`）：跑测试、打包并创建 GitHub Release

tag 流程：

1. 校验 tag 与 `package.json` 的 `version` 一致
2. `npm test`
3. `npm pack` 生成 `pi-claude-native-tools-<version>.tgz`
4. 上传到 Actions artifact
5. 把 tarball 附加到对应的 GitHub Release

`package.json` 目前仍是 `private: true`，所以只做 GitHub 侧打包/Release，没有配置 `npm publish`。
npmjs 发布暂时手动处理；以后要自动化时，需要去掉 `private`、添加 `NPM_TOKEN` secret，并补一个发布 workflow。

## 说明

- 抓的是 `-p/--print`（`cc_entrypoint=sdk-cli`）入口；交互 TUI 入口的 `system[0]` 与部分
  UI 专属工具不在此列。
- 环境块里的日期 / 路径 / 模型名 / 构建指纹是本机快照。
- 详细局限与注意事项见 [docs/README.md](docs/README.md)。
