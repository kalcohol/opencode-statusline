import { createHash } from "node:crypto";
import {
  credentialFingerprint,
  resolveApiCredential,
  resolveOAuthCredential,
  type ApiCredential,
  type OAuthCredential
} from "../credentials.js";
import { deepseekAdapter } from "./deepseek.js";
import { kimiAdapter } from "./kimi.js";
import { minimaxAdapter, minimaxChinaAdapter } from "./minimax.js";
import { openaiAdapter } from "./openai.js";
import { opencodeGoAdapter } from "./opencode-go.js";
import { opencodeZenAdapter } from "./opencode-zen.js";
import { openrouterAdapter } from "./openrouter.js";
import { credentialMissing, errorReport } from "./shared.js";
import type { CollectProviderUsageInput, ProviderAdapter, UsageReport, UsageWindow, UsageWindowKey } from "./types.js";
import { xiaomiAdapter } from "./xiaomi.js";
import { zaiAdapter, zhipuAdapter } from "./zai.js";

export const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [
  zaiAdapter,
  zhipuAdapter,
  kimiAdapter,
  minimaxAdapter,
  minimaxChinaAdapter,
  xiaomiAdapter,
  deepseekAdapter,
  openrouterAdapter,
  opencodeGoAdapter,
  openaiAdapter,
  opencodeZenAdapter
];

const CACHE_TTL_MS = 30_000;
const CACHE_STALE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { expiresAt: number; staleUntil: number; report: UsageReport }>();
const inflight = new Map<string, Promise<UsageReport>>();

function normalizeProviderID(providerID: string): string {
  return providerID.trim().toLowerCase();
}

const adapterByAlias = new Map<string, ProviderAdapter>();
for (const adapter of PROVIDER_ADAPTERS) {
  for (const alias of new Set([adapter.id, ...adapter.aliases])) {
    const key = normalizeProviderID(alias);
    const existing = adapterByAlias.get(key);
    if (existing) throw new Error(`Duplicate provider alias '${alias}' for ${existing.id} and ${adapter.id}`);
    adapterByAlias.set(key, adapter);
  }
}

export function resolveProviderAdapter(providerID: string): ProviderAdapter | undefined {
  return adapterByAlias.get(normalizeProviderID(providerID));
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function credentialScope(input: CollectProviderUsageInput, adapter: ProviderAdapter): string {
  return hashText(JSON.stringify({
    credentials: credentialFingerprint(input.credentials),
    env: adapter.env.map((key) => [key, process.env[key] ?? ""]),
    integrationID: input.providerInfo?.integrationID ?? ""
  }));
}

function providerUsageCacheKey(input: CollectProviderUsageInput, adapter: ProviderAdapter): string {
  const modelScope = adapter.cacheScope === "account+model" ? input.modelID ?? "" : "";
  return `${adapter.id}:${modelScope}:${credentialScope(input, adapter)}`;
}

function reportForInput(report: UsageReport, input: CollectProviderUsageInput): UsageReport {
  return {
    ...report,
    providerID: input.providerID,
    providerName: input.providerName ?? report.providerName,
    modelID: input.modelID
  };
}

type ResolvedCredential = {
  apiCredential?: ApiCredential;
  oauth?: OAuthCredential;
};

function resolveAdapterCredential(
  adapter: ProviderAdapter,
  input: CollectProviderUsageInput
): ResolvedCredential | undefined {
  const integrationID = input.providerInfo?.integrationID;
  const integrationIDs = [
    ...(integrationID ? [integrationID] : []),
    ...adapter.integrationIDs
  ];
  if (adapter.credential === "api-key") {
    const apiCredential = resolveApiCredential({
      env: adapter.env,
      credentials: input.credentials,
      integrationIDs
    });
    return apiCredential ? { apiCredential } : undefined;
  }
  if (adapter.credential === "oauth") {
    const oauth = resolveOAuthCredential({
      credentials: input.credentials,
      integrationIDs
    });
    return oauth ? { oauth } : undefined;
  }
  return {};
}

function integrationMismatch(
  adapter: ProviderAdapter,
  input: CollectProviderUsageInput,
  integrationID: string
): UsageReport {
  return errorReport({
    ...input,
    error: `Provider integration '${integrationID}' is not supported by the ${adapter.id} collector`
  });
}

export function readCachedProviderUsage(
  input: CollectProviderUsageInput,
  options: { allowStale?: boolean } = {}
): UsageReport | undefined {
  const adapter = resolveProviderAdapter(input.providerID);
  if (!adapter) return undefined;
  const cached = cache.get(providerUsageCacheKey(input, adapter));
  if (!cached) return undefined;
  const now = Date.now();
  const fresh = cached.expiresAt > now;
  if (fresh || (options.allowStale && cached.staleUntil > now)) {
    const report = reportForInput(cached.report, input);
    return fresh ? report : { ...report, stale: true };
  }
  return undefined;
}

export function clearProviderUsageCache(): void {
  cache.clear();
  inflight.clear();
}

export async function collectProviderUsage(input: CollectProviderUsageInput): Promise<UsageReport> {
  const adapter = resolveProviderAdapter(input.providerID);
  if (!adapter) {
    return errorReport({
      ...input,
      error: `Provider '${input.providerID}' has no supported usage collector`
    });
  }

  const integrationID = input.providerInfo?.integrationID;
  if (integrationID && !adapter.integrationIDs.includes(integrationID)) {
    return integrationMismatch(adapter, input, integrationID);
  }

  const resolved = resolveAdapterCredential(adapter, input);
  if (!resolved) {
    if (adapter.missingCredentialError) {
      return errorReport({
        ...input,
        error: adapter.missingCredentialError
      });
    }
    return credentialMissing(input.providerID, input.providerName, input.modelID);
  }

  const cacheKey = providerUsageCacheKey(input, adapter);
  const cached = readCachedProviderUsage(input);
  if (!input.force && cached) return cached;

  const pending = inflight.get(cacheKey);
  if (pending) return reportForInput(await pending, input);

  const promise = (async () => {
    const report = await adapter.collect({
      providerID: input.providerID,
      providerName: input.providerName,
      modelID: input.modelID,
      providerInfo: input.providerInfo,
      ...resolved
    });
    if (report.ok) {
      const now = Date.now();
      if (cache.size > 100) {
        for (const [key, entry] of cache) {
          if (entry.staleUntil <= now) cache.delete(key);
        }
      }
      cache.set(cacheKey, {
        expiresAt: now + CACHE_TTL_MS,
        staleUntil: now + CACHE_STALE_TTL_MS,
        report
      });
    }
    return report;
  })();

  inflight.set(cacheKey, promise);
  try {
    return reportForInput(await promise, input);
  } finally {
    if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey);
  }
}

export function findUsageWindow(report: UsageReport | undefined, key: UsageWindowKey): UsageWindow | undefined {
  return report?.windows.find((window) => window.key === key);
}
