import type { ApiCredential, CredentialSet, OAuthCredential } from "../credentials.js";

export type UsageWindowKey = "fiveHour" | "daily" | "weekly" | "monthly" | "codeReview" | "other";

export type UsageWindow = {
  key: UsageWindowKey;
  label: string;
  used?: number;
  total?: number;
  unit?: string;
  usedPercent?: number;
  remainingPercent?: number;
  resetAtMs?: number;
  resetAfterMs?: number;
};

export type UsageBalance = {
  label: string;
  value: string;
};

export type UsageItem = {
  label: string;
  value: string;
};

export type UsageReport = {
  ok: boolean;
  providerID: string;
  providerName?: string;
  modelID?: string;
  generatedAtMs: number;
  auth?: string;
  plan?: string;
  windows: UsageWindow[];
  balances: UsageBalance[];
  items: UsageItem[];
  error?: string;
  stale?: boolean;
};

export type ProviderInfoLike = {
  id?: string;
  name?: string;
  integrationID?: string;
};

export type AdapterInput = {
  providerID: string;
  providerName?: string;
  modelID?: string;
  providerInfo?: ProviderInfoLike;
  apiCredential?: ApiCredential;
  oauth?: OAuthCredential;
};

export type CredentialKind = "api-key" | "oauth" | "none";

export type ProviderAdapter = {
  id: string;
  aliases: readonly string[];
  integrationIDs: readonly string[];
  env: readonly string[];
  credential: CredentialKind;
  missingCredentialError?: string;
  cacheScope?: "account+model";
  collect(input: AdapterInput): Promise<UsageReport>;
};

export type CollectProviderUsageInput = {
  providerID: string;
  providerName?: string;
  modelID?: string;
  providerInfo?: ProviderInfoLike;
  credentials?: CredentialSet;
  force?: boolean;
};
