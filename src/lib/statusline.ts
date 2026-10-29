import type {
  ModelInfo,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  TokenUsageInfo
} from "@opencode/client";
import { basename, formatPercent, formatTokenAmount, toFiniteNumber } from "./format.js";
import { findUsageWindow, type UsageBalance, type UsageReport } from "./providers.js";
import type { StatuslineFieldID } from "./statusline-config.js";

export type GitDiffStats = {
  added: number;
  removed: number;
};

export type GenerationMetrics = {
  tokensPerSecond?: number;
};

export type TokenTotals = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

export type StatuslineSnapshot = {
  repo?: string;
  branch?: string;
  gitDiff?: GitDiffStats;
  contextUsed?: number;
  contextLimit?: number;
  generation?: GenerationMetrics;
  subagentCount?: number;
  agentStatus?: string;
  quotaReport?: UsageReport;
  sessionTokens: TokenTotals;
  sessionCost: number;
};

export type StatuslinePart = {
  field: StatuslineFieldID;
  text: string;
};

export type ModelRefLike = {
  providerID: string;
  modelID?: string;
};

function tokenTotal(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write;
}

function emptyTokenTotals(): TokenTotals {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0
  };
}

function addTokens(total: TokenTotals, tokens: TokenUsageInfo | undefined): void {
  if (!tokens) return;
  total.input += tokens.input;
  total.output += tokens.output;
  total.reasoning += tokens.reasoning;
  total.cacheRead += tokens.cache.read;
  total.cacheWrite += tokens.cache.write;
  total.total += tokenTotal(tokens);
}

export function sessionTokenTotals(sessions: readonly SessionInfo[]): TokenTotals {
  const total = emptyTokenTotals();
  for (const session of sessions) addTokens(total, session.tokens);
  return total;
}

export function sessionCostTotal(sessions: readonly SessionInfo[]): number {
  return sessions.reduce((total, session) => total + (toFiniteNumber(session.cost) ?? 0), 0);
}

export function sessionSubtree(
  sessionID: string,
  family: readonly string[],
  get: (id: string) => SessionInfo | undefined
): SessionInfo[] {
  const byParent = new Map<string, SessionInfo[]>();
  for (const id of family) {
    const session = get(id);
    if (!session?.parentID) continue;
    const children = byParent.get(session.parentID);
    if (children) children.push(session);
    else byParent.set(session.parentID, [session]);
  }

  const result: SessionInfo[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const session = get(id);
    if (session) result.push(session);
    for (const child of byParent.get(id) ?? []) walk(child.id);
  };
  walk(sessionID);
  return result;
}

export function lastAssistantWithUsage(
  messages: readonly SessionMessageInfo[],
  boundary?: string
): (SessionMessageAssistant & { tokens: TokenUsageInfo }) | undefined {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1;
  if (boundary && boundaryIndex === -1) return undefined;
  const end = boundaryIndex === -1 ? messages.length : boundaryIndex;
  const compactionIndex = messages.findLastIndex(
    (message, index) =>
      message.type === "compaction" && message.status === "completed" && index < end
  );
  return messages.findLast(
    (message, index): message is SessionMessageAssistant & { tokens: TokenUsageInfo } =>
      message.type === "assistant" && message.tokens !== undefined && index > compactionIndex && index < end
  );
}

export function contextUsage(
  messages: readonly SessionMessageInfo[],
  models: readonly ModelInfo[] | undefined,
  model: ModelRefLike | undefined,
  boundary?: string
): { used: number; limit?: number } | undefined {
  const last = lastAssistantWithUsage(messages, boundary);
  if (!last) return undefined;
  const used = tokenTotal(last.tokens);
  if (used <= 0) return undefined;
  const modelInfo =
    models?.find(
      (item) =>
        item.providerID === last.model.providerID &&
        (item.id === last.model.id || item.modelID === last.model.id)
    ) ??
    models?.find(
      (item) =>
        item.providerID === model?.providerID &&
        (item.id === model?.modelID || item.modelID === model?.modelID)
    );
  return { used, limit: modelInfo?.limit.context };
}

function turnStartIndex(messages: readonly SessionMessageInfo[], end: number): number {
  const legacy = !messages.some((message) => message.type === "idle");
  let input = -1;
  for (let index = end - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.type === "idle") return input;
    if (message.type !== "user" && message.type !== "synthetic") continue;
    if (legacy) return index;
    input = index;
  }
  return input;
}

export function generationMetrics(
  messages: readonly SessionMessageInfo[],
  boundary?: string
): GenerationMetrics | undefined {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1;
  if (boundary && boundaryIndex === -1) return undefined;
  const limit = boundaryIndex === -1 ? messages.length : boundaryIndex;
  const lastAssistantIndex = messages.findLastIndex(
    (message, index) => index < limit && message.type === "assistant"
  );
  if (lastAssistantIndex === -1) return undefined;
  const lastAssistant = messages[lastAssistantIndex];
  if (lastAssistant.type !== "assistant" || !lastAssistant.tokens) return undefined;
  const compactionIndex = messages.findLastIndex(
    (message, index) =>
      index < limit && message.type === "compaction" && message.status === "completed"
  );
  if (compactionIndex > lastAssistantIndex) return undefined;
  const end = lastAssistantIndex + 1;
  const start = turnStartIndex(messages, end);
  const steps = messages
    .slice(start + 1, end)
    .filter((message): message is SessionMessageAssistant => message.type === "assistant");
  if (!steps.length) return undefined;
  const durations = steps.flatMap((step) => {
    const created = step.time.created;
    const streamed = step.time.streamed;
    if (streamed === undefined) return [];
    return [Math.max(0, streamed - created)];
  });
  if (durations.length !== steps.length) return undefined;
  const generatedTokens = steps.reduce(
    (total, step) => total + (step.tokens?.output ?? 0) + (step.tokens?.reasoning ?? 0),
    0
  );
  const generationMs = durations.reduce((total, value) => total + value, 0);
  if (generatedTokens <= 0 || generationMs <= 0) return undefined;
  return { tokensPerSecond: generatedTokens / (generationMs / 1000) };
}

export function buildStatuslineSnapshot(input: {
  messages: readonly SessionMessageInfo[];
  models: readonly ModelInfo[] | undefined;
  model: ModelRefLike | undefined;
  sessions: readonly SessionInfo[];
  session?: SessionInfo;
  repo?: string;
  branch?: string;
  gitDiff?: GitDiffStats;
  subagentCount?: number;
  agentStatus?: string;
  quotaReport?: UsageReport;
}): StatuslineSnapshot {
  const usage = contextUsage(input.messages, input.models, input.model, input.session?.revert?.messageID);
  return {
    repo: input.repo,
    branch: input.branch,
    gitDiff: input.gitDiff,
    contextUsed: usage?.used,
    contextLimit: usage?.limit,
    generation: generationMetrics(input.messages, input.session?.revert?.messageID),
    subagentCount: input.subagentCount,
    agentStatus: input.agentStatus,
    quotaReport: input.quotaReport,
    sessionTokens: sessionTokenTotals(input.sessions),
    sessionCost: sessionCostTotal(input.sessions)
  };
}

function formatTokensPerSecond(value: number): string {
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function generationMetricsText(metrics: GenerationMetrics | undefined): string | undefined {
  if (metrics?.tokensPerSecond === undefined) return undefined;
  return `gen ${formatTokensPerSecond(metrics.tokensPerSecond)} tok/s`;
}

function quotaText(window: ReturnType<typeof findUsageWindow>, label: string): string | undefined {
  if (window?.usedPercent === undefined) return undefined;
  return `${label} ${formatPercent(window.usedPercent)}`;
}

function providerBalanceRank(balance: UsageBalance): number {
  const label = balance.label.toLowerCase();
  if (label.includes("remaining")) return 0;
  if (label.includes("balance")) return 1;
  if (label.includes("credit")) return 2;
  return 3;
}

function displayableBalanceValue(balance: UsageBalance): string | undefined {
  const value = balance.value.trim();
  return value && /\d/.test(value) ? value : undefined;
}

export function providerBalanceText(report: UsageReport | undefined): string | undefined {
  if (!report?.ok) return undefined;
  const selected = report.balances
    .map((balance, index) => ({
      balance,
      index,
      rank: providerBalanceRank(balance),
      value: displayableBalanceValue(balance)
    }))
    .filter(
      (item): item is { balance: UsageBalance; index: number; rank: number; value: string } =>
        Boolean(item.value)
    )
    .sort((left, right) => left.rank - right.rank || left.index - right.index)[0];
  return selected ? `bal ${selected.value}` : undefined;
}

function sessionCostText(cost: number): string | undefined {
  if (!Number.isFinite(cost) || cost <= 0) return undefined;
  return `cost $${cost.toFixed(2)}`;
}

function fieldText(field: StatuslineFieldID, snapshot: StatuslineSnapshot): string | undefined {
  switch (field) {
    case "repo":
      return snapshot.repo;
    case "branch":
      return snapshot.branch;
    case "git_diff_stats":
      return snapshot.gitDiff ? `+${snapshot.gitDiff.added},-${snapshot.gitDiff.removed}` : undefined;
    case "context_used":
      return snapshot.contextUsed === undefined ? undefined : `ctx ${formatTokenAmount(snapshot.contextUsed)}`;
    case "context_remaining":
      return snapshot.contextLimit === undefined || snapshot.contextUsed === undefined
        ? undefined
        : `ctx left ${formatTokenAmount(Math.max(0, snapshot.contextLimit - snapshot.contextUsed))}`;
    case "context_length":
      return snapshot.contextLimit === undefined ? undefined : `ctx max ${formatTokenAmount(snapshot.contextLimit)}`;
    case "context_window":
      return snapshot.contextLimit === undefined || snapshot.contextUsed === undefined
        ? undefined
        : `ctx ${formatTokenAmount(snapshot.contextUsed)}/${formatTokenAmount(snapshot.contextLimit)}`;
    case "generation_metrics":
      return generationMetricsText(snapshot.generation);
    case "subagent_status":
      return snapshot.subagentCount ? `sub ${snapshot.subagentCount} running` : undefined;
    case "agent_status":
      return snapshot.agentStatus === "running" ? "running" : undefined;
    case "quota_5h":
      return quotaText(findUsageWindow(snapshot.quotaReport, "fiveHour"), "5h");
    case "quota_weekly":
      return quotaText(findUsageWindow(snapshot.quotaReport, "weekly"), "week");
    case "provider_balance":
      return providerBalanceText(snapshot.quotaReport);
    case "session_io":
      return `${formatTokenAmount(snapshot.sessionTokens.input)} in / ${formatTokenAmount(snapshot.sessionTokens.output)} out`;
    case "session_total":
      return `${formatTokenAmount(snapshot.sessionTokens.total)} used`;
    case "session_cost":
      return sessionCostText(snapshot.sessionCost);
    default:
      return undefined;
  }
}

export function renderStatuslineParts(
  snapshot: StatuslineSnapshot,
  fields: readonly StatuslineFieldID[]
): StatuslinePart[] {
  const parts: StatuslinePart[] = [];
  for (const field of fields) {
    const text = fieldText(field, snapshot);
    if (text) parts.push({ field, text });
  }
  return parts;
}

export function statuslineRepoName(session: SessionInfo | undefined, fallback: string | undefined): string | undefined {
  return basename(session?.location.directory ?? fallback);
}
