# opencode-statusline

[中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

OpenCode TUI 向けのプラグインです。provider の usage/quota を TUI dialog で表示し、prompt statusline に任意の状態フィールドを追加できます。

主な機能：

- `/usage`：現在のモデルが使っている provider の quota、usage、balance などを TUI dialog で確認できます。
- `/statusline`：OpenCode prompt のモデル/provider 表示の後ろに追加するフィールドを選択できます。
- 選択順どおりに表示される色付き statusline セグメント。
- チャットコンテキストを汚染しません。usage と statusline の情報は TUI にだけ表示され、会話履歴には入りません。

## スクリーンショット

OpenCode prompt に追加された statusline フィールドの例：

![OpenCode prompt statusline の例。repository、branch、git diff、context、cost、token、TTFT、generation speed fields を表示](doc/images/statusline-overview.jpg)

`/usage` provider quota dialog：

![OpenCode usage dialog showing provider, model, auth source, plan, and quota windows](doc/images/usage-dialog.jpg)

## インストール

プラグインを clone して build します：

```sh
git clone https://github.com/kalcohol/opencode-statusline.git
cd opencode-statusline
npm install
npm run build
```

clone したパッケージの絶対パスを確認します：

```sh
pwd
```

そのパスを OpenCode の TUI 設定に追加します。通常のグローバル設定ファイルは次の場所です：

```text
${XDG_CONFIG_HOME:-~/.config}/opencode/tui.jsonc
```

ディレクトリやファイルがまだない場合は作成して開きます：

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
${EDITOR:-vi} "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/tui.jsonc"
```

`pwd` で表示された絶対パスを使います：

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-statusline"]
}
```

すでに他のプラグインがある場合は、既存の `plugin` 配列にこのパッケージのパスを追加します：

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    "/absolute/path/to/another-plugin",
    "/absolute/path/to/opencode-statusline"
  ]
}
```

プラグイン設定を変更した後、または再 build した後は OpenCode TUI を再起動してください。OpenCode 内で `/usage` または `/statusline` を実行できれば、プラグインは読み込まれています。

既存 clone を更新する場合：

```sh
cd /absolute/path/to/opencode-statusline
git pull
npm install
npm run build
```

その後 OpenCode TUI を再起動します。

現在のプラグインでは `opencode.json` は必須ではありませんが、同じパッケージパスを入れておいても問題ありません：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-statusline"]
}
```

よく使われるグローバル設定場所：

```text
${XDG_CONFIG_HOME:-~/.config}/opencode/tui.jsonc
${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.jsonc
```

プロジェクトローカル設定も使えます：

```text
<project>/.opencode/tui.jsonc
<project>/.opencode/opencode.jsonc
```

OpenCode は現在のプロジェクトディレクトリから上位方向に `tui.json(c)` と `opencode.json(c)` を探します。`OPENCODE_CONFIG_DIR` が設定されている場合は、グローバル既定の代わりにそのディレクトリを使います。

## コマンド

### `/usage`

現在のモデルの provider usage/quota を表示します。この dialog はモデルリクエストを送らず、usage 情報を会話にも書き込みません。

現在の session、直近の TUI モデル状態、または `config.model` から active provider/model を解決します。`/usage` を開くたびに provider データを新しく取得します。

reset 時刻はローカル時刻で、固定幅の `YYYY-MM-DD HH:mm:ss` 形式で表示します。

### `/statusline`

フィールド選択 UI を開きます。フィールドを選ぶと有効/無効が切り替わります。選択した順序が prompt statusline の表示順になります。

利用できるフィールド：

| フィールド | 説明 |
| --- | --- |
| Repository | worktree または directory の basename |
| Branch | 現在の git branch 名 |
| Git diff stats | tracked file の staged+unstaged git diff 行数。`+123,-45` 形式 |
| Context used | 最新の token 付き assistant message の context 推定値 |
| Context remaining | model context limit から現在の context 推定値を引いた値 |
| Context length | 現在の model context limit |
| Context used/total | 使用済み/総 context window のコンパクト表示 |
| TTFT/speed | 初回出力までの近似時間と output token 生成速度。新しい応答が未完了の間は直近の完全な値を保持します |
| Subagent status | active subagent または child-session の状態。idle/completed の child は省略します |
| Main agent status | 現在の main session 状態。`agent` prefix は付けません。一時的な `queued`/`pending` は省略します |
| 5h quota | provider の 5h quota 使用率。利用可能な場合のみ表示 |
| Weekly quota | provider の weekly quota 使用率。利用可能な場合のみ表示 |
| Provider balance | provider が返す prepaid balance または remaining limit。`bal $12.34` 形式 |
| Session input/output tokens | session と child-session の累計 input/output tokens。`<input> in / <output> out` 形式 |
| Session total tokens | session と child-session の累計 total tokens。`<total> used` 形式。OpenCode が reasoning/cache tokens を出す場合は含めます |
| Session cost | session と child-session の累計 cost。`cost $0.02` 形式。model pricing から推定した場合は `eq $0.02` と表示します |

利用できない provider/model データは省略されます。たとえば OpenRouter は balance と usage totals を持ちますが、coding plan と同じ意味の 5h subscription quota window はないため `5h quota` は表示されません。

`Provider balance` は `/usage` dialog の balance rows を再利用します。remaining/limit remaining を優先し、次に balance/credits rows を表示します。DeepSeek、OpenRouter、OpenAI/Codex credits など balance data がある provider では表示され、money amount のない純粋な subscription quota data では省略されます。

Quota/balance fields は provider usage cache を再利用します。手動で `/usage` を実行した後は、短い `queued`/`pending` 状態や session busy 中でも statusline は cached data を優先し、fields を空にしません。

`Git diff stats` はローカル git worktree だけを読みます。HEAD に対する tracked file の変更を `git diff --numstat` と `git diff --cached --numstat` から合計します。untracked file と binary file は含めません。このフィールドは statusline refresh で再計算され、session 更新時に短い cache をクリアするため、streaming output 中に git process を過剰に起動しません。

subscription や coding plan provider では、`Session cost` は実際の課金額ではなく token 単価による等価推定になることがあります。OpenCode が message に記録した cost を優先し、ない場合だけ model catalog pricing へ fallback します。

Statusline は常に `session_prompt` を登録します。Linux/macOS では `api.ui.Prompt` を wrap し、既存の `session_prompt_right` content を保持して右側の幅を測定します。Windows では native Prompt を wrap し、statusline を Prompt の `right` content に入れますが、`session_prompt_right` を登録したり nest-read したりしないことで、新しい opencode の right-slot registration path を避けます。どちらの経路でもこの plugin の fields を動的に truncate し、prompt が次の行へ折り返さないようにします。

## 対応 Providers

`/usage` と quota statusline フィールドは現在次の provider ID に対応しています。大文字小文字は区別しません。

| Provider / plan | Provider IDs | 認証情報のヒント | 利用可能な場合に表示するデータ |
| --- | --- | --- | --- |
| Z.ai coding plan | `zai`, `zai-coding-plan` | `ZAI_API_KEY`, `ZAI_CODING_PLAN_API_KEY` | 5h/daily/weekly token quota、time quota |
| Zhipu coding plan | `zhipu`, `zhipuai`, `zhipu-coding-plan`, `zhipuai-coding-plan` | `ZHIPU_API_KEY`, `ZHIPU_CODING_PLAN_API_KEY` | 5h/daily/weekly token quota、time quota |
| Kimi Code | `kimi`, `kimi-code`, `kimi-for-coding` | `KIMI_API_KEY`, `KIMI_CODE_API_KEY` | usage windows、存在する場合は 5h window |
| MiniMax CN coding plan | `minimax`, `minimax-china-coding-plan`, `minimax-cn-coding-plan` | `MINIMAX_CHINA_CODING_PLAN_API_KEY` | 5h と weekly token quota |
| Xiaomi MiMo Token Plan | `xiaomi-mimo`, `xiaomi`, `mimo`, `mimo-token-plan`, `xiaomi-token-plan*` | model calls は `XIAOMI_TOKEN_PLAN_API_KEY` / `MIMO_API_KEY`、usage は `XIAOMI_MIMO_SESSION_COOKIE` が必要 | plan/compensation/monthly credits quota、credits remaining |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | account balance と availability |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | key label、remaining limit、total limit、usage totals |
| OpenCode Go | `opencode-go`, `opencodego` | `OPENCODE_GO_WORKSPACE_ID`, `OPENCODE_GO_AUTH_COOKIE` | 5h、weekly、monthly dashboard quota |
| OpenAI / ChatGPT / Codex OAuth | `openai`, `codex`, `chatgpt` | OpenCode `auth.json` OAuth entry | ChatGPT plan、5h/weekly quota、code review quota、credits |

API key provider は次の順序で認証情報を解決します：

1. environment variables
2. OpenCode `provider.<id>.options.apiKey`
3. runtime provider key
4. OpenCode `auth.json`

OpenAI/ChatGPT/Codex usage は `auth.json` の OAuth を使います。`opencode` / OpenCode Zen は認識されますが、OpenCode Zen は現在 public balance/quota API を公開していないため quota フィールドは省略されます。

Xiaomi MiMo Token Plan の `tp-*` key は OpenCode の model calls 用です。現在の Xiaomi usage endpoint は SSO 配下にあり、`tp-*` key は拒否されます。`/usage` と statusline quota/balance fields で Xiaomi data を表示するには、ログイン済み browser session から `XIAOMI_MIMO_SESSION_COOKIE` を設定してください。cookie を repository に commit しないでください。

`tp-*` key だけで cookie がない場合でも、Xiaomi model の識別はできます。context、session tokens、session cost、TTFT、git diff など provider usage API を使わない statusline fields はそのまま動作します。Xiaomi quota fields は省略されるか、`/usage` で cookie missing を表示します。

詳細な endpoint は [doc/provider-query-methods.ja.md](doc/provider-query-methods.ja.md) を参照してください。

## 状態ファイル

Statusline のフィールド選択は次に保存されます：

```text
${XDG_DATA_HOME:-~/.local/share}/opencode/statusline-plugin.json
```

上書き：

```text
OPENCODE_STATUSLINE_CONFIG=/path/to/statusline-plugin.json
```

TUI でモデルを切り替えた後、プラグインは OpenCode の直近モデル状態を次から読みます：

```text
${XDG_STATE_HOME:-~/.local/state}/opencode/model.json
```

state directory は次で上書きできます：

```text
OPENCODE_STATUSLINE_STATE_DIR=/path/to/opencode-state
```

## 開発

よく使うコマンド：

```sh
npm run typecheck
npm test
npm run build
```

ローカルの `/tmp` mount が Node/Vitest の書き込みを拒否する場合は、`TMPDIR` を ignored なプロジェクト内一時ディレクトリへ向けます：

```sh
mkdir -p .tmp
TMPDIR=$PWD/.tmp npm test
```

OpenCode は TUI entry を `dist/tui.tsx` から解決します。source を変更した後は、TUI で試す前に `npm run build` を実行してください。

Source layout：

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

Architecture details は [doc/plugin-architecture.ja.md](doc/plugin-architecture.ja.md) を参照してください。
