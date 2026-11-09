# pi-claude-code

让 [pi](https://github.com/badlogic/pi-mono) 在使用 Claude 模型时，直接使用 Claude Code 熟悉的
`Read`、`Write`、`Bash`、`Edit` 和 `Grep` 工具。

扩展会根据当前模型 ID 自动切换工具形态，同时沿用 pi 原有的文件、命令和编辑执行路径。你可以从 npm 安装后直接使用，也可以从仓库运行本地版本。

## 安装

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
pi -e ./extensions/claude-native-tools/index.ts
```

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

`Read`、`Write`、`Bash` 和 `Edit` 会随 pi 默认工具一起工作。需要搜索工具时，在启动参数中加入 `grep`：

```bash
pi --tools +grep
```

也可以把 `grep` 加入 pi 设置里的 `defaultTools`，之后每次启动都会自动启用它。

换用其他模型时，扩展会自动切换回 pi 的工具名称，现有会话可以继续使用。

## 技术文档

项目的抓取过程、Claude Code 请求结构、工具和 skill 资料、pi 兼容设计以及 npm 发布流程都整理在 [`docs/`](docs/README.md) 中：

- [技术文档总览](docs/README.md)
- [pi 兼容说明](docs/09-pi-compat-notes.md)
- [npm 发布流程](docs/npm-publishing.md)

## 许可证

[MIT](LICENSE)
