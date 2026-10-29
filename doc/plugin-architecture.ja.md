# プラグイン構成（OpenCode V2）

[中文](plugin-architecture.md) | [English](plugin-architecture.en.md) | [日本語](plugin-architecture.ja.md)

`opencode-statusline` は OpenCode V2 の TUI-only プラグインです。

## 目的

- prompt footer に設定可能な statusline を表示する。
- サードパーティ provider の quota/balance を表示する。
- モデルのコンテキストを汚染しない。
- V2 のホストデータを再利用し、session/model/token/cost を再実装しない。

## パッケージ構成

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

`package.json` は `./tui` のみを export します。TUI-only パッケージなので、`cli.json` の `plugins` に設定します。`opencode.json` や旧 `tui.json` は使いません。

## エントリ

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

plugin id は組み込みの `opencode.` namespace を避けます。

## Slot レイアウト

公開されている prompt footer path:

```text
prompt.footer
prompt.footer.status
prompt.footer.file
```

ホストの構造:

```text
[location ........][plugin statusline][file][built-in context/cost/commands]
```

プラグインは `append: "prompt.footer.status"` を使い、location の後、組み込み `PromptFooter` の前に表示します。

- 組み込み `opencode.prompt.footer` は `prompt.footer` に append され、内部順序は固定です。
- プラグインは組み込みブロックとの前後関係だけを制御できます。内部へのフィールド挿入はできません。
- 完全な順序変更には `replace: "prompt.footer"` が必要で、spinner/location/file/goal/context/cost をすべて引き継ぐため非推奨です。
- プラグインは `<text truncate flexShrink={1} minWidth={0}>` を 1 つ返し、prompt model row の幅計算はしません。

## データソース

| データ | V2 API |
| --- | --- |
| 選択モデル | `context.ui.model.current()` |
| session model | `context.data.session.get(id)?.model` |
| session family | `context.data.session.family(id)` |
| session cost/tokens | `SessionInfo.cost` / `SessionInfo.tokens` |
| context tokens | `context.data.session.message.list(id)` + 最後の usage 付き assistant |
| context limit | `context.data.location.model.list(location)` |
| branch | `context.data.location.vcs.info(location)?.branch.current` |
| git diff stats | `context.client.vcs.status({ location })` |
| provider 情報 | `context.data.location.provider.list(location)` |
| credential | `context.client.credential.list()` |
| OpenCode Go usage | `context.client.experimental.usage.limits()` |
| 設定 | `context.storage.store()` |

V2 データは reactive なので、以下は不要です。

- `model.json` polling
- `session_prompt` wrapping
- child session SDK traversal
- `git diff` subprocess
- event 後の遅延再構築
- 手動 dialog lifecycle / esc binding

## 更新モデル

- session/message/model/provider は Solid store で更新されます。
- git diff と quota は以下で更新します。
  - `session.execution.succeeded`
  - `session.execution.failed`
  - `session.execution.interrupted`
  - quota または git diff フィールド有効時の 60 秒 interval
- 非同期結果は key と version でガードし、provider/location 切替時に前のデータを表示しません。
- サードパーティ provider collector は 30 秒 fresh cache、10 分 stale fallback を使い、stale 結果は `Cache: stale` と表示します。OpenCode Go の組み込み usage は 30 秒 fresh cache、5 分 stale fallback を使います。

## フィールド

定義は `statusline-config.ts`、描画は `statusline.ts` です。

デフォルトは組み込み footer にない能力だけです。

```text
repo | branch | git_diff_stats | quota_5h | quota_weekly | provider_balance
```

context/cost/subagent/agent status は選択可能ですが、重複を避けるためデフォルトでは無効です。

`generation_metrics` は現在 session の turn の assistant steps を使います。

```text
tokensPerSecond = sum(output + reasoning) / sum(streamed - created)
```

V2 の `streamed` は provider response body の終了時刻であり、初回 token 時刻ではないため TTFT は表示しません。

`family_generation` はデフォルト無効です。現在 session と subagent の `[created, streamed]` 区間を wall-clock union し、`sum(output + reasoning) / union` で family throughput を計算します。並行 subagent の重複時間は 1 回だけ数えます。メッセージ未同期や turn 归属が不明な場合は省略します。

## コマンド

### `/statusline`

- 引数なし: フィールド選択 dialog。
- 引数あり: フィールドを置換（例 `/statusline branch repo quota_5h`）。
- `clear`: フィールドを空にする。
- `slash.arguments: true` を宣言し、コマンド文字列が通常の prompt として送信されないようにします。
- `context.storage.store("settings")` に保存します。

### `/quota`

- 現在の route/session/model/provider を解決します。
- OpenCode Console integration に紐づく Go provider は `client.experimental.usage.limits()` の `data.go` を使います。
- 独立した `opencode-go` integration は組み込み Console データを読まず、自分の key collector を使います。
- その他の provider は collector を使います。
- dialog は `scrollbox` で高さを制限します。
- 会話には書き込みません。

## Provider 層

`providers.ts` は barrel です。各 provider は `providers/` の adapter として実装し、`registry.ts` が静的な exact alias Map で選択します。integration の fail-closed、credential 解決、cache key、TTL/stale/inflight は registry が集中管理し、adapter は取得と解析だけを担当します。

すべての adapter は `UsageReport` に正規化します。

```ts
{
  ok, providerID, providerName, modelID, generatedAtMs,
  auth, plan, windows, balances, items, error
}
```

各 collector:

1. V2 credential store または env から credential を解決
2. provider endpoint を呼び出す
3. quota/balance を正規化
4. 例外ではなく error report を返す

Credential 順:

1. `context.client.credential.list()` の integrationID に一致する active credential
2. 環境変数

`auth.json` は読みません。OpenAI OAuth は `openai`/`codex`/`chatgpt` integration のみを受け入れ、OpenCode Console token が ChatGPT endpoint に送られないようにします。

OpenCode Go が組み込み `usage.limits` を使えるのは `integrationID === "opencode"` の場合だけです。独立した `opencode-go` integration は `OPENCODE_API_KEY` または自分の integration key を使い、Console credential は読みません。

## ビルド

- `tsc` が `.js` / `.jsx` / `.d.ts` を出力。
- `scripts/prepare-tui-dist.mjs` が `dist/**/*.jsx` を Babel + `babel-preset-solid` で変換。
- `dist/tui.js` が V2 TUI entry。
- 依存:
  - `@opencode/plugin` / `@opencode/client` は dependency
  - `@opentui/core` / `@opentui/solid` / `solid-js` は peer

## 制限

- `prompt.footer.status` はブロック単位で、組み込み context/cost とフィールドを交互に並べることはできません。
- 狭い terminal では末尾フィールドが truncate されます。`/statusline` で順序を変更してください。
- サードパーティ usage endpoint は非公開で変更される可能性があります。
- OpenCode Console/Zen の workspace limits は組み込み `/usage` が担当します。
