# opencode-statusline

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

OpenCode V2 TUI プラグインです。prompt footer にカスタム statusline を表示し、サードパーティ provider の quota/balance を確認できます。表示は TUI 内だけで、モデルのコンテキストには入りません。

要件:

- OpenCode `2.2.x` 以降
- TUI-only パッケージ（`cli.json` で設定）
- ローカルパスインストール用。`private` のため npm には公開しません

## 機能

- `/statusline`: statusline フィールドの選択と並び替え。
- `/quota`: 現在の provider の quota、usage、balance を表示。
- `prompt.footer.status` slot に描画し、footer のレイアウトは OpenCode が管理。
- デフォルトでは組み込み footer と重複しないフィールドのみ表示。
- コンテキストを汚染しません。

> 組み込み `/usage` は OpenCode Console/Go の limits、組み込み `/status` は MCP server の状態です。このプラグインの `/quota` はサードパーティ provider 向けで、OpenCode Go の簡易表示にも対応します。

## インストール

```sh
git clone https://github.com/kalcohol/opencode-statusline.git
cd opencode-statusline
npm install
npm run build
pwd
```

グローバルの `cli.json` に絶対パスを追加します。

```jsonc
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-statusline"]
}
```

既定の場所:

```text
${XDG_CONFIG_HOME:-~/.config}/opencode/cli.json
```

OpenCode を再起動してください。TUI-only パッケージなので `opencode.json` や旧 `tui.json` には追加しません。

## コマンド

### `/statusline`

フィールド選択ダイアログを開きます。選択順が表示順になります。

引数でも設定できます。

```text
/statusline branch repo git_diff_stats quota_5h quota_weekly
/statusline clear
```

### `/quota`

現在の provider の quota/balance を表示します。OpenCode Go は 2 経路です。OpenCode Console integration に紐づく provider は組み込み `usage.limits` を使い、独立した `opencode-go` integration は自分の API key を使います（Console データは読みません）。

- `/quota`: サードパーティ provider の quota（Z.ai、Kimi、MiniMax、MiMo、DeepSeek、OpenRouter、OpenAI OAuth）+ OpenCode Go の簡易表示。
- `/usage`: 組み込みの OpenCode Console workspace/model limits と Go limits。

## Statusline フィールド

| フィールド | 説明 | 組み込み footer |
| --- | --- | --- |
| `repo` | リポジトリ/ディレクトリ名 | sidebar にパス |
| `branch` | 現在の git branch | sidebar に `path:branch` |
| `git_diff_stats` | working tree の増減 `+12,-3` | コンパクトな合計なし |
| `context_used` | 現在のコンテキスト token | あり |
| `context_remaining` | 残りコンテキスト | なし |
| `context_length` | コンテキスト上限 | なし |
| `context_window` | 使用/上限 | あり |
| `generation_metrics` | 現在 turn の生成速度 `gen 42 tok/s` | なし |
| `subagent_status` | 実行中 subagent 数 | あり |
| `agent_status` | メイン session の実行状態 | あり（spinner） |
| `quota_5h` | provider 5h quota 使用率 | Console/Go のみ |
| `quota_weekly` | provider weekly quota 使用率 | Console/Go のみ |
| `provider_balance` | 残高/remaining limit | Console のみ |
| `session_io` | session subtree の input/output token | なし |
| `session_total` | session subtree の合計 token | なし |
| `session_cost` | session subtree のコスト | あり |

デフォルト:

```text
repo | branch | git_diff_stats | quota_5h | quota_weekly | provider_balance
```

重複フィールドは選択可能ですが、デフォルトには含めません。

`generation_metrics` は V2 の step 単位 `streamed - created` を使うため、provider-active の生成速度のみです。V2 には信頼できる text part の初回 token timestamp がないため、TTFT は表示しません。

## Providers

| Provider / plan | Provider IDs | 認証 |
| --- | --- | --- |
| Z.ai coding plan | `zai`, `zai-coding-plan` | `ZAI_API_KEY` / `ZAI_CODING_PLAN_API_KEY` または credential |
| Zhipu coding plan | `zhipu`, `zhipuai`, `zhipu-coding-plan`, `zhipuai-coding-plan` | `ZHIPU_API_KEY` / `ZHIPU_CODING_PLAN_API_KEY` または credential |
| Kimi Code | `kimi`, `kimi-code`, `kimi-for-coding` | `KIMI_API_KEY` / `KIMI_CODE_API_KEY` または credential |
| MiniMax coding plan | `minimax`, `minimax-coding-plan` | `MINIMAX_CODING_PLAN_API_KEY` / `MINIMAX_API_KEY` または credential |
| MiniMax CN | `minimax-cn`, `minimax-china-coding-plan`, `minimax-cn-coding-plan` | `MINIMAX_CHINA_CODING_PLAN_API_KEY` または credential |
| Xiaomi MiMo Token Plan | `xiaomi-mimo`, `xiaomi`, `mimo`, `mimo-token-plan`, `xiaomi-token-plan*` | モデルは API key、usage は `XIAOMI_MIMO_SESSION_COOKIE` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` または credential |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` または credential |
| OpenCode Go | `opencode-go`, `opencodego` | Console integration は組み込み usage、独立 Go integration は自身の key / `OPENCODE_API_KEY` のみ |
| OpenAI / ChatGPT / Codex OAuth | `openai`, `codex`, `chatgpt` | V2 credential store の OAuth |

認証順:

1. OpenCode V2 credential store（`context.client.credential.list()`）
2. 環境変数

`auth.json` は読みません。OpenCode Zen (`opencode`) の Console limits は組み込み `/usage` を使ってください。

詳細は [doc/provider-query-methods.ja.md](doc/provider-query-methods.ja.md) を参照してください。

## 設定保存

フィールド選択は `context.storage.store` に保存され、plugin id ごとに名前空間化されます。`statusline-plugin.json` や `OPENCODE_STATUSLINE_CONFIG` / `OPENCODE_STATUSLINE_STATE_DIR` は不要です。

## 開発

```sh
npm run typecheck
npm test
npm run build
```

`npm run build` は `tsc` の後に Babel + Solid preset で `dist/**/*.jsx` を事前コンパイルします。OpenCode は `dist/tui.js` を読み込むため、ソース変更後は再 build が必要です。

詳細は [doc/plugin-architecture.ja.md](doc/plugin-architecture.ja.md) を参照してください。
