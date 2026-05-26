# opencode-statusline

Small OpenCode TUI plugin for:

- `/usage`: show usage/quota info for the current session provider in a dialog without adding it to model context.
- `/statusline`: configure extra fields shown on the prompt status line.

## Structure

```text
src/
  index.ts                 package server entry
  plugin.ts                empty server shim
  tui.tsx                  TUI slots and interactive statusline picker
  lib/
    auth.ts                env/config/auth.json credential lookup
    opencode-client.ts     OpenCode SDK compatibility helpers
    providers.ts           provider usage collectors
    statusline.ts          TUI statusline renderer
    tui-usage.ts           TUI /usage dialog renderer
    statusline-config.ts   persisted field selection
    usage-format.ts        command output formatting
    format.ts              shared format helpers
```

## Build

```sh
npm install
npm run build
```

## Local test

Yes, build first. OpenCode resolves the TUI entry from `dist/tui.tsx`.

1. Run `npm install` once.
2. Run `npm run build` after source changes.
3. Add this repository path to `tui.json` using your own local path. Keeping it in `opencode.json` is harmless but no longer required.
4. Restart the OpenCode TUI.
5. Run `/usage` in a session to verify the usage dialog opens without sending a model request.
6. Run `/statusline` to open the TUI field picker.

The statusline updates after selection changes, session/message events, and periodically while the TUI is open.

Available statusline fields:

- Repository, branch
- Context used, context remaining, context length, context used/total
- Subagent status, main agent status
- 5h quota, weekly quota
- Session input/output tokens, session total tokens

Fields are rendered in the order selected in `/statusline`; unavailable provider/model data is omitted. Field groups are color-coded in the TUI, with muted separators.

## OpenCode config

Add the package/path as a TUI plugin so `/usage` and `/statusline` are handled before they enter chat context.

Default global locations:

```text
${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.jsonc
${XDG_CONFIG_HOME:-~/.config}/opencode/tui.jsonc
```

Project-local locations are also supported. The `.opencode/` form keeps OpenCode config out of the repository root:

```text
<project>/.opencode/opencode.jsonc
<project>/.opencode/tui.jsonc
```

OpenCode also reads `opencode.json(c)` and `tui.json(c)` while walking up from the current project directory. If `OPENCODE_CONFIG_DIR` is set, use that directory instead of the global default.

`opencode.json` or `opencode.jsonc` is not required for the current plugin, but keeping the same package path there is harmless:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["<path-to-this-repo>"]
}
```

`tui.json` or `tui.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["<path-to-this-repo>"]
}
```

The statusline selection is stored at `~/.local/share/opencode/statusline-plugin.json` by default. Override it with `OPENCODE_STATUSLINE_CONFIG`.
For `/usage` after a TUI model switch, the plugin reads OpenCode's recent model state at `${XDG_STATE_HOME:-~/.local/state}/opencode/model.json`. Override that directory with `OPENCODE_STATUSLINE_STATE_DIR`.
