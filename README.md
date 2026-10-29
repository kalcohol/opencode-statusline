# opencode-statusline

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

OpenCode V2 TUI 插件：在 prompt footer 中显示自定义 statusline，并查询第三方 provider 的 quota/balance。所有信息只渲染在 TUI 内，不写入模型上下文。

要求：

- OpenCode `2.2.x` 或更新版本
- TUI-only 插件（配置在 `cli.json`）
- 本地路径安装；项目为 `private`，不发布 npm

## 功能

- `/statusline`：选择、排序 statusline 字段。
- `/quota`：查看当前 provider 的 quota、usage、balance。
- 状态栏渲染在 `prompt.footer.status`，由 OpenCode 负责 footer 布局。
- 默认字段避开 OpenCode 内置 footer 已显示的信息。
- 不污染聊天上下文。

> 内置 `/usage` 显示 OpenCode Console/Go 的 workspace limits；内置 `/status` 显示 MCP server 状态。本插件的 `/quota` 面向第三方 provider，并提供 OpenCode Go 的便捷查询，三者不冲突。

## 安装

```sh
git clone https://github.com/kalcohol/opencode-statusline.git
cd opencode-statusline
npm install
npm run build
pwd
```

把 `pwd` 的绝对路径写入全局 `cli.json`：

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-statusline"]
}
```

默认位置：

```text
${XDG_CONFIG_HOME:-~/.config}/opencode/cli.json
```

然后重启 OpenCode。

这是 TUI-only 包，**不要**把它写进 `opencode.json` 或旧的 `tui.json`。

## 命令

### `/statusline`

打开字段选择器。选中字段会切换启用状态，选择顺序就是显示顺序。

也可以直接传字段：

```text
/statusline branch repo git_diff_stats quota_5h quota_weekly
/statusline clear
```

### `/quota`

显示当前 provider 的 quota/balance。OpenCode Go 分两种：绑定 OpenCode Console integration 时复用内置 `usage.limits`；独立 `opencode-go` integration 使用自己的 API key，不读取 Console 数据。

`/quota` 与内置 `/usage` 的区别：

- `/quota`：第三方 coding plan/provider quota（Z.ai、Kimi、MiniMax、MiMo、DeepSeek、OpenRouter、OpenAI OAuth）+ OpenCode Go 便捷查询。
- `/usage`：OpenCode Console 的 workspace/model limits 和 Go 限额。

## Statusline 字段

| 字段 | 说明 | 内置 footer 是否已有 |
| --- | --- | --- |
| `repo` | 仓库/目录 basename | sidebar 有路径 |
| `branch` | 当前 git 分支 | sidebar 有 `path:branch` |
| `git_diff_stats` | working tree 增删行数 `+12,-3`；仅 VCS repo 显示 | 无紧凑 totals |
| `context_used` | 当前上下文 token | 是 |
| `context_remaining` | 上下文剩余 | 否 |
| `context_length` | 上下文上限 | 否 |
| `context_window` | 已用/总上下文 | 是（tokens + %） |
| `generation_metrics` | 当前 session 当前 turn 的生成速度 `gen 42 tok/s` | 否 |
| `family_generation` | 当前 session + 活跃 subagents 的 wall-clock union 速度 `family gen 42 tok/s`，默认关闭 | 否 |
| `subagent_status` | running subagent 数量；完成后短暂显示 `sub N done`，有数据时带速度 | 是（仅 running 数量） |
| `agent_status` | 主 session 是否 running | 是（spinner） |
| `quota_5h` | provider 5h quota 使用百分比 | 仅 Console/Go |
| `quota_weekly` | provider weekly quota 使用百分比 | 仅 Console/Go |
| `provider_balance` | 余额/remaining limit | 仅 Console |
| `session_io` | 当前 session 子树输入/输出 token | 否 |
| `session_total` | 当前 session 子树总 token | 否 |
| `session_cost` | 当前 session 子树成本 | 是 |

默认字段：

```text
repo | branch | git_diff_stats | quota_5h | quota_weekly | provider_balance
```

内置 footer 已经显示 context/cost/subagent 时，再启用重复字段会出现两份数字；这些字段仍保留为可选。

`generation_metrics` 使用 v2 的 step 级 `streamed - created` 计算当前 session 的 provider-active 生成速度，不包含 TTFT。

`family_generation` 默认关闭。它把当前 session 与 subagent 的 `[created, streamed]` 区间做 wall-clock union，因此并发 subagent 不会重复计算重叠时间；消息不完整或 turn 归属不明确时省略。

## 支持的 Providers

| Provider / plan | Provider IDs | 凭据 |
| --- | --- | --- |
| Z.ai coding plan | `zai`, `zai-coding-plan` | `ZAI_API_KEY` / `ZAI_CODING_PLAN_API_KEY` 或 credential |
| Zhipu coding plan | `zhipu`, `zhipuai`, `zhipu-coding-plan`, `zhipuai-coding-plan` | `ZHIPU_API_KEY` / `ZHIPU_CODING_PLAN_API_KEY` 或 credential |
| Kimi Code | `kimi`, `kimi-code`, `kimi-for-coding` | `KIMI_API_KEY` / `KIMI_CODE_API_KEY` 或 credential |
| MiniMax coding plan | `minimax`, `minimax-coding-plan` | `MINIMAX_CODING_PLAN_API_KEY` / `MINIMAX_API_KEY` 或 credential |
| MiniMax CN | `minimax-cn`, `minimax-china-coding-plan`, `minimax-cn-coding-plan` | `MINIMAX_CHINA_CODING_PLAN_API_KEY` 或 credential |
| Xiaomi MiMo Token Plan | `xiaomi-mimo`, `xiaomi`, `mimo`, `mimo-token-plan`, `xiaomi-token-plan*` | 模型调用用 API key；usage 需要 `XIAOMI_MIMO_SESSION_COOKIE` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` 或 credential |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` 或 credential |
| OpenCode Go | `opencode-go`, `opencodego` | Console integration 用内置 usage；独立 Go integration 只用自身 key / `OPENCODE_API_KEY` |
| OpenAI / ChatGPT / Codex OAuth | `openai`, `codex`, `chatgpt` | OpenCode credential store 中的 OAuth |

凭据解析顺序：

1. OpenCode V2 credential store（`context.client.credential.list()`）
2. 环境变量

不再读取 `auth.json`。

OpenCode Zen (`opencode`) 的 Console limits 请使用内置 `/usage`。

Xiaomi MiMo 的 usage endpoint 在 SSO 后台下，拒绝 `tp-*` key；需要设置 `XIAOMI_MIMO_SESSION_COOKIE`。

Endpoint 细节见 [doc/provider-query-methods.md](doc/provider-query-methods.md)。

## 配置存储

字段选择通过 OpenCode V2 `context.storage.store` 保存，由 OpenCode 按插件 id 自动命名空间化。不再使用单独的 `statusline-plugin.json`，也不需要 `OPENCODE_STATUSLINE_CONFIG` / `OPENCODE_STATUSLINE_STATE_DIR`。

## 开发

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` 会先用 `tsc` 输出，再用 Babel + Solid preset 预编译 `dist/**/*.jsx`。OpenCode 从 `dist/tui.js` 加载 TUI 入口，所以修改源码后必须重新 build。

源码结构：

```text
src/
  tui.tsx                  V2 plugin entry, slot, keymap, storage
  lib/
    statusline.ts          snapshot + field rendering
    statusline-view.tsx    prompt.footer.status component
    statusline-config.ts   field definitions / parsing / defaults
    quota.ts               built-in Go usage + provider collector bridge
    quota-dialog.tsx       /quota dialog
    providers.ts           provider barrel
    providers/             adapter registry + provider collectors
    credentials.ts         V2 credential resolution
    usage-format.ts        quota report formatting
    format.ts              shared formatting
```

架构见 [doc/plugin-architecture.md](doc/plugin-architecture.md)。
