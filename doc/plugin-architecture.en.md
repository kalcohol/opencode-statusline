# Plugin architecture (OpenCode V2)

[中文](plugin-architecture.md) | [English](plugin-architecture.en.md) | [日本語](plugin-architecture.ja.md)

`opencode-statusline` is an OpenCode V2 TUI-only plugin.

## Goals

- Configurable statusline in the prompt footer.
- Third-party provider quota/balance.
- No model context pollution.
- Reuse V2 host data instead of reimplementing session/model/token/cost logic.

## Package layout

```text
src/
  tui.tsx                  V2 plugin entry
  lib/
    statusline.ts          snapshot + pure field rendering
    statusline-view.tsx    prompt.footer.status component
    statusline-config.ts   field definitions, defaults, argument parsing
    quota.ts               built-in Go usage + provider collector bridge
    quota-dialog.tsx       /quota dialog
    providers.ts           provider barrel
    providers/             adapter registry + provider collectors
    credentials.ts         V2 credential store + env fallback
    usage-format.ts        quota report formatting
    format.ts              shared formatting
scripts/
  prepare-tui-dist.mjs     Babel/Solid precompile for dist/**/*.jsx
```

`package.json` exports only `./tui`. This is a TUI-only package configured in `cli.json` under `plugins`, not `opencode.json` or the old `tui.json`.

## Entry

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

The plugin id avoids the built-in `opencode.` namespace.

## Slot layout

Published prompt footer paths:

```text
prompt.footer
prompt.footer.status
prompt.footer.file
```

Host layout:

```text
[location ........][plugin statusline][file][built-in context/cost/commands]
```

The plugin uses `append: "prompt.footer.status"`, after location and before the built-in `PromptFooter`.

- The built-in `opencode.prompt.footer` appends to `prompt.footer` with a fixed internal order.
- The plugin controls its block relative to the built-in block, but cannot interleave fields inside it.
- Full custom order requires `replace: "prompt.footer"`, taking over spinner/location/file/goal/context/cost. Not recommended.
- The plugin returns one `<text truncate flexShrink={1} minWidth={0}>`; no prompt model-row width math.

## Data sources

| Data | V2 API |
| --- | --- |
| Selected model | `context.ui.model.current()` |
| Session model | `context.data.session.get(id)?.model` |
| Session family | `context.data.session.family(id)` |
| Session cost/tokens | `SessionInfo.cost` / `SessionInfo.tokens` |
| Context tokens | `context.data.session.message.list(id)` + last assistant with usage |
| Context limit | `context.data.location.model.list(location)` |
| Branch | `context.data.location.vcs.info(location)?.branch.current` |
| Git diff stats | `context.client.vcs.status({ location })` |
| Provider info | `context.data.location.provider.list(location)` |
| Credentials | `context.client.credential.list()` |
| OpenCode Go usage | `context.client.experimental.usage.limits()` |
| Settings | `context.storage.store()` |

V2 data is reactive, so the plugin no longer needs:

- `model.json` polling
- `session_prompt` wrapping
- child-session SDK traversal
- `git diff` subprocesses
- delayed full rebuilds after events
- manual dialog lifecycle / esc bindings

## Refresh model

- Session/message/model/provider data updates through the Solid store.
- Git diff and quota refresh on:
  - `session.execution.succeeded`
  - `session.execution.failed`
  - `session.execution.interrupted`
  - a 60 second interval while quota or git diff fields are enabled
- Async results are guarded by key and version, so switching provider/location does not show the previous account's data.
- Third-party provider collectors use a 30 second fresh cache and a 10 minute stale fallback. Built-in OpenCode Go usage is read each time.

## Fields

Field definitions live in `statusline-config.ts`; rendering lives in `statusline.ts`.

Defaults only include capabilities the built-in footer lacks:

```text
repo | branch | git_diff_stats | quota_5h | quota_weekly | provider_balance
```

Context/cost/subagent/agent status remain available but are not default, to avoid duplicate numbers.

`generation_metrics` uses the current turn's assistant steps:

```text
tokensPerSecond = sum(output + reasoning) / sum(streamed - created)
```

V2 `streamed` is the provider response body end, not first-token time, so the plugin does not report TTFT.

## Commands

### `/statusline`

- No arguments: open the field picker.
- With arguments: replace fields, e.g. `/statusline branch repo quota_5h`.
- `clear`: empty the field list.
- Declares `slash.arguments: true` so command text never becomes a normal model prompt.
- Saves through `context.storage.store("settings")`.

### `/quota`

- Resolves the current route/session/model/provider.
- A Go provider bound to the OpenCode Console integration calls `client.experimental.usage.limits()` and reads `data.go`.
- A standalone `opencode-go` integration does not read built-in Console data; it uses its own key collector.
- Other providers use collectors.
- The dialog uses `scrollbox` for height.
- Never writes to the conversation.

## Provider layer

`providers.ts` is only a barrel. Each provider lives in `providers/` as an adapter, and `registry.ts` selects one through a static exact-alias Map. The registry centrally owns integration fail-closed checks, credential resolution, cache keys, TTL/stale/inflight; adapters only fetch and parse.

Every adapter normalizes into `UsageReport`:

```ts
{
  ok, providerID, providerName, modelID, generatedAtMs,
  auth, plan, windows, balances, items, error
}
```

Each collector:

1. resolves credentials from the V2 credential store or env
2. queries the provider endpoint
3. normalizes quota/balance
4. returns an error report instead of throwing

Credential order:

1. active credential matching the integrationID in `context.client.credential.list()`
2. environment variables

`auth.json` is no longer read. OpenAI OAuth only accepts `openai`/`codex`/`chatgpt` integrations, so an OpenCode Console token cannot be sent to the ChatGPT endpoint.

OpenCode Go uses built-in `usage.limits` without an extra API key only when `integrationID === "opencode"`. A standalone `opencode-go` integration uses `OPENCODE_API_KEY` or its own integration key and never reads Console credentials.

## Build

- `tsc` emits `.js` / `.jsx` / `.d.ts`.
- `scripts/prepare-tui-dist.mjs` recursively transforms `dist/**/*.jsx` with Babel + `babel-preset-solid`.
- `dist/tui.js` is the V2 TUI entry.
- Dependencies:
  - `@opencode/plugin` / `@opencode/client` as dependencies
  - `@opentui/core` / `@opentui/solid` / `solid-js` as peers

## Limits

- `prompt.footer.status` is block-level; fields cannot interleave with built-in context/cost.
- Narrow terminals truncate trailing fields; reorder with `/statusline`.
- Third-party usage endpoints are undocumented and may change.
- OpenCode Console/Zen workspace limits remain owned by built-in `/usage`.
