/** @jsxImportSource @opentui/solid */
import type { SessionInfo } from "@opencode/client";
import type { Context } from "@opencode/plugin/tui/context";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { UsageReport } from "./providers.js";
import {
  buildStatuslineSnapshot,
  familyGenerationMetrics,
  generationMetricsAfter,
  hasVcsProvider,
  renderStatuslineParts,
  sessionSubtree,
  statuslineRepoName,
  type GitDiffStats,
  type ModelRefLike,
  type StatuslinePart
} from "./statusline.js";
import type { StatuslineFieldID } from "./statusline-config.js";
import { clearQuotaCaches, loadQuotaReport } from "./quota.js";
import { SubagentBadgeTracker } from "./subagent-badge.js";

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
    case "family_generation":
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
  const [subagentDone, setSubagentDone] = createSignal<{ count: number; speed?: number }>({ count: 0 });
  let subagentDoneTimer: ReturnType<typeof setTimeout> | undefined;
  let subagentDoneVersion = 0;
  const badgeTracker = new SubagentBadgeTracker();

  const session = createMemo(() => props.context.data.session.get(props.sessionID));
  const messages = createMemo(() => props.context.data.session.message.list(props.sessionID));
  const location = createMemo(
    () => session()?.location ?? props.context.location ?? props.context.data.location.default()
  );
  const locationKey = createMemo(() => location()?.directory ?? "");
  const vcs = createMemo(() => props.context.data.location.vcs.info(location()));
  const hasVcs = createMemo(() => hasVcsProvider(vcs()));
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
  const wantVcs = createMemo(() => wantDiff() || props.fields.includes("branch"));
  const wantQuota = createMemo(() => props.fields.some((field) => QUOTA_FIELDS.includes(field)));
  const wantFamily = createMemo(() => props.fields.includes("family_generation"));
  const familySynced = new Set<string>();
  const familyGeneration = createMemo(() => {
    if (!wantFamily()) return undefined;
    return familyGenerationMetrics({
      parentMessages: messages(),
      parentBoundary: session()?.revert?.messageID,
      parentRunning: props.context.data.session.status(props.sessionID) === "running",
      children: sessions()
        .filter((item) => item.id !== props.sessionID)
        .map((item) => ({
          messages: props.context.data.session.message.list(item.id),
          boundary: item.revert?.messageID
        }))
    });
  });
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
    if (!wantVcs()) return;
    const target = location();
    if (!target) return;
    void props.context.data.location.vcs.sync(target).catch(() => undefined);
  });

  createEffect(() => {
    if (!wantFamily()) return;
    for (const item of sessions()) {
      if (item.id === props.sessionID) continue;
      if (props.context.data.session.message.list(item.id).length > 0) continue;
      if (familySynced.has(item.id)) continue;
      familySynced.add(item.id);
      void props.context.data.session.message
        .sync(item.id)
        .then(() => setRefreshTick((value) => value + 1))
        .catch(() => undefined);
    }
  });

  createEffect(() => {
    const enabled = wantDiff();
    const target = location();
    const key = locationKey();
    refreshTick();
    if (!enabled || !target || !hasVcs()) {
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

  let activeSessionID = props.sessionID;
  createEffect(() => {
    const sessionID = props.sessionID;
    if (sessionID === activeSessionID) return;
    activeSessionID = sessionID;
    subagentDoneVersion += 1;
    badgeTracker.reset();
    familySynced.clear();
    if (subagentDoneTimer) clearTimeout(subagentDoneTimer);
    subagentDoneTimer = undefined;
    setSubagentDone({ count: 0 });
  });

  const isSubtreeSession = (sessionID: string) =>
    sessionID !== props.sessionID && sessions().some((item) => item.id === sessionID);

  const onExecution = (event: { data: { sessionID: string } }) => {
    const sessionID = event.data.sessionID;
    if (sessionID === props.sessionID || isSubtreeSession(sessionID)) {
      setRefreshTick((value) => value + 1);
    }
  };
  const onExecutionStarted = (event: { data: { sessionID: string } }) => {
    const sessionID = event.data.sessionID;
    if (!isSubtreeSession(sessionID)) return;
    const messages = props.context.data.session.message.list(sessionID);
    badgeTracker.start(sessionID, messages.at(-1)?.id);
    subagentDoneVersion += 1;
  };
  const onSubagentDone = (event: { data: { sessionID: string } }) => {
    const sessionID = event.data.sessionID;
    if (!isSubtreeSession(sessionID)) return;
    const finished = badgeTracker.finish(sessionID);
    if (!finished.counted) return;

    setSubagentDone((previous) => ({ count: previous.count + 1, speed: undefined }));
    if (subagentDoneTimer) clearTimeout(subagentDoneTimer);
    subagentDoneTimer = setTimeout(() => {
      badgeTracker.clearDone();
      setSubagentDone({ count: 0 });
    }, 8_000);

    if (finished.afterID === undefined) return;
    const version = ++subagentDoneVersion;
    const speed = () =>
      generationMetricsAfter(props.context.data.session.message.list(sessionID), finished.afterID!)
        ?.tokensPerSecond;
    const immediate = speed();
    if (immediate !== undefined) {
      setSubagentDone((previous) => ({ ...previous, speed: immediate }));
      return;
    }
    void props.context.data.session.message
      .sync(sessionID)
      .then(() => {
        if (version !== subagentDoneVersion) return;
        const synced = speed();
        if (synced !== undefined) {
          setSubagentDone((previous) => ({ ...previous, speed: synced }));
        }
      })
      .catch(() => undefined);
  };
  const onSucceeded = (event: { data: { sessionID: string } }) => {
    onExecution(event);
    onSubagentDone(event);
  };
  const onFailed = (event: { data: { sessionID: string } }) => {
    badgeTracker.fail(event.data.sessionID);
    onExecution(event);
  };
  const onCredential = () => {
    quotaVersion += 1;
    clearQuotaCaches();
    setQuotaReport(undefined);
    setRefreshTick((value) => value + 1);
  };
  const unsubscribers = [
    props.context.data.on("session.execution.started", onExecutionStarted),
    props.context.data.on("session.execution.succeeded", onSucceeded),
    props.context.data.on("session.execution.failed", onFailed),
    props.context.data.on("session.execution.interrupted", onFailed),
    props.context.data.on("credential.updated", onCredential),
    props.context.data.on("credential.switched", onCredential)
  ];
  const refreshInterval = setInterval(() => {
    if (wantDiff() || wantQuota()) setRefreshTick((value) => value + 1);
  }, 60_000);
  onCleanup(() => {
    diffVersion += 1;
    quotaVersion += 1;
    subagentDoneVersion += 1;
    badgeTracker.reset();
    familySynced.clear();
    if (subagentDoneTimer) clearTimeout(subagentDoneTimer);
    clearInterval(refreshInterval);
    for (const unsubscribe of unsubscribers) unsubscribe();
  });

  const parts = createMemo(() =>
    renderStatuslineParts(
      buildStatuslineSnapshot({
        messages: messages(),
        models: models(),
        sessions: sessions(),
        session: session(),
        repo: statuslineRepoName(session(), location()?.directory),
        branch: vcs()?.branch.current,
        gitDiff: visibleGitDiff(),
        familyGeneration: familyGeneration(),
        subagentCount: subagentCount(),
        subagentDoneCount: subagentDone().count || undefined,
        subagentDoneSpeed: subagentDone().speed,
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
