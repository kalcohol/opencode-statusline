/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { useTerminalDimensions } from "@opentui/solid";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { buildTuiStatusline } from "./lib/statusline.js";
import { buildTuiUsageText } from "./lib/tui-usage.js";
import {
  STATUSLINE_FIELDS,
  loadStatuslineConfig,
  saveStatuslineConfig,
  uniqueFields,
  type StatuslineFieldID
} from "./lib/statusline-config.js";
import { truncateText } from "./lib/format.js";

const id = "opencode-statusline";
const STATUSLINE_SLOT_ORDER = 95;
const REFRESH_INTERVAL_MS = 30_000;
const EVENT_REFRESH_DELAY_MS = 150;
const configListeners = new Set<() => void>();
let usageDialogOpen = false;

function notifyConfigChanged(): void {
  for (const listener of configListeners) listener();
}

function onConfigChanged(listener: () => void): () => void {
  configListeners.add(listener);
  return () => configListeners.delete(listener);
}

function StatuslineDialog(props: {
  api: TuiPluginApi;
  initialFields?: StatuslineFieldID[];
  current?: StatuslineFieldID;
}): JSX.Element {
  const [fields, setFields] = createSignal<StatuslineFieldID[]>(props.initialFields ?? loadStatuslineConfig().fields);

  const toggle = (field: StatuslineFieldID) => {
    const current = fields();
    const next = current.includes(field)
      ? current.filter((item) => item !== field)
      : [...current, field];
    const normalized = uniqueFields(next);
    setFields(normalized);
    saveStatuslineConfig({ version: 1, fields: normalized });
    notifyConfigChanged();
    setTimeout(() => {
      props.api.ui.dialog.replace(() => <StatuslineDialog api={props.api} initialFields={normalized} current={field} />);
    }, 0);
  };

  const options = () =>
    STATUSLINE_FIELDS.map((field) => {
      const index = fields().indexOf(field.id);
      const selected = index >= 0;
      return {
        title: `${selected ? "[x]" : "[ ]"} ${field.label}`,
        value: field.id,
        description: selected ? `#${index + 1} ${field.id}` : field.id,
        onSelect: () => toggle(field.id)
      };
    });

  return (
    <props.api.ui.DialogSelect
      title="Statusline fields"
      placeholder="Search fields"
      options={options()}
      skipFilter={false}
      current={props.current}
    />
  );
}

function openStatuslineDialog(api: TuiPluginApi): void {
  api.ui.dialog.replace(() => <StatuslineDialog api={api} />);
}

function currentSessionID(api: TuiPluginApi): string | undefined {
  const route = api.route.current;
  if (route.name !== "session") return undefined;
  return typeof route.params?.sessionID === "string" ? route.params.sessionID : undefined;
}

function usageRows(message: string): Array<{ label?: string; value: string }> {
  return message
    .split("\n")
    .filter((line, index) => !(index === 0 && line === "OpenCode Usage"))
    .map((line) => {
      if (!line.trim()) return { value: "" };
      const separator = line.indexOf(":");
      if (separator <= 0) return { value: line };
      return {
        label: line.slice(0, separator),
        value: line.slice(separator + 1).trim()
      };
    });
}

function closeUsageDialog(api: TuiPluginApi): void {
  if (!usageDialogOpen) return;
  usageDialogOpen = false;
  api.ui.dialog.clear();
}

function UsageDialog(props: { api: TuiPluginApi; message: string; onClose: () => void }): JSX.Element {
  const theme = () => props.api.theme.current;
  const rows = createMemo(() => usageRows(props.message));
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme().text} attributes={TextAttributes.BOLD}>
          OpenCode Usage
        </text>
        <text fg={theme().textMuted} onMouseUp={props.onClose}>
          esc
        </text>
      </box>
      <box gap={0} paddingBottom={1}>
        <For each={rows()}>
          {(row) => (
            <Show
              when={row.value}
              fallback={<box height={1} />}
            >
              <box flexDirection="row" gap={1} width="100%">
                <Show when={row.label} fallback={<text fg={theme().textMuted} wrapMode="word" width="100%">{row.value}</text>}>
                  {(label) => (
                    <>
                      <text fg={theme().textMuted} width={16} flexShrink={0} wrapMode="none">
                        {label()}
                      </text>
                      <text fg={theme().text} wrapMode="word" width="100%">
                        {row.value}
                      </text>
                    </>
                  )}
                </Show>
              </box>
            </Show>
          )}
        </For>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme().primary}
          onMouseUp={props.onClose}
        >
          <text fg={theme().selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  );
}

function showUsageDialog(api: TuiPluginApi, message: string): void {
  api.ui.dialog.replace(
    () => <UsageDialog api={api} message={message} onClose={() => closeUsageDialog(api)} />,
    () => {
      usageDialogOpen = false;
    }
  );
  usageDialogOpen = true;
  api.ui.dialog.setSize("large");
}

function openUsageDialog(api: TuiPluginApi): void {
  const sessionID = currentSessionID(api) ?? "";
  const notice = sessionID ? "" : "No open session: using configured or recent model.\n\n";
  showUsageDialog(api, "Loading usage...");
  void buildTuiUsageText(api, sessionID)
    .then((message) => showUsageDialog(api, `${notice}${message}`))
    .catch((err) => {
      const message = err instanceof Error && err.message ? err.message : "Could not load usage.";
      showUsageDialog(api, `Usage unavailable\n\n${message}`);
    });
}

function StatuslineView(props: { api: TuiPluginApi; sessionID: string }): JSX.Element {
  const [text, setText] = createSignal("");
  const dimensions = useTerminalDimensions();
  const maxWidth = createMemo(() => Math.max(16, Math.min(72, Math.floor(dimensions().width * 0.42))));
  const displayText = createMemo(() => truncateText(text(), maxWidth()));
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  let version = 0;

  const reload = () => {
    if (disposed) return;
    const currentVersion = ++version;
    void buildTuiStatusline(props.api, props.sessionID)
      .then((next) => {
        if (disposed || currentVersion !== version) return;
        setText(next);
      })
      .catch(() => {
        if (disposed || currentVersion !== version) return;
        setText("statusline error");
      });
  };

  const queueReload = () => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      reload();
    }, EVENT_REFRESH_DELAY_MS);
    timers.add(timer);
  };

  createEffect(reload);

  const interval = setInterval(reload, REFRESH_INTERVAL_MS);
  const unsubscribers = [
    onConfigChanged(queueReload),
    props.api.event.on("session.updated", (event) => {
      if ((event as any).properties?.info?.id === props.sessionID) queueReload();
    }),
    props.api.event.on("message.updated", (event) => {
      if ((event as any).properties?.info?.sessionID === props.sessionID) queueReload();
    }),
    props.api.event.on("message.removed", (event) => {
      if ((event as any).properties?.sessionID === props.sessionID) queueReload();
    }),
    props.api.event.on("tui.session.select", (event) => {
      if ((event as any).properties?.sessionID === props.sessionID) queueReload();
    })
  ];

  onCleanup(() => {
    disposed = true;
    clearInterval(interval);
    for (const timer of timers) clearTimeout(timer);
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  return (
    <Show when={text()}>
      <box flexShrink={0}>
        <text fg={props.api.theme.current.textMuted} wrapMode="none" flexShrink={0}>
          {displayText()}
        </text>
      </box>
    </Show>
  );
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: STATUSLINE_SLOT_ORDER,
    slots: {
      session_prompt(_ctx, props: {
        session_id: string;
        visible?: boolean;
        disabled?: boolean;
        on_submit?: () => void;
        ref?: (ref: unknown) => void;
      }) {
        return (
          <api.ui.Prompt
            sessionID={props.session_id}
            visible={props.visible}
            disabled={props.disabled}
            onSubmit={props.on_submit}
            ref={props.ref as any}
            right={<StatuslineView api={api} sessionID={props.session_id} />}
          />
        );
      }
    }
  });

  api.keymap.registerLayer({
    commands: [
      {
        namespace: "palette",
        name: "opencode-statusline.usage",
        title: "Provider usage",
        desc: "Show current provider usage without adding it to model context",
        category: "System",
        slashName: "usage",
        run() {
          openUsageDialog(api);
        }
      },
      {
        namespace: "dialog",
        name: "opencode-statusline.usage.close",
        title: "Close usage dialog",
        hidden: true,
        enabled: () => usageDialogOpen,
        run() {
          closeUsageDialog(api);
        }
      },
      {
        namespace: "palette",
        name: "opencode-statusline.configure",
        title: "Statusline fields",
        desc: "Configure prompt statusline fields",
        category: "System",
        slashName: "statusline",
        run() {
          openStatuslineDialog(api);
        }
      }
    ],
    bindings: [
      {
        key: "return",
        desc: "Close usage dialog",
        group: "Dialog",
        cmd: "opencode-statusline.usage.close"
      }
    ]
  } as any);
};

const pluginModule: TuiPluginModule & { id: string } = {
  id,
  tui
};

export default pluginModule;
