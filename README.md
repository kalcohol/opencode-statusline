# opencode-statusline

Small OpenCode plugin for:

- `/usage`: show usage/quota info for the current session provider without adding it to model context.
- `/statusline`: configure extra fields shown on the prompt status line.

## Structure

```text
src/
  index.ts                 package server entry
  plugin.ts                slash command hooks
  tui.tsx                  TUI slots and interactive statusline picker
  lib/
    auth.ts                env/config/auth.json credential lookup
    opencode-client.ts     OpenCode SDK compatibility helpers
    providers.ts           provider usage collectors
    statusline.ts          TUI statusline renderer
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

Yes, build first. OpenCode resolves the server entry from `dist/index.js` and the TUI entry from `dist/tui.tsx`.

1. Run `npm install` once.
2. Run `npm run build` after source changes.
3. Add this repository path to both OpenCode config files using your own local path.
4. Restart the OpenCode TUI.
5. Run `/usage` in a session to verify ignored, no-reply usage output.
6. Run `/statusline` to open the TUI field picker, or use the manual form:

```text
/statusline repo branch context_window quota_5h session_total
```

The statusline updates after selection changes, session/message events, and periodically while the TUI is open.

## OpenCode config

Add the package/path as both a server and TUI plugin so `/usage` can inject ignored output and the statusline can render in the prompt.

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

`opencode.json` or `opencode.jsonc`:

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
