# 插件架构（OpenCode V2）

[中文](plugin-architecture.md) | [English](plugin-architecture.en.md) | [日本語](plugin-architecture.ja.md)

`opencode-statusline` 是一个 OpenCode V2 TUI-only 插件。

## 目标

- 在 prompt footer 中显示可配置 statusline。
- 查询第三方 provider 的 quota/balance。
- 不污染模型上下文。
- 尽量复用 V2 内置数据，不重复实现 session/model/token/cost 计算。

## 包结构

```text
src/
  tui.tsx                  V2 plugin entry
  lib/
    statusline.ts          snapshot + pure field rendering
    statusline-view.tsx    prompt.footer.status component
    statusline-config.ts   field definitions, defaults, argument parsing
    quota.ts               built-in Go usage + provider collector bridge
    quota-dialog.tsx       /quota dialog
    providers.ts           provider usage collectors
    credentials.ts         V2 credential store + env fallback
    usage-format.ts        quota report formatting
    format.ts              shared formatting
scripts/
  prepare-tui-dist.mjs     Babel/Solid precompile for dist/**/*.jsx
```

`package.json` 只导出 `./tui`。这是 TUI-only 包，配置在 `cli.json` 的 `plugins` 数组，而不是 `opencode.json` 或旧 `tui.json`。

## 入口

```ts
export default Plugin.define({
  id: "opencode-statusline",
  setup(context) {
    context.storage.store("settings", ...)
    context.ui.slot({ append: "prompt.footer.status", render })
    context.keymap.layer(() => ({ commands: [...] }))
  }
})
```

插件 id 不使用 `opencode.` 前缀，避免与内置插件命名空间冲突。

## Slot 布局

V2 公开的 prompt footer 路径：

```text
prompt.footer
prompt.footer.status
prompt.footer.file
```

宿主结构大致为：

```text
[location ........][插件 statusline][file][内置 context/cost/commands]
```

插件使用 `append: "prompt.footer.status"`，位置在 location 之后、内置 `PromptFooter` 之前。

- 内置 `opencode.prompt.footer` 通过 `append: "prompt.footer"` 挂载，内部顺序固定。
- 插件可以控制自身与内置块的**前后关系**，但不能把字段穿插进内置块内部。
- 完全自定义需要 `replace: "prompt.footer"`，会连内置 spinner/location/file/goal/context/cost 一起接管，不推荐。
- 插件只返回一个 `<text truncate flexShrink={1} minWidth={0}>`，不再手算 prompt 模型行宽度。

## 数据来源

| 数据 | V2 API |
| --- | --- |
| 当前选择模型 | `context.ui.model.current()` |
| session model | `context.data.session.get(id)?.model` |
| session/family | `context.data.session.family(id)` |
| session cost/tokens | `SessionInfo.cost` / `SessionInfo.tokens` |
| context tokens | `context.data.session.message.list(id)` + 最后一条带 token 的 assistant |
| model context limit | `context.data.location.model.list(location)` |
| branch | `context.data.location.vcs.info(location)?.branch.current` |
| git diff stats | `context.client.vcs.status({ location })` |
| provider 信息 | `context.data.location.provider.list(location)` |
| credential | `context.client.credential.list()` |
| OpenCode Go usage | `context.client.experimental.usage.limits()` |
| 配置 | `context.storage.store()` |

V2 数据是响应式的，因此不再需要：

- `model.json` 轮询
- 手写 `session_prompt` 包装
- child session SDK 遍历
- `git diff` 子进程
- 事件后延迟重建整个 statusline
- 手写 dialog 生命周期和 esc 绑定

## 刷新模型

- session/message/model/provider 数据由 Solid store 响应式更新。
- git diff 和 quota 在以下时机刷新：
  - `session.execution.succeeded`
  - `session.execution.failed`
  - `session.execution.interrupted`
  - quota 或 git diff 字段启用时，60 秒定时刷新
- 异步结果带 key 与 version 守卫，切换 provider/location 时不会显示上一个账户的数据。
- 第三方 provider collector 使用 30 秒 fresh cache 和 10 分钟 stale fallback；失败时优先返回 stale 数据。OpenCode Go 内置 usage 每次读取。

## 字段

字段定义在 `statusline-config.ts`，渲染在 `statusline.ts`。

默认字段只包含内置 footer 没有的能力：

```text
repo | branch | git_diff_stats | quota_5h | quota_weekly | provider_balance
```

context/cost/subagent/agent status 等字段仍可选，但默认关闭，避免和内置 footer 重复。

`generation_metrics` 使用当前 turn 的 assistant steps：

```text
tokensPerSecond = sum(output + reasoning) / sum(streamed - created)
```

V2 的 `streamed` 是 provider 响应体结束时间，不是首 token 时间，因此不再显示 TTFT。

## 命令

### `/statusline`

- 无参数：打开字段选择 dialog。
- 带参数：直接替换字段，例如 `/statusline branch repo quota_5h`。
- `clear`：清空字段。
- 命令声明 `slash.arguments: true`，避免命令文本被当成普通 prompt 发送给模型。
- 选择结果写入 `context.storage.store("settings")`。

### `/quota`

- 解析当前 route/session/model/provider。
- OpenCode Go 优先调用 `client.experimental.usage.limits()`，读取 `data.go`。
- 没有内置 Go 数据时回退到 `collectProviderUsage()`。
- 其他 provider 使用 collector。
- dialog 用 `scrollbox` 限制高度。
- `/quota` 不写入对话。

## Provider 层

`providers.ts` 将各 provider 的响应规范化为 `UsageReport`：

```ts
{
  ok, providerID, providerName, modelID, generatedAtMs,
  auth, plan, windows, balances, items, error
}
```

每个 collector：

1. 从 V2 credential store 或 env 解析凭据
2. 请求 provider endpoint
3. 规范化 quota/balance
4. 返回错误报告而不是抛异常

凭据顺序：

1. `context.client.credential.list()` 中匹配 integrationID 的 active credential
2. 环境变量

不再读取 `auth.json`。OpenAI OAuth 只接受 `openai`/`codex`/`chatgpt` integration，避免把 OpenCode Console token 发到 ChatGPT endpoint。

OpenCode Go 使用内置 `usage.limits` 时不需要额外 API key；回退 collector 使用 `OPENCODE_API_KEY` 或 Go credential。

## 构建

- `tsc` 输出 `.js` / `.jsx` / `.d.ts`。
- `scripts/prepare-tui-dist.mjs` 递归把 `dist/**/*.jsx` 用 Babel + `babel-preset-solid` 转成 `.js`。
- `dist/tui.js` 是 V2 TUI 入口。
- 依赖：
  - `@opencode/plugin` / `@opencode/client` 为 dependency
  - `@opentui/core` / `@opentui/solid` / `solid-js` 为 peer

## 已知限制

- `prompt.footer.status` 是块级插槽，不能逐字段穿插内置 context/cost。
- 窄终端会截断 statusline 尾部字段；可以通过 `/statusline` 调整顺序。
- 第三方 provider usage endpoint 没有公开契约，可能随 provider 变动。
- OpenCode Console/Zen 的 workspace limits 仍以内置 `/usage` 为准。
