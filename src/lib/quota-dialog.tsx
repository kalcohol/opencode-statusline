/** @jsxImportSource @opentui/solid */
import type { LocationRef } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
import { useTerminalDimensions } from "@opentui/solid";
import { For, Show, createMemo, createResource } from "solid-js";
import { formatUsageReport } from "./usage-format.js";
import { loadQuotaReport, type QuotaTarget } from "./quota.js";
import { isRecord, toNonEmptyString } from "./format.js";
import type { ProviderInfoLike } from "./providers.js";

type UsageRow = {
  label?: string;
  value: string;
};

function usageRows(message: string): UsageRow[] {
  return message
    .split("\n")
    .filter((line, index) => !(index === 0 && line === "Provider quota"))
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

function modelRef(value: unknown): { providerID: string; modelID?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const providerID = toNonEmptyString(value.providerID);
  const modelID = toNonEmptyString(value.id) ?? toNonEmptyString(value.modelID);
  return providerID ? { providerID, modelID } : undefined;
}

export function resolveQuotaTarget(context: Context): QuotaTarget | undefined {
  const route = context.ui.router.current();
  const sessionID = route.type === "session" ? route.sessionID : undefined;
  const session = sessionID ? context.data.session.get(sessionID) : undefined;
  const location: LocationRef | undefined =
    session?.location ?? context.location ?? context.data.location.default();
  const selected = context.ui.model.current() ?? modelRef(session?.model);
  if (!selected?.providerID) return undefined;
  const provider: ProviderInfoLike | undefined = context.data.location.provider
    .list(location)
    ?.find((item) => item.id === selected.providerID);
  return {
    location,
    providerID: selected.providerID,
    providerName: provider?.name,
    modelID: selected.modelID,
    providerInfo: provider
  };
}

function QuotaDialog(props: { context: Context; target: QuotaTarget }) {
  const theme = () => props.context.theme.surface("dialog");
  const dimensions = useTerminalDimensions();
  const maxHeight = () =>
    Math.max(3, dimensions().height - Math.floor(dimensions().height / 4) - 8);
  const [report] = createResource(() =>
    loadQuotaReport(props.context, props.target, { force: true })
  );
  const rows = createMemo(() => {
    const value = report();
    return value ? usageRows(formatUsageReport(value)) : [];
  });

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme().text.base}>{`Provider quota · ${props.target.providerName ?? props.target.providerID}`}</text>
        <text fg={theme().text.muted} onMouseUp={() => props.context.ui.dialog.clear()}>
          esc
        </text>
      </box>
      <Show
        when={report.error}
        fallback={
          <Show when={report()} fallback={<text fg={theme().text.muted}>Loading provider quota…</text>}>
            <scrollbox maxHeight={maxHeight()} contentOptions={{ minHeight: 0 }} scrollbarOptions={{ visible: false }}>
              <box gap={0} paddingBottom={1}>
                <For each={rows()}>
                  {(row) => (
                    <Show when={row.value} fallback={<box height={1} />}>
                      <box flexDirection="row" gap={1} width="100%">
                        <Show
                          when={row.label}
                          fallback={
                            <text fg={theme().text.muted} wrapMode="word" width="100%">
                              {row.value}
                            </text>
                          }
                        >
                          {(label) => (
                            <>
                              <text fg={theme().text.muted} width={16} flexShrink={0} wrapMode="none">
                                {label()}
                              </text>
                              <text fg={theme().text.base} wrapMode="word" width="100%">
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
            </scrollbox>
          </Show>
        }
      >
        <text fg={theme().text.feedback.error.base} wrapMode="word">
          {report.error instanceof Error ? report.error.message : String(report.error)}
        </text>
      </Show>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme().background.action.primary.base}
          onMouseUp={() => props.context.ui.dialog.clear()}
        >
          <text fg={theme().text.action.primary.base}>ok</text>
        </box>
      </box>
    </box>
  );
}

export function openQuotaDialog(context: Context): void {
  const target = resolveQuotaTarget(context);
  if (!target) {
    context.ui.toast.show({
      variant: "warning",
      message: "No active model. Open a session or select a model first."
    });
    return;
  }
  context.ui.dialog.show(() => <QuotaDialog context={context} target={target} />);
  context.ui.dialog.set({ size: "large" });
}
