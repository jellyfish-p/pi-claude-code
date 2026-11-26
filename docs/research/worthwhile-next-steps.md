# pi Claude 工具适配后续投入建议

日期：2026-11-26。代码基线：`46dced1`，包版本 `0.2.0`。本机验证环境：Windows、Node `24.20.0`、pi `1.6.0`。

> 实施更新：本次后续开发已落实第 1、2、3、5、6 项，包括契约裁剪、真实 pi 集成测试、抓包与差分、独立 Glob 和模式诊断。以下分析及行号保留调研时的基线；当前行为见 [扩展说明](../../extensions/claude-native-tools/README.md)。第 4 项模型收益评测与第 7 项后台输出增强仍未实施。

最值得继续投入的是工具契约一致性、真实 pi 集成回归和可复现的收益评测。下一项适合增加的工具是 `Glob`。先把现有适配做可靠，再用对照实验决定扩大哪些能力，比继续堆工具名更有依据。

## 已完成的能力

当前已经支持 `Read`、`Write`、`Bash`、`Edit`、`Grep` 的模型切换与历史翻译，后台 Bash、`TaskOutput`、`TaskStop`、完成通知，以及主要结果文本的适配。`Read` 已移除不支持的 PDF 页码和 `allow_large` 字段。上述内容不应重新列为待开发功能。[实现说明](../../extensions/claude-native-tools/README.md)、[生成器](../../scripts/generate-claude-tools.mjs)

旧研究文档开头仍标记“计划（未实施）”，后面的阶段记录也仍称不支持后台 Bash。这些是历史信息；当前状态应以代码和扩展 README 为准。[旧研究](claude-native-tool-format.md)

## 投入顺序

成本是熟悉本项目后单人实现与验证的粗估，不是工期承诺。小约半天至一天，中约两至四天；依赖 pi 上游的变更另计。

| 顺序 | 项目 | 直接收益 | 成本 | 建议 |
| --- | --- | --- | --- | --- |
| 1 | 修齐 Grep、Bash 的声明与执行行为 | 减少模型按合法 schema 调用却失败，以及超时行为误判 | 小至中 | 下一次兼容修正发布优先做 |
| 2 | 真实 pi 集成测试与兼容版本范围 | 覆盖工具加载、模型切换、历史回放、权限钩子和后台生命周期 | 中 | 与第 1 项一起做 |
| 3 | 修复抓包链路并生成版本差异报告 | 让上游契约可以持续验证，降低维护成本 | 小至中 | 先修可复现性，再做差分 |
| 4 | 原生 pi 与适配扩展的 A/B 评测 | 判断项目是否提升任务成功率、减少重试或节省上下文 | 中，另有模型调用成本 | 扩大功能前完成第一轮 |
| 5 | `Glob` 适配 | 补齐按文件名搜索的常见工具入口 | 中 | 最值得增加的新工具 |
| 6 | `auto/off/force` 与状态诊断 | 支持模型别名、排查扩展冲突、快速回退 | 小 | 可与第 2 项一起交付 |
| 7 | 后台输出文件与任务记录上限 | 改善长日志、大输出和长会话使用体验 | 中 | 有实际长任务需求时做 |

## 1 工具契约一致性

### Grep 已有明确的不一致

生成的 schema 和描述包含 `count`、`type`、`offset`、`multiline`、`-o`，但执行器会明确拒绝这些参数；`-A/-B` 则被转换为对称上下文。这意味着模型遵循当前工具说明，也可能触发本可避免的错误。[catalog.ts](../../extensions/claude-native-tools/catalog.ts) 行 127–195、[index.ts](../../extensions/claude-native-tools/index.ts) 行 335–380

最小交付：参照 `Read` 的已有做法，裁剪当前未实现的字段和描述，并明确上下文窗口语义。若需要完整支持 `count/type/multiline`，优先扩展 pi 的执行能力或明确设计专门后端；不能简单从已截断的内容输出计算“完整计数”。每个保留字段都要有可执行的契约用例。[Read 生成逻辑](../../scripts/generate-claude-tools.mjs)

`files_with_matches` 还有值得单独优化的路径：目前先让底层搜索所有匹配内容，再从结果文本去重出文件名。它受内容输出的截断预算影响，不能等同于直接按文件搜索。独立复现中，一个约 12,000 行匹配的文件产生 51,269 字符的底层结果，最终仅形成 117 字符的文件列表；更多文件有可能在转换前就被截断。此处已验证的是冗余输出和截断，跨文件遗漏仍应加入专门 fixture 验证。[index.ts](../../extensions/claude-native-tools/index.ts) 行 359–379、[results.ts](../../extensions/claude-native-tools/results.ts) 行 74–115

后续验收应包含“一个文件有大量匹配、另有多个匹配文件”的目录，对照文件集合和截断提示。通过 pi 增加真正的文件列表模式，可以继续沿用现有工具钩子和权限执行路径。[pi 的嵌套工具执行约定](https://docs.pi.dev/latest/extensions#calling-other-tools)

### Bash 描述需要按实际宿主调整

当前描述声称前台默认超时为 120,000 ms、最大为 600,000 ms；执行器只在收到正数 `timeout` 时才传给 pi，并未设置上述默认值或执行上述上限。pi 的默认 Bash 明确没有默认超时。需要选择并统一：实施声明的超时策略，或如实说明沿用 pi 配置。[catalog.ts](../../extensions/claude-native-tools/catalog.ts) 行 60、[index.ts](../../extensions/claude-native-tools/index.ts) 行 260–265、[pi Bash 源码](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts)

同一份抓包描述还固定写了 Git Bash、跨调用 `cd` 行为，并要求用 `Monitor` 等待；这些不能直接视作所有 pi 安装的能力。应保留原始抓包作为参考，另外生成适配当前宿主的说明。项目已经为 `Read` 做过这种裁剪，有现成实现方式。[Bash 原始适配目录](../../extensions/claude-native-tools/catalog.ts)、[生成器](../../scripts/generate-claude-tools.mjs)

### 一并处理的小边界

- **统一路径解析。** `replace-all.ts` 用 `resolve(cwd, filePath)` 读文件，而 `index.ts` 的另一个解析器支持 `file://`、`@` 和 `~`。已用本机真实 pi Edit 复现：同一内容为 `alpha alpha` 的文件，普通绝对路径可构造全量替换，file URI 会退回单次替换并报多个匹配。至少让已接受的路径形式在各操作间一致。[replace-all.ts](../../extensions/claude-native-tools/replace-all.ts) 行 28–39、[index.ts](../../extensions/claude-native-tools/index.ts) 行 385–396
- **避免拆分调用 ID 碰撞。** 当前拆分 `edit` 时截断原 ID 再拼后缀；两个有相同长前缀的不同 ID 可以产生相同新 ID。已验证两个 61 字符原 ID、各两处编辑，转换后四个调用只有两个唯一 ID。常见短 ID 不触发，因此适合作为回放边界修复，不应夸大为普遍故障。[translate.ts](../../extensions/claude-native-tools/translate.ts) 行 345–348

## 2 真实 pi 集成回归

现有 36 个测试全部通过，但没有测试加载 `index.ts` 并贯穿工具注册、事件、`prepareLoadout` 和真实 `ctx.executeTool()`。CI 只在 Ubuntu、Node 22 上跑现有测试；三个 peer dependency 的版本范围均为 `*`。[测试入口](../../package.json)、[CI](../../.github/workflows/package.yml)

建议建立不调用付费模型的 fake provider 测试，固定一个已验证的 pi 版本，再覆盖当前支持版本。最小场景是：

1. Claude → 非 Claude → Claude，检查工具声明和历史调用、结果配对。
2. `--tools` 子集、关闭工具、无工具启动，确认不会意外重新启用能力。
3. 新会话、恢复、分支和重载，检查后台任务清理及历史回放。
4. 嵌套工具被阻止、执行失败、结果包含图片或截断提示。
5. 后台任务成功、失败、停止、超时，以及空闲和忙碌时的完成通知。
6. Windows 与 Linux 上的路径、换行、shell 和搜索结果。

上述嵌套调用与隐藏声明行为已有 pi 官方扩展接口支持，应针对接口做回归，而不是另写一套执行路径。[pi 扩展文档](https://docs.pi.dev/latest/extensions)

确定最低兼容版本后再收窄 peer dependency 范围。现在只能确认本机 pi `1.6.0` 的隔离加载检查没有扩展错误，不能据此认定所有旧版本都兼容。

## 3 抓包与版本差分

抓包资产是项目已有的价值，但当前文档中的启动步骤不能直接工作：在根目录执行 `node scripts/capture/server.js`，立即得到 `ReferenceError: require is not defined in ES module scope`。原因是项目声明 `type: module`，该 `.js` 文件仍使用 CommonJS 的 `require` 与 `__dirname`。[package.json](../../package.json)、[server.js](../../scripts/capture/server.js) 行 1–5

此外，server 写入 `scripts/capture/requests`，`collect.mjs` 读取 `data/raw/requests`；文档没有给出两者间的搬运步骤。仅修好模块格式还不足以闭合流程。[server.js](../../scripts/capture/server.js) 行 5、[collect.mjs](../../scripts/collect.mjs) 行 9–12、[抓包说明](../../scripts/capture/README.md)

最小交付：

- 提供一条可运行的 capture 命令，统一场景目录、输出目录、版本和平台参数。
- 输出 manifest：Claude Code 版本、平台、入口、启用工具、生成时间和来源摘要。
- 对两次快照输出工具增删、字段变化、必填项变化、描述变化。
- CI 验证 catalog 可由源数据重新生成且无差异；普通 PR 不需要下载和执行 Claude Code。

需要区分“版本变化”和“平台、入口、feature gate 差异”。当前 Claude Code 官方文档说明，`TaskOutput` 在 `2.1.277` 移除，后台输出改用 `Read` 读取输出文件；`Glob/Grep` 的默认可用性也因平台而异。项目可以保留自己的 `TaskOutput` 便利接口，但应标明它是扩展接口，不能将单份快照视作所有环境的当前标准。[Claude Code 工具参考](https://code.claude.com/docs/en/tools-reference)

## 4 验证适配的实际收益

代码已证明能做名称、参数和结果转换；仓库尚未提供可重复的任务成功率对照，不能据此宣称“Claude 表现更好”。旧兼容笔记也建议使用同一批 prompt 做行为对比。[现有测试](../../test/)、[兼容笔记](../09-pi-compat-notes.md)

建议先用约 20 个可自动判定结果的小任务：找文件、按内容搜索、分页读取、唯一替换、批量替换、运行失败命令、后台任务和长输出处理。核心对照是同一 pi、同一模型、同一初始目录、同一 prompt，分别关闭和启用适配；Claude Code 可作为另外的参考组，但其余宿主差异不能归因于本扩展。

每个任务做重复运行并交错组别，记录任务正确率、无效参数和重试次数、工具调用数、输入输出 token、延迟及工具声明开销。区分冷缓存和热缓存。后续可以再拆分“名称与 schema 适配”和“结果文本适配”，判断收益来自哪一部分。

第一轮以发现稳定收益或明显回归为目标；小样本不足以宣布通用性能提升。如果没有收益，优先调整描述长度和错误恢复，再决定是否增加更多工具。本次调研未进行真实模型 A/B 调用。

## 5 最值得增加的工具是 Glob

目前映射表没有 `find ↔ Glob`。pi 的 `find` 已提供 `pattern/path/limit`，可以沿用现有执行体系；这是比新建 Agent、Monitor 或工作流系统更接近项目定位的扩展。[当前映射](../../extensions/claude-native-tools/index.ts) 行 40–54、[pi find 源码](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/find.ts)

但不能只改名。Claude Code 官方文档说明其 Glob 按修改时间排序、最多返回 100 个文件、默认不遵循 `.gitignore`；pi find 声明遵循 `.gitignore`，默认上限 1,000。需要明确选择“pi 能力子集”还是完整兼容，并据此生成准确的描述和结果提示。[Claude Code Glob 行为](https://code.claude.com/docs/en/tools-reference#glob-tool-behavior)、[pi find 源码](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/find.ts)

最小版本只在 `find` 已启用时启用 `Glob`，保留底层 callable 工具、隐藏重复声明、支持双向历史翻译。验收覆盖文件夹 pattern、隐藏文件、被忽略文件、无匹配、截断和 Windows 路径。

## 6 可控开关和状态诊断

当前开启条件只有模型 ID 匹配 `/claude/i`。模型别名可能不命中，也没有方便的单独回退开关。建议提供 `auto/off/force`、可选的模型匹配规则，以及一条显示当前模式、实际工具清单、pi 版本和未支持能力的状态命令。[translate.ts](../../extensions/claude-native-tools/translate.ts) 行 49–50、[模式同步](../../extensions/claude-native-tools/index.ts) 行 143–155

不要直接搬用旧 wire bridge 方案的 API 限制：当前实现注册的是 pi 工具，并非重写某个 provider 的 HTTP 请求。哪些 provider 可以启用，应通过集成测试确定。

本机执行 README 的普通 `-e` 加载命令时，与已经安装的 npm 版本发生同名工具冲突；进程仍以 0 退出。增加隔离试用说明和冲突诊断有实际价值。隔离加载方式已验证：

```powershell
pi --no-extensions --no-mcp -e ./extensions/claude-native-tools/index.ts --list-models
```

该命令仅检查加载路径，不验证工具执行或模型输出。

## 7 后台任务后续增强

后台任务已支持取消和超时，且 `session_shutdown` 会调用清理。本机 pi 生命周期与这一做法相符，没有证据表明切会话会遗漏清理。[index.ts](../../extensions/claude-native-tools/index.ts) 行 133–161、[BackgroundBashTasks](../../extensions/claude-native-tools/background-bash.ts)

后续真正有价值的是保留可供 `Read` 分段读取的输出文件信息、提供任务列表，以及为完成记录增加数量或时间上限。当前任务记录持续保存在 Map 中直到会话关闭；底层 Bash 已能提供完整输出路径等结构化信息，但后台适配只提取了文本内容和退出码。[后台存储](../../extensions/claude-native-tools/background-bash.ts) 行 29–71、86–101、[pi Bash 结果结构](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/bash.ts)

保留现有 `TaskOutput` 接口有利于旧会话使用；增加输出文件不需要立即删除它，也不需要把项目扩大为持久任务调度器。

## 暂缓的方向

- **全面复制 Agent、Monitor、Cron、Worktree 和权限系统。** 会显著扩大状态与生命周期复杂度，当前价值证据不足；先验证工具适配的独立收益。
- **整套 system prompt 原文搬运。** 当前 Bash 已能看到宿主能力与描述不一致的问题，应按实际能力维护。
- **给所有自定义工具加 MCP 前缀或仅靠改名追求计费变化。** 不属于已经验证的产品收益，避免成为默认目标。
- **优先做 PDF、Notebook 和完整 Web 工具。** 可以按真实使用需求后续评估；现有搜索和兼容回归更直接。

## 验证记录

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| `npm test` | 36/36 通过 | 当前纯函数、后台状态类、替换和发布测试 |
| pi `1.6.0` 隔离扩展加载 | 退出码 0，无扩展加载错误 | 无模型调用，不代表端到端执行通过 |
| 已安装 npm 包时同时 `-e` 加载仓库版本 | 同名工具冲突，退出码仍为 0 | 本机共存场景 |
| `node scripts/capture/server.js` | ESM/CommonJS 错误，退出码 1 | 文档入口已复现不可运行 |
| file URI 的 `replace_all` | 进入单次替换 fallback，真实 pi Edit 报重复匹配 | 本机 pi `1.6.0` |
| 长前缀 ID 的 edit 拆分 | 四个调用只有两个唯一 ID | 人工构造的边界输入 |

上游链接核对日期为 2026-11-26；在线主分支和文档会继续变化。代码事实以本文列出的本仓库提交和本机版本为界，效果提升仍需第 4 项实验验证。
