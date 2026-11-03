# 抓取工具链（mock API 抓包）

思路：Claude Code 支持 `ANTHROPIC_BASE_URL`，于是把它指到一个本地 mock 服务。
请求体就是"它真正发给模型的东西"，原样落盘；再按剧本返回 `tool_use`，逼出下一层内容
（`ToolSearch` → 延迟加载工具；`Skill` → skill 正文；`Agent` → 子代理提示词）。

```text
claude.exe ──HTTP──> mock server (8790) ──> data/raw/requests/<run>/00N_*.json
```

## 一次性准备

```bash
npm pack @anthropic-ai/claude-code-win32-x64@2.1.316   # 平台包才是真二进制
tar -xzf anthropic-ai-claude-code-win32-x64-2.1.316.tgz -C .work/bin
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `CC_BIN` | `<work>/bin/package/claude.exe` | Claude Code 可执行文件 |
| `CC_WORK` | `<repo>/.work` | 工作目录（临时的 HOME / scratch 都放这） |
| `CC_MOCK` | `http://127.0.0.1:8790` | mock server 地址 |

> 端口别用 8791 —— Windows 上可能落在 Hyper-V 的保留端口段里，会 `EACCES`。

## 流程

```bash
# 1. 起 mock（前台或后台都行）
node scripts/capture/server.js

# 2. 基础抓包：一次普通请求 + 一次 ToolSearch 把 11 个延迟工具全拉出来
#    run 名在 scenario.json 里，输出目录为 data/raw/requests/<run>/

# 3. 子代理 / skill 批量抓取
node scripts/capture/orchestrate.js    # Agent 子代理（5 种）+ skill（无提权）
node scripts/capture/orchestrate2.js   # skill（--dangerously-skip-permissions，必需）

# 4. 蒸馏 + 生成文档
node scripts/collect.mjs
node scripts/build-docs.mjs
```

## 关键坑（踩过的）

1. **`--print` 下 skill 会被权限系统拒绝**。返回 `Execute skill: X` + `is_error: true`，
   正文根本不会出现。必须加 `--dangerously-skip-permissions`。
2. **scenario 的 step 不能用全局请求计数**。多个 run 之间共享 server 进程时，要用
   「本 run 目录里已有文件数 + 1」算 index，否则后面的 run 全部拿到最后一步（只会回 text）。
3. **假 API key 完全够用**。只要请求能发出去，就能抓到 body；mock 回 SSE 即可。
4. **`--output-format stream-json` 的第一条消息是宝**：`init` 里有工具清单、skill 清单、
   全部斜杠命令、plugins、capabilities。
5. **延迟工具拿 schema 的方式**：让模型调 `ToolSearch{"query":"select:A,B,C"}`，
   下一轮请求的 `tools` 数组就带完整 schema；`tool_result` 里只有 `tool_reference`。
6. **skill 正文可能依赖仓库状态**。`security-review` 正文里有 shell 注入（`!` 后面跟反引号
   包住的命令），注入前会先跑 `git diff --name-only origin/HEAD...`。scratch 目录不是 git 仓库时，
   skill 只会返回一句 “needs to be run inside a git repository”。所以抓 skill 前先建仓库和 ref：

   ```bash
   cd .work/scratch && git init -q && git add -A && git commit -qm init
   git update-ref refs/remotes/origin/HEAD $(git rev-parse HEAD)
   ```
7. **二进制里的长提示词是被短二进制块打断的**。`stitch-once.js` 用「跳过 ≤16 字节的
   非文本间隙」的方式把 TodoWrite 提示词拼回来（见 `data/raw/gated-todowrite.md`）。

## 目录

| 文件 | 作用 |
| --- | --- |
| `server.js` | mock `/v1/messages`，按 `scenario.json` 回 SSE，落盘请求体 |
| `run.sh` | 跑一次 claude 抓包（指定 scenario + prompt + 额外参数） |
| `orchestrate.js` | 批量：5 种 agent + 12 个 skill（普通权限） |
| `orchestrate2.js` | 批量：12 个 skill（`--dangerously-skip-permissions`，正文才出得来） |
| `inspect.js` | 打印 `data/raw/requests` 里每个请求的概况（tools 数 / system 长度 / 末条消息类型） |
| `stitch-once.js` | 从二进制里 stitch 出 TodoWrite 提示词 |
