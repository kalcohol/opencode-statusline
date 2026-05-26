import { collectProviderUsage, findUsageWindow, type ProviderInfoLike } from "./providers.js";
import { resolveActiveModel, type MinimalOpencodeClient } from "./opencode-client.js";
import {
  basename,
  formatPercent,
  formatTokenAmount,
  isRecord,
  toFiniteNumber,
  toNonEmptyString
} from "./format.js";
import { loadStatuslineConfig, type StatuslineFieldID } from "./statusline-config.js";

const STATUSLINE_QUOTA_TIMEOUT_MS = 1_000;

type TuiApiLike = {
  state: {
    config: unknown;
    provider: ReadonlyArray<ProviderInfoLike>;
    path: {
      state?: string;
      worktree?: string;
      directory?: string;
    };
    vcs?: {
      branch?: string;
    };
    session: {
      get: (sessionID: string) => unknown;
      messages: (sessionID: string) => ReadonlyArray<unknown>;
      status: (sessionID: string) => unknown;
    };
    part?: (messageID: string) => ReadonlyArray<unknown>;
  };
  client?: {
    session?: {
      children?: (...args: any[]) => Promise<unknown>;
    };
  };
};

type ModelMeta = {
  providerID?: string;
  modelID?: string;
};

type TokenTotals = {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

type GenerationMetrics = {
  ttftMs?: number;
  tokensPerSecond?: number;
};

export type TuiStatuslinePart = {
  field: StatuslineFieldID;
  text: string;
};

function parseConfigModel(config: unknown): ModelMeta {
  if (!isRecord(config)) return {};
  const raw = toNonEmptyString(config.model);
  if (!raw) return {};
  const slash = raw.indexOf("/");
  if (slash <= 0) return {};
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) || undefined };
}

function modelFromSession(session: unknown): ModelMeta {
  if (!isRecord(session)) return {};
  const model = isRecord(session.model) ? session.model : undefined;
  return {
    providerID: toNonEmptyString(model?.providerID),
    modelID: toNonEmptyString(model?.modelID) ?? toNonEmptyString(model?.id)
  };
}

function modelFromMessage(message: unknown): ModelMeta {
  if (!isRecord(message)) return {};
  const providerID = toNonEmptyString(message.providerID);
  const modelID = toNonEmptyString(message.modelID);
  if (providerID || modelID) return { providerID, modelID };
  const model = isRecord(message.model) ? message.model : undefined;
  return {
    providerID: toNonEmptyString(model?.providerID),
    modelID: toNonEmptyString(model?.modelID) ?? toNonEmptyString(model?.id)
  };
}

async function resolveTuiModel(api: TuiApiLike, sessionID: string): Promise<ModelMeta> {
  const client: MinimalOpencodeClient = {
    session: {
      get: async () => api.state.session.get(sessionID),
      messages: async () => api.state.session.messages(sessionID)
    }
  };
  const resolved = await resolveActiveModel({
    client,
    sessionID,
    config: isRecord(api.state.config) ? api.state.config : {},
    providers: api.state.provider
  });
  if (resolved) return resolved;

  const sessionMeta = modelFromSession(api.state.session.get(sessionID));
  if (sessionMeta.providerID || sessionMeta.modelID) return sessionMeta;

  const messages = api.state.session.messages(sessionID);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const meta = modelFromMessage(messages[index]);
    if (meta.providerID || meta.modelID) return meta;
  }

  return parseConfigModel(api.state.config);
}

function withTimeout<Value>(promise: Promise<Value>, ms: number): Promise<Value | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

function messageTokens(message: unknown): TokenTotals {
  if (!isRecord(message) || !isRecord(message.tokens)) {
    return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  }
  const tokens = message.tokens;
  const input = toFiniteNumber(tokens.input) ?? 0;
  const output = toFiniteNumber(tokens.output) ?? 0;
  const reasoning = toFiniteNumber(tokens.reasoning) ?? 0;
  const cache = isRecord(tokens.cache) ? tokens.cache : {};
  const cacheRead = toFiniteNumber(cache.read) ?? 0;
  const cacheWrite = toFiniteNumber(cache.write) ?? 0;
  const explicitTotal = toFiniteNumber(tokens.total);
  const total = explicitTotal ?? input + output + reasoning + cacheRead + cacheWrite;
  return { input, output, reasoning, cacheRead, cacheWrite, total };
}

function sessionTokenTotals(messages: readonly unknown[]): TokenTotals {
  const total: TokenTotals = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant") continue;
    const row = messageTokens(message);
    total.input += row.input;
    total.output += row.output;
    total.reasoning += row.reasoning;
    total.cacheRead += row.cacheRead;
    total.cacheWrite += row.cacheWrite;
    total.total += row.total;
  }
  return total;
}

function latestContextTokens(messages: readonly unknown[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message.role === "assistant") return messageTokens(message).total;
  }
  return 0;
}

function modelContextLimit(provider: ProviderInfoLike | undefined, modelID: string | undefined): number | undefined {
  if (!provider || !modelID || !isRecord(provider.models)) return undefined;
  const model = provider.models[modelID];
  if (!isRecord(model) || !isRecord(model.limit)) return undefined;
  return toFiniteNumber(model.limit.context);
}

function timestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = toNonEmptyString(value);
  if (!raw) return undefined;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function messageTimeMs(message: Record<string, unknown>, key: "created" | "completed"): number | undefined {
  const time = isRecord(message.time) ? message.time : undefined;
  return timestampMs(time?.[key]) ?? timestampMs(message[`${key}At`]);
}

function partStartMs(part: Record<string, unknown>): number | undefined {
  const time = isRecord(part.time) ? part.time : undefined;
  const state = isRecord(part.state) ? part.state : undefined;
  const stateTime = isRecord(state?.time) ? state.time : undefined;
  return timestampMs(time?.start) ?? timestampMs(stateTime?.start);
}

function partEndMs(part: Record<string, unknown>): number | undefined {
  const time = isRecord(part.time) ? part.time : undefined;
  const state = isRecord(part.state) ? part.state : undefined;
  const stateTime = isRecord(state?.time) ? state.time : undefined;
  return timestampMs(time?.end) ?? timestampMs(stateTime?.end);
}

function latestAssistantMessage(messages: readonly unknown[]): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message.role === "assistant") return message;
  }
  return undefined;
}

function latestGenerationMetrics(api: TuiApiLike, messages: readonly unknown[]): GenerationMetrics | undefined {
  const message = latestAssistantMessage(messages);
  const messageID = toNonEmptyString(message?.id);
  if (!message || !messageID || !api.state.part) return undefined;

  const created = messageTimeMs(message, "created");
  const completed = messageTimeMs(message, "completed");
  const parts = api.state.part(messageID).filter(isRecord);
  const firstOutputStart = parts
    .filter((part) => ["text", "reasoning", "tool"].includes(toNonEmptyString(part.type) ?? ""))
    .map(partStartMs)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right)[0];

  const generatedParts = parts.filter((part) => ["text", "reasoning"].includes(toNonEmptyString(part.type) ?? ""));
  const generationStart = generatedParts
    .map(partStartMs)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right)[0] ?? firstOutputStart ?? created;
  const generationEnd = Math.max(
    0,
    ...generatedParts
      .map(partEndMs)
      .filter((value): value is number => value !== undefined)
  ) || completed;

  const tokens = messageTokens(message);
  const ttftMs = created !== undefined && firstOutputStart !== undefined
    ? Math.max(0, firstOutputStart - created)
    : undefined;
  const durationSeconds = generationStart !== undefined && generationEnd !== undefined && generationEnd > generationStart
    ? (generationEnd - generationStart) / 1000
    : undefined;
  const tokensPerSecond = durationSeconds && tokens.output > 0 ? tokens.output / durationSeconds : undefined;

  if (ttftMs === undefined && tokensPerSecond === undefined) return undefined;
  return { ttftMs, tokensPerSecond };
}

function formatLatencyMs(value: number): string {
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = value / 1000;
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  return `${Math.round(seconds)}s`;
}

function formatTokensPerSecond(value: number): string {
  if (value >= 100) return String(Math.round(value));
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function generationMetricsText(metrics: GenerationMetrics | undefined): string | undefined {
  if (!metrics) return undefined;
  const parts: string[] = [];
  if (metrics.ttftMs !== undefined) parts.push(`ttft ${formatLatencyMs(metrics.ttftMs)}`);
  if (metrics.tokensPerSecond !== undefined) parts.push(`gen ${formatTokensPerSecond(metrics.tokensPerSecond)} tok/s`);
  return parts.length ? parts.join(" ") : undefined;
}

function sessionStatusLabel(status: unknown): string | undefined {
  if (!isRecord(status)) return undefined;
  const type = toNonEmptyString(status.type);
  if (!type) return undefined;
  if (type === "retry") {
    const attempt = toFiniteNumber(status.attempt);
    return attempt ? `retry#${attempt}` : "retry";
  }
  return type;
}

async function getChildSessions(api: TuiApiLike, sessionID: string): Promise<unknown[]> {
  const attempts: unknown[][] = [
    [{ sessionID }],
    [{ path: { sessionID } }],
    [{ path: { id: sessionID } }]
  ];
  for (const args of attempts) {
    try {
      const response = await api.client?.session?.children?.(...args);
      const data = isRecord(response) && "data" in response ? response.data : response;
      if (Array.isArray(data)) return data;
    } catch {
      // Try the next SDK shape.
    }
  }
  return [];
}

async function subagentText(api: TuiApiLike, sessionID: string): Promise<string | undefined> {
  const session = api.state.session.get(sessionID);
  if (isRecord(session) && toNonEmptyString(session.parentID)) {
    const status = sessionStatusLabel(api.state.session.status(sessionID));
    return status ? `sub ${status}` : "subagent";
  }

  const children = await getChildSessions(api, sessionID);
  if (children.length === 0) return "sub none";
  const statuses = children.map((child) => {
    const childID = isRecord(child) ? toNonEmptyString(child.id) : undefined;
    return childID ? sessionStatusLabel(api.state.session.status(childID)) : undefined;
  });
  const busy = statuses.filter((status) => status && status !== "idle");
  return busy.length ? `sub ${children.length} ${busy[0]}` : `sub ${children.length} idle`;
}

function quotaText(window: ReturnType<typeof findUsageWindow>, label: string): string | undefined {
  if (!window?.usedPercent && window?.usedPercent !== 0) return undefined;
  return `${label} ${formatPercent(window.usedPercent)}`;
}

export async function buildTuiStatuslineParts(api: TuiApiLike, sessionID: string): Promise<TuiStatuslinePart[]> {
  const fields = loadStatuslineConfig().fields;
  if (fields.length === 0) return [];

  const messages = api.state.session.messages(sessionID);
  const meta = await resolveTuiModel(api, sessionID);
  const provider = api.state.provider.find((item) => item.id === meta.providerID);
  const contextUsed = latestContextTokens(messages);
  const contextLimit = modelContextLimit(provider, meta.modelID);
  const sessionTokens = sessionTokenTotals(messages);
  const generationMetrics = latestGenerationMetrics(api, messages);

  let quotaReport;
  if (meta.providerID && (fields.includes("quota_5h") || fields.includes("quota_weekly"))) {
    quotaReport = await withTimeout(
      collectProviderUsage({
        providerID: meta.providerID,
        providerName: toNonEmptyString(provider?.name),
        modelID: meta.modelID,
        config: api.state.config,
        providerInfo: provider
      }),
      STATUSLINE_QUOTA_TIMEOUT_MS
    );
    if (quotaReport && !quotaReport.ok) quotaReport = undefined;
  }

  const parts: TuiStatuslinePart[] = [];
  for (const field of fields) {
    const text = await renderField({
      api,
      sessionID,
      field,
      provider,
      contextUsed,
      contextLimit,
      generationMetrics,
      sessionTokens,
      quotaReport
    });
    if (text) parts.push({ field, text });
  }

  return parts;
}

export async function buildTuiStatusline(api: TuiApiLike, sessionID: string): Promise<string> {
  const parts = await buildTuiStatuslineParts(api, sessionID);
  return parts.map((part) => part.text).join(" | ");
}

async function renderField(input: {
  api: TuiApiLike;
  sessionID: string;
  field: StatuslineFieldID;
  provider?: ProviderInfoLike;
  contextUsed: number;
  contextLimit?: number;
  generationMetrics?: GenerationMetrics;
  sessionTokens: TokenTotals;
  quotaReport?: Awaited<ReturnType<typeof collectProviderUsage>>;
}): Promise<string | undefined> {
  switch (input.field) {
    case "repo":
      return basename(input.api.state.path.worktree) ?? basename(input.api.state.path.directory);
    case "branch":
      return input.api.state.vcs?.branch ? `git ${input.api.state.vcs.branch}` : undefined;
    case "context_used":
      return `ctx ${formatTokenAmount(input.contextUsed)}`;
    case "context_remaining":
      return input.contextLimit === undefined
        ? undefined
        : `ctx left ${formatTokenAmount(Math.max(0, input.contextLimit - input.contextUsed))}`;
    case "context_length":
      return input.contextLimit === undefined
        ? undefined
        : `ctx max ${formatTokenAmount(input.contextLimit)}`;
    case "context_window":
      return input.contextLimit === undefined
        ? undefined
        : `ctx ${formatTokenAmount(input.contextUsed)}/${formatTokenAmount(input.contextLimit)}`;
    case "generation_metrics":
      return generationMetricsText(input.generationMetrics);
    case "subagent_status":
      return subagentText(input.api, input.sessionID);
    case "agent_status": {
      const status = sessionStatusLabel(input.api.state.session.status(input.sessionID));
      return status ? `agent ${status}` : undefined;
    }
    case "quota_5h":
      return quotaText(findUsageWindow(input.quotaReport, "fiveHour"), "5h");
    case "quota_weekly":
      return quotaText(findUsageWindow(input.quotaReport, "weekly"), "week");
    case "session_io":
      return `io ${formatTokenAmount(input.sessionTokens.input)}/${formatTokenAmount(input.sessionTokens.output)}`;
    case "session_total":
      return `tok ${formatTokenAmount(input.sessionTokens.total)}`;
    default:
      return undefined;
  }
}
