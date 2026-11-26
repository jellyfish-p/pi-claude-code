# pi-claude-code

让 [pi](https://github.com/badlogic/pi-mono) 在使用 Claude 模型时，直接使用 Claude Code 熟悉的
`Read`、`Write`、`Bash`、`Edit`、`Grep` 和 `Glob` 工具。

扩展会根据当前模型 ID 自动切换工具形态。读写、命令、编辑和内容搜索沿用 pi 的执行路径；`Glob` 使用按 Claude Code 行为验证的文件搜索实现，同时保留 `find` 的调用和历史重写。你可以从 npm 安装后使用，也可以从仓库运行本地版本。

## 安装

当前源码要求 Node.js `>=22.19.0`、pi `>=1.6.0 <1.7.0`，兼容测试覆盖 pi `1.6.0` 和 `1.6.1`。

从 npm 安装稳定版本：

```bash
pi install npm:pi-claude-native-tools
```

从当前仓库安装：

```bash
pi install ./
```

只想临时试用时，可以直接加载扩展文件：

```bash
npm ci
pi -e ./extensions/claude-native-tools/index.ts
```

若已经安装 npm 版本，试用本地版本时用 `--no-extensions -e ...` 禁用自动扩展发现，避免两份扩展注册同名工具。这个选项也会停用其他自动发现的扩展。

## 使用

安装完成后，照常启动 pi 并选择 Claude 模型即可：

```bash
pi
```

当模型 ID 中包含 `claude` 时，当前启用的 pi 工具会显示为 Claude Code 的工具名称：

| Claude Code 工具 | 对应的 pi 工具 |
| --- | --- |
| `Read` | `read` |
| `Write` | `write` |
| `Bash` | `bash` |
| `Edit` | `edit` |
| `Grep` | `grep` |
| `Glob` | `find`（调用和历史映射；使用独立搜索实现） |

`Read`、`Write`、`Bash` 和 `Edit` 会随 pi 默认工具一起工作。需要搜索工具时，在启动参数中追加 `grep` 和 `find`：

```bash
pi --tools +grep,+find
```

也可以把 `grep`、`find` 加入 pi 设置里的 `defaultTools`。如果使用替换整个工具集的严格白名单，需要同时允许 pi 名和适配名，例如 `--tools read,Read,find,Glob`；扩展不会绕过宿主的工具白名单。

换用其他模型时，扩展会自动切换回 pi 的工具名称，现有会话可以继续使用。

### 模式和诊断

```bash
pi --claude-tools=off                   # 本次启动使用 pi 工具
pi --claude-tools=force                 # 为模型别名等场景强制启用适配
pi --claude-tools-model-pattern="claude|my-model"
```

默认模式是 `auto`，按模型 ID 匹配不区分大小写的 `claude`。会话中用 `/claude-tools status` 查看 pi 版本、有效模式、工具清单和能力限制；`/claude-tools auto`、`/claude-tools off`、`/claude-tools force` 可以切换当前加载会话的模式。重载扩展或新建会话后，启动参数重新生效。

### 搜索行为

`Grep` 支持文件列表和匹配内容两种输出，支持 `-i`、`-n`、`glob`、`context`/`-C` 和 `head_limit`。尚未实现的 `count`、`type`、`offset`、`multiline`、`-o`、`-A`、`-B` 不会出现在公开 schema 中。两种模式仍受 pi 底层内容搜索的截断限制。

`Glob` 对照仓库的 Claude Code `2.1.316` 二进制验证：包含隐藏文件和 gitignored 文件，不跟随目录符号链接，按修改时间从旧到新返回最多 100 个文件并提示截断。没有斜线的模式（如 `*.ts`）递归匹配文件名；含斜线的相对模式以会话工作目录为基准，`path` 缩小相对模式的搜索范围。绝对模式则从自身目录开始搜索，并优先于 `path`。结果路径也相对于会话工作目录。

非 Claude 模式下，`find` 保留 pi 自己的忽略规则、结果上限和执行方式。`find↔Glob` 的历史重写只改变送给模型的调用表示，不会重新执行历史搜索。

### Bash 后台任务

前台 `Bash.timeout` 以毫秒计，默认 2 分钟，最长 10 分钟；超出范围会返回错误。命令仍使用 pi 配置的 shell 和权限。

`Bash` 收到 `run_in_background: true` 后会立即返回 `task_id`。用 `TaskOutput` 传入这个 ID 可以随时查看状态和已捕获的输出，用 `TaskStop` 可以停止任务。任务成功、失败、停止或超时后，pi 会把结果状态发给模型。模型空闲时会开始新一轮，正在处理其他工作时会在当前工作结束后收到通知。

后台 `timeout` 以毫秒计，默认 10 分钟，最长 2 小时。任务和输出保留在当前运行中的会话里。退出、切换或重载会话时会清理后台任务。需要在模型空闲后接收通知时，请保持 TUI 或 RPC 会话运行。

## 技术文档

项目的抓取过程、Claude Code 请求结构、工具和 skill 资料、pi 兼容设计以及 npm 发布流程都整理在 [`docs/`](docs/README.md) 中：

- [技术文档总览](docs/README.md)
- [pi 兼容说明](docs/09-pi-compat-notes.md)
- [npm 发布流程](docs/npm-publishing.md)
- [抓包和版本差分](scripts/capture/README.md)

开发时使用 `npm ci` 安装锁定依赖，`npm test` 运行完整测试，`npm run test:integration` 单独运行真实 pi 与本地假 provider 的集成测试。这些测试不需要真实模型凭据。

## 许可证

[MIT](LICENSE)
