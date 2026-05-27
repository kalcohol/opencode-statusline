# opencode-statusline

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

OpenCode TUI plugin for provider usage dialogs and configurable prompt statusline fields.

It adds:

- `/usage` to inspect the active provider's quota, usage, and balance data in a TUI dialog.
- `/statusline` to choose extra fields shown after OpenCode's prompt model/provider label.
- Colored statusline segments, ordered exactly as selected.
- No chat-context pollution: usage and statusline data are rendered only in the TUI.

## Screenshots

Example statusline fields appended to the OpenCode prompt:

![OpenCode prompt statusline with selected repository, branch, context, quota, token, TTFT, and generation speed fields](doc/images/statusline-overview.jpg)

`/usage` provider quota dialog:

![OpenCode usage dialog showing provider, model, auth source, plan, and quota windows](doc/images/usage-dialog.jpg)

## Install

Clone and build the plugin:

```sh
git clone https://github.com/kalcohol/opencode-statusline.git
cd opencode-statusline
npm install
npm run build
```

Get the absolute path to the cloned package:

```sh
pwd
```

Add that package path to OpenCode's TUI config. The usual global config file is:

```text
${XDG_CONFIG_HOME:-~/.config}/opencode/tui.jsonc
```

Create the directory/file if needed:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
${EDITOR:-vi} "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/tui.jsonc"
```

Use the absolute path printed by `pwd`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-statusline"]
}
```

If the file already has plugins, append this package path to the existing `plugin` array:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "/absolute/path/to/another-plugin",
    "/absolute/path/to/opencode-statusline"
  ]
}
```

Restart the OpenCode TUI after changing plugin config or rebuilding the package. Then run `/usage` or `/statusline` inside OpenCode to verify the plugin is loaded.

To update an existing clone:

```sh
cd /absolute/path/to/opencode-statusline
git pull
npm install
npm run build
```

Then restart the OpenCode TUI.

`opencode.json` is not required for the current plugin, but keeping the same package path there is harmless:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-statusline"]
}
```

Common global config locations:

```text
${XDG_CONFIG_HOME:-~/.config}/opencode/tui.jsonc
${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.jsonc
```

Project-local config is also supported:

```text
<project>/.opencode/tui.jsonc
<project>/.opencode/opencode.jsonc
```

OpenCode also walks upward from the current project directory for `tui.json(c)` and `opencode.json(c)`. If `OPENCODE_CONFIG_DIR` is set, use that directory instead of the global default.

## Commands

### `/usage`

Shows usage/quota details for the active model's provider. The dialog does not send a model request and does not write usage data into the conversation.

The command resolves the active provider/model from the current session, recent TUI model state, or `config.model`. It fetches provider data fresh when opened.

Reset timestamps are shown in local time using fixed-width `YYYY-MM-DD HH:mm:ss` fields.

### `/statusline`

Opens a field picker. Selecting a field toggles it. The order you select fields is the order used in the prompt statusline.

Available fields:

| Field | Description |
| --- | --- |
| Repository | worktree or directory basename |
| Branch | current git branch name |
| Context used | latest assistant context token estimate |
| Context remaining | model context limit minus current context estimate |
| Context length | current model context limit |
| Context used/total | compact used/limit display |
| TTFT/speed | approximate time to first output and output token generation speed; keeps the last complete value while a new response is still incomplete |
| Subagent status | active subagent or child-session status; idle/completed children are omitted |
| Main agent status | current main session status, without an `agent` prefix |
| 5h quota | provider 5h quota used percent, when available |
| Weekly quota | provider weekly quota used percent, when available |
| Session input/output tokens | accumulated session and child-session input/output tokens as `<input> in / <output> out` |
| Session total tokens | accumulated session and child-session total tokens as `<total> used`; includes reasoning/cache tokens when OpenCode exposes them |
| Session cost | accumulated session and child-session cost as `cost $0.02`; shows `eq $0.02` when estimated from model pricing |

Unavailable provider/model data is omitted. For example, OpenRouter has balance and usage totals, but no 5h subscription quota window.

For subscription or coding-plan providers, `Session cost` may be an equivalent per-token estimate rather than an actual amount charged. It prefers OpenCode's recorded message cost when present, then falls back to model catalog pricing.

The statusline preserves OpenCode's existing right-side prompt content. It measures that content and dynamically truncates this plugin's fields to avoid wrapping onto the next line.

## Supported Providers

`/usage` and quota statusline fields currently support these provider IDs. Matching is case-insensitive.

| Provider / plan | Provider IDs | Credential hints | Data shown when available |
| --- | --- | --- | --- |
| Z.ai coding plan | `zai`, `zai-coding-plan` | `ZAI_API_KEY`, `ZAI_CODING_PLAN_API_KEY` | 5h/daily/weekly token quota, time quota |
| Zhipu coding plan | `zhipu`, `zhipuai`, `zhipu-coding-plan`, `zhipuai-coding-plan` | `ZHIPU_API_KEY`, `ZHIPU_CODING_PLAN_API_KEY` | 5h/daily/weekly token quota, time quota |
| Kimi Code | `kimi`, `kimi-code`, `kimi-for-coding` | `KIMI_API_KEY`, `KIMI_CODE_API_KEY` | usage windows, including 5h when present |
| MiniMax CN coding plan | `minimax`, `minimax-china-coding-plan`, `minimax-cn-coding-plan` | `MINIMAX_CHINA_CODING_PLAN_API_KEY` | 5h and weekly token quota |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | account balance and availability |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | key label, remaining limit, total limit, usage totals |
| OpenCode Go | `opencode-go`, `opencodego` | `OPENCODE_GO_WORKSPACE_ID`, `OPENCODE_GO_AUTH_COOKIE` | 5h, weekly, and monthly dashboard quota |
| OpenAI / ChatGPT / Codex OAuth | `openai`, `codex`, `chatgpt` | OAuth entry in OpenCode `auth.json` | ChatGPT plan, 5h/weekly quota, code review quota, credits |

API-key providers resolve credentials in this order:

1. environment variables
2. OpenCode `provider.<id>.options.apiKey`
3. runtime provider key
4. OpenCode `auth.json`

OpenAI/ChatGPT/Codex usage uses OAuth from `auth.json`. `opencode` / OpenCode Zen is recognized, but OpenCode Zen does not currently expose a public balance/quota API, so quota fields are omitted.

Detailed endpoint notes are in [doc/provider-query-methods.en.md](doc/provider-query-methods.en.md).

## State Files

The statusline field selection is stored at:

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/statusline-plugin.json
```

Override with:

```text
OPENCODE_STATUSLINE_CONFIG=/path/to/statusline-plugin.json
```

After a TUI model switch, the plugin reads OpenCode's recent model state from:

```text
${XDG_STATE_HOME:-~/.local/state}/opencode/model.json
```

Override the state directory with:

```text
OPENCODE_STATUSLINE_STATE_DIR=/path/to/opencode-state
```

## Development

Useful commands:

```sh
npm run typecheck
npm test
npm run build
```

If the local `/tmp` mount rejects Node/Vitest writes, point `TMPDIR` at an ignored project-local directory:

```sh
mkdir -p .tmp
TMPDIR=$PWD/.tmp npm test
```

OpenCode resolves the TUI entry from `dist/tui.tsx`, so run `npm run build` after source changes before testing in the TUI.

Source layout:

```text
src/
  index.ts                 package server entry
  plugin.ts                empty server shim
  tui.tsx                  TUI slots, dialogs, slash commands, statusline rendering
  lib/
    auth.ts                env/config/auth.json credential lookup
    opencode-client.ts     active model resolution helpers
    providers.ts           provider usage collectors
    statusline.ts          statusline field renderer
    statusline-config.ts   persisted field selection
    tui-usage.ts           /usage dialog text builder
    usage-format.ts        usage report formatting
    format.ts              shared formatting helpers
```

Architecture details are in [doc/plugin-architecture.en.md](doc/plugin-architecture.en.md).
