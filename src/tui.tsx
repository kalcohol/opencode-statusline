/** @jsxImportSource @opentui/solid */
import type { JSX } from "@opentui/solid";
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { buildTuiStatusline } from "./lib/statusline.js";
import { buildTuiUsageText } from "./lib/tui-usage.js";
import {
  STATUSLINE_FIELDS,
  loadStatuslineConfig,
  saveStatuslineConfig,
  uniqueFields,
  type StatuslineFieldID
} from "./lib/statusline-config.js";

const id = "opencode-statusline";
const STATUSLINE_SLOT_ORDER = 95;
const REFRESH_INTERVAL_MS = 30_000;
const EVENT_REFRESH_DELAY_MS = 150;
const configListeners = new Set<() => void>();

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

function showUsageDialog(api: TuiPluginApi, message: string): void {
  api.ui.dialog.replace(() => <api.ui.DialogAlert title="OpenCode Usage" message={message} />);
}

function openUsageDialog(api: TuiPluginApi): void {
  const sessionID = currentSessionID(api);
  if (!sessionID) {
    showUsageDialog(api, "Open a session before running /usage.");
    return;
  }
  showUsageDialog(api, "Loading usage...");
  void buildTuiUsageText(api, sessionID)
    .then((message) => showUsageDialog(api, message))
    .catch((err) => {
      const message = err instanceof Error && err.message ? err.message : "Could not load usage.";
      showUsageDialog(api, `Usage unavailable\n\n${message}`);
    });
}

function StatuslineView(props: { api: TuiPluginApi; sessionID: string }): JSX.Element {
  const [text, setText] = createSignal("");
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
        setText("");
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
      <text fg={props.api.theme.current.textMuted} wrapMode="none">
        {text()}
      </text>
    </Show>
  );
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: STATUSLINE_SLOT_ORDER,
    slots: {
      session_prompt_right(_ctx, props: { session_id: string }) {
        return <StatuslineView api={api} sessionID={props.session_id} />;
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
    ]
  } as any);
};

const pluginModule: TuiPluginModule & { id: string } = {
  id,
  tui
};

export default pluginModule;
