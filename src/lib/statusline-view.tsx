/** @jsxImportSource @opentui/solid */
import type { SessionInfo } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { UsageReport } from "./providers.js";
import {
  buildStatuslineSnapshot,
  renderStatuslineParts,
  sessionSubtree,
  statuslineRepoName,
  type GitDiffStats,
  type ModelRefLike,
  type StatuslinePart
} from "./statusline.js";
import type { StatuslineFieldID } from "./statusline-config.js";
import { loadQuotaReport } from "./quota.js";

const QUOTA_FIELDS: readonly StatuslineFieldID[] = ["quota_5h", "quota_weekly", "provider_balance"];

function currentModel(context: Context, session: SessionInfo | undefined): ModelRefLike | undefined {
  const selected = context.ui.model.current();
  if (selected) return { providerID: selected.providerID, modelID: selected.modelID };
  const model = session?.model;
  return model ? { providerID: model.providerID, modelID: model.id } : undefined;
}

function segmentColor(theme: Context["theme"], part: StatuslinePart) {
  switch (part.field) {
    case "repo":
      return theme.text.base;
    case "branch":
      return theme.text.feedback.info.base;
    case "git_diff_stats":
      return theme.text.feedback.warning.base;
    case "context_used":
      return theme.hue.accent[400];
    case "context_remaining":
      return theme.text.feedback.success.base;
    case "context_length":
      return theme.text.muted;
    case "context_window":
      return theme.hue.accent[400];
    case "generation_metrics":
      return theme.text.feedback.info.base;
    case "subagent_status":
    case "agent_status":
      return theme.hue.interactive[200];
    case "quota_5h":
    case "quota_weekly":
      return theme.text.feedback.warning.base;
    case "provider_balance":
      return theme.text.feedback.success.base;
    case "session_io":
    case "session_total":
      return theme.text.muted;
    case "session_cost":
      return theme.text.feedback.success.base;
    default:
      return theme.text.muted;
  }
}

async function loadGitDiff(context: Context, location: Context["location"]): Promise<GitDiffStats | undefined> {
  if (!location) return undefined;
  const result = await context.client.vcs.status({ location });
  return (result.data ?? []).reduce(
    (total, file) => {
      total.added += file.additions;
      total.removed += file.deletions;
      return total;
    },
    { added: 0, removed: 0 }
  );
}

type KeyedValue<Value> = {
  key: string;
  value: Value;
};

export function Statusline(props: {
  context: Context;
  sessionID: string;
  fields: readonly StatuslineFieldID[];
}) {
  const [gitDiff, setGitDiff] = createSignal<KeyedValue<GitDiffStats>>();
  const [quotaReport, setQuotaReport] = createSignal<KeyedValue<UsageReport>>();
  const [refreshTick, setRefreshTick] = createSignal(0);

  const session = createMemo(() => props.context.data.session.get(props.sessionID));
  const messages = createMemo(() => props.context.data.session.message.list(props.sessionID));
  const location = createMemo(
    () => session()?.location ?? props.context.location ?? props.context.data.location.default()
  );
  const locationKey = createMemo(() => location()?.directory ?? "");
  const models = createMemo(() => props.context.data.location.model.list(location()));
  const providers = createMemo(() => props.context.data.location.provider.list(location()) ?? []);
  const model = createMemo(() => currentModel(props.context, session()));
  const quotaKey = createMemo(() => {
    const selected = model();
    return selected?.providerID
      ? `${selected.providerID}:${selected.modelID ?? ""}:${locationKey()}`
      : "";
  });
  const provider = createMemo(() => {
    const providerID = model()?.providerID;
    return providerID ? providers().find((item) => item.id === providerID) : undefined;
  });
  const sessions = createMemo(() =>
    sessionSubtree(props.sessionID, props.context.data.session.family(props.sessionID), (id) =>
      props.context.data.session.get(id)
    )
  );
  const subagentCount = createMemo(
    () =>
      sessions().filter(
        (item) =>
          item.id !== props.sessionID && props.context.data.session.status(item.id) === "running"
      ).length || undefined
  );
  const wantDiff = createMemo(() => props.fields.includes("git_diff_stats"));
  const wantQuota = createMemo(() => props.fields.some((field) => QUOTA_FIELDS.includes(field)));
  const visibleGitDiff = createMemo(() => {
    const value = gitDiff();
    return value?.key === locationKey() ? value.value : undefined;
  });
  const visibleQuotaReport = createMemo(() => {
    const value = quotaReport();
    return value?.key === quotaKey() ? value.value : undefined;
  });

  let diffVersion = 0;
  let quotaVersion = 0;

  createEffect(() => {
    const enabled = wantDiff();
    const target = location();
    const key = locationKey();
    refreshTick();
    if (!enabled || !target) {
      diffVersion += 1;
      setGitDiff(undefined);
      return;
    }
    const version = ++diffVersion;
    void loadGitDiff(props.context, target)
      .then((value) => {
        if (version === diffVersion) setGitDiff(value ? { key, value } : undefined);
      })
      .catch(() => {
        // Keep the last successful value for the same location.
      });
  });

  createEffect(() => {
    const enabled = wantQuota();
    const selected = model();
    const target = location();
    const info = provider();
    const key = quotaKey();
    refreshTick();
    if (!enabled || !selected?.providerID) {
      quotaVersion += 1;
      setQuotaReport(undefined);
      return;
    }
    const version = ++quotaVersion;
    void loadQuotaReport(props.context, {
      location: target,
      providerID: selected.providerID,
      providerName: info?.name,
      modelID: selected.modelID,
      providerInfo: info
    })
      .then((report) => {
        if (version === quotaVersion) setQuotaReport({ key, value: report });
      })
      .catch(() => {
        // Keep the last successful value for the same provider/model/location.
      });
  });

  const onExecution = (event: { data: { sessionID: string } }) => {
    if (event.data.sessionID === props.sessionID) setRefreshTick((value) => value + 1);
  };
  const onCredential = () => {
    quotaVersion += 1;
    setQuotaReport(undefined);
    setRefreshTick((value) => value + 1);
  };
  const unsubscribers = [
    props.context.data.on("session.execution.succeeded", onExecution),
    props.context.data.on("session.execution.failed", onExecution),
    props.context.data.on("session.execution.interrupted", onExecution),
    props.context.data.on("credential.updated", onCredential),
    props.context.data.on("credential.switched", onCredential)
  ];
  const refreshInterval = setInterval(() => {
    if (wantDiff() || wantQuota()) setRefreshTick((value) => value + 1);
  }, 60_000);
  onCleanup(() => {
    diffVersion += 1;
    quotaVersion += 1;
    clearInterval(refreshInterval);
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  const parts = createMemo(() =>
    renderStatuslineParts(
      buildStatuslineSnapshot({
        messages: messages(),
        models: models(),
        model: model(),
        sessions: sessions(),
        session: session(),
        repo: statuslineRepoName(session(), location()?.directory),
        branch: props.context.data.location.vcs.info(location())?.branch.current,
        gitDiff: visibleGitDiff(),
        subagentCount: subagentCount(),
        agentStatus: props.context.data.session.status(props.sessionID),
        quotaReport: visibleQuotaReport()
      }),
      props.fields
    )
  );

  const theme = () => props.context.theme;

  return (
    <Show when={parts().length > 0}>
      <text wrapMode="none" truncate flexShrink={1} minWidth={0} fg={theme().text.base}>
        <For each={parts()}>
          {(part, index) => (
            <>
              <Show when={index() > 0}>
                <span style={{ fg: theme().text.muted }}>{" | "}</span>
              </Show>
              <span style={{ fg: segmentColor(theme(), part) }}>{part.text}</span>
            </>
          )}
        </For>
      </text>
    </Show>
  );
}
