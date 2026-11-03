# API 请求结构

> Claude Code `2.1.316` 的 `POST /v1/messages?beta=true` 请求体骨架

## 顶层字段

```json
{
  "model": "claude-opus-5-5",
  "max_tokens": 128000,
  "thinking": {
    "type": "adaptive",
    "display": "omitted"
  },
  "context_management": {
    "edits": [
      {
        "type": "clear_thinking_20251015",
        "keep": "all"
      }
    ]
  },
  "output_config": {
    "effort": "medium"
  },
  "stream": true
}
```

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `model` | `claude-opus-5-5` | 会话模型 id |
| `max_tokens` | `128000` | 128k |
| `thinking` | `{"type":"adaptive","display":…}` | 自适应思考；`display` 可为 `omitted` / `updates` |
| `context_management` | `{"edits":[{"type":"clear_thinking_20251015","keep":"all"}]}` | 服务端清理 thinking 的 beta |
| `output_config` | `{"effort":"medium"}` | 随 `--effort` 变化 |
| `stream` | `true` | 始终流式 |

## metadata

```json
{
  "user_id": "{\"device_id\":\"e2a011fe774bac40eccec616ac7b311119ada311f7142882d9445a176fe1d0a9\",\"account_uuid\":\"\",\"session_id\":\"1e8c5189-1f1e-485a-a791-fd10ac90d4d1\"}"
}
```

`user_id` 是一个 **JSON 字符串**（双重编码），内部含 device_id / account_uuid / session_id。

## messages 的非标准点

1. **存在 `role: "system"` 的 message**（见 [02-environment-block.md](02-environment-block.md)）。
2. 用户消息常被 `<system-reminder>` 包裹（attribution、skill 清单、todo 提醒都走这里）。
3. `tool_result` 里可以是 `tool_reference` block（延迟加载工具时使用）：
   `{"type":"tool_result","content":[{"type":"tool_reference","tool_name":"WebFetch"}]}`。
   这是 beta 能力，服务端负责把 schema 展开。

## 工具延迟加载协议

```text
tools 里带 {"name":"DeferredToolPlaceholder","defer_loading":true}   → 开启延迟加载
tools 里带 {"name":"WebFetch","defer_loading":true}                  → 只给名字，不给 schema
Claude 调 ToolSearch{"query":"select:WebFetch,WebSearch"}            → 客户端回 tool_reference
下一轮请求的 tools 里出现完整 schema                                   → 变成可调用
```

## 其他观察

- `--permission-mode plan` 时会额外加顶层 `safeguards`（classifier 上下文：cwd、rules、git 状态、
  trusted_directories…），见 `data/` 下的抓包。
- `system[0]` 里 `cc_version=2.1.316.8dc` 的 `.8dc` 是每次构建都不同的指纹后缀。
