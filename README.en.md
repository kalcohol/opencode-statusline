# opencode-statusline

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

OpenCode V2 TUI plugin: a configurable statusline in the prompt footer plus third-party provider quota/balance. Everything renders in the TUI only and never enters model context.

Requirements:

- OpenCode `2.2.x` or newer
- TUI-only package (configured in `cli.json`)
- Local-path install; the package is `private` and is not published to npm

## Features

- `/statusline`: choose and order statusline fields.
- `/quota`: inspect the active provider's quota, usage, and balance.
- Renders through the `prompt.footer.status` slot; OpenCode owns footer layout.
- Defaults avoid duplicating the built-in footer.
- Zero context pollution.

> Built-in `/usage` shows OpenCode Console/Go limits. Built-in `/status` shows MCP server status. This plugin's `/quota` targets third-party providers and also offers a convenience view for OpenCode Go.

## Install

```sh
git clone https://github.com/kalcohol/opencode-statusline.git
cd opencode-statusline
npm install
npm run build
pwd
```

Add the absolute path to the global `cli.json`:

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-statusline"]
}
```

Default location:

```text
${XDG_CONFIG_HOME:-~/.config}/opencode/cli.json
```

Restart OpenCode. Do **not** add this TUI-only package to `opencode.json` or the old `tui.json`.

## Commands

### `/statusline`

Open the field picker. Selecting a field toggles it; selection order is display order.

Direct arguments are also supported:

```text
/statusline branch repo git_diff_stats quota_5h quota_weekly
/statusline clear
```

### `/quota`

Show the current provider's quota/balance. OpenCode Go has two paths: a provider bound to the OpenCode Console integration uses built-in `usage.limits`; a standalone `opencode-go` integration uses its own API key and does not read Console data. When a refresh fails, the dialog shows the `Updated` time and a `Cache: stale` marker instead of presenting old data as live.

- `/quota`: third-party coding plan/provider quota (Z.ai, Kimi, MiniMax, MiMo, DeepSeek, OpenRouter, OpenAI OAuth) plus an OpenCode Go convenience view.
- `/usage`: built-in OpenCode Console workspace/model limits and Go limits.

## Statusline fields

| Field | Description | Built-in footer |
| --- | --- | --- |
| `repo` | Repository/directory basename | sidebar shows path |
| `branch` | Current git branch | sidebar shows `path:branch` |
| `git_diff_stats` | Working tree additions/deletions `+12,-3`; shown only in a VCS repo | no compact totals |
| `context_used` | Current context tokens | yes |
| `context_remaining` | Remaining context | no |
| `context_length` | Context limit | no |
| `context_window` | Used/total context | yes |
| `generation_metrics` | Current session turn generation speed `gen 42 tok/s` | no |
| `family_generation` | Current session + active subagents wall-clock union speed `family gen 42 tok/s`; off by default | no |
| `subagent_status` | Running subagent count; briefly shows `sub N done` with speed when available | running count only |
| `agent_status` | Main session running state | yes (spinner) |
| `quota_5h` | Provider 5h quota percent | Console/Go only |
| `quota_weekly` | Provider weekly quota percent | Console/Go only |
| `provider_balance` | Balance/remaining limit | Console only |
| `session_io` | Session subtree input/output tokens | no |
| `session_total` | Session subtree total tokens | no |
| `session_cost` | Session subtree cost | yes |

Default fields:

```text
repo | branch | git_diff_stats | quota_5h | quota_weekly | provider_balance
```

Duplicate fields remain available but are omitted from defaults.

`generation_metrics` uses V2 step-level `streamed - created` for the current session only. V2 has no reliable text-part first-token timestamp, so the plugin does not report TTFT.

`family_generation` is off by default. It unions the `[created, streamed]` intervals of the current session and subagents, so concurrent subagents do not double-count overlapping time. It is omitted when messages or turn attribution are incomplete.

## Providers

| Provider / plan | Provider IDs | Credentials |
| --- | --- | --- |
| Z.ai coding plan | `zai`, `zai-coding-plan` | `ZAI_API_KEY` / `ZAI_CODING_PLAN_API_KEY` or credential |
| Zhipu coding plan | `zhipu`, `zhipuai`, `zhipu-coding-plan`, `zhipuai-coding-plan` | `ZHIPU_API_KEY` / `ZHIPU_CODING_PLAN_API_KEY` or credential |
| Kimi Code | `kimi`, `kimi-code`, `kimi-for-coding` | `KIMI_API_KEY` / `KIMI_CODE_API_KEY` or credential |
| MiniMax coding plan | `minimax`, `minimax-coding-plan` | `MINIMAX_CODING_PLAN_API_KEY` / `MINIMAX_API_KEY` or credential |
| MiniMax CN | `minimax-cn`, `minimax-china-coding-plan`, `minimax-cn-coding-plan` | `MINIMAX_CHINA_CODING_PLAN_API_KEY` or credential |
| Xiaomi MiMo Token Plan | `xiaomi-mimo`, `xiaomi`, `mimo`, `mimo-token-plan`, `xiaomi-token-plan*` | API key for models; usage requires `XIAOMI_MIMO_SESSION_COOKIE` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` or credential |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` or credential |
| OpenCode Go | `opencode-go`, `opencodego` | Console integration uses built-in usage; standalone Go integration uses only its own key / `OPENCODE_API_KEY` |
| OpenAI / ChatGPT / Codex OAuth | `openai`, `codex`, `chatgpt` | OAuth in the V2 credential store |

Credential order:

1. OpenCode V2 credential store (`context.client.credential.list()`)
2. Environment variables

`auth.json` is no longer read. Use the built-in `/usage` for OpenCode Zen (`opencode`) Console limits.

See [doc/provider-query-methods.en.md](doc/provider-query-methods.en.md) for endpoints.

## Storage

Field selection is stored through `context.storage.store` and namespaced by the plugin id. There is no separate `statusline-plugin.json` and no `OPENCODE_STATUSLINE_CONFIG` / `OPENCODE_STATUSLINE_STATE_DIR`.

## Development

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` emits with `tsc`, then precompiles `dist/**/*.jsx` with Babel + the Solid preset. OpenCode loads `dist/tui.js`, so rebuild after source changes.

See [doc/plugin-architecture.en.md](doc/plugin-architecture.en.md).
