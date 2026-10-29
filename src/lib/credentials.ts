import type { CredentialEntry } from "@opencode/client";

export type CredentialSet = readonly CredentialEntry[];

export type CredentialSource =
  | { type: "env"; label: string }
  | { type: "credential"; label: string };

export type ApiCredential = {
  token: string;
  source: CredentialSource;
  orgID?: string;
};

export type OAuthCredential = {
  access: string;
  refresh?: string;
  expires?: number;
  accountId?: string;
  source: CredentialSource;
};

function credentialSource(entry: CredentialEntry): CredentialSource {
  return { type: "credential", label: entry.label || entry.integrationID };
}

function credentialOrgID(entry: CredentialEntry): string | undefined {
  const metadata = entry.value.type === "external" ? undefined : entry.value.metadata;
  if (!metadata) return undefined;
  for (const key of ["orgID", "orgId", "organizationID", "organizationId"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function tokenFromEntry(entry: CredentialEntry): string | undefined {
  if (entry.value.type === "key") return entry.value.key || undefined;
  if (entry.value.type === "oauth") return entry.value.access || undefined;
  return undefined;
}

function findEntry(
  credentials: CredentialSet | undefined,
  integrationIDs: readonly string[],
  valueType?: "key" | "oauth"
): CredentialEntry | undefined {
  if (!credentials?.length) return undefined;
  for (const integrationID of integrationIDs) {
    if (!integrationID) continue;
    const matches = credentials.filter(
      (entry) =>
        entry.integrationID === integrationID &&
        (valueType !== undefined
          ? entry.value.type === valueType
          : tokenFromEntry(entry) !== undefined)
    );
    if (!matches.length) continue;
    const active = matches.filter((entry) => entry.active);
    return (active.length ? active : matches).at(-1);
  }
  return undefined;
}

export function resolveApiCredential(input: {
  env: readonly string[];
  credentials?: CredentialSet;
  integrationIDs: readonly string[];
}): ApiCredential | undefined {
  const entry = findEntry(input.credentials, input.integrationIDs);
  const token = entry ? tokenFromEntry(entry) : undefined;
  if (entry && token) {
    return { token, source: credentialSource(entry), orgID: credentialOrgID(entry) };
  }

  for (const env of input.env) {
    const value = process.env[env]?.trim();
    if (value) return { token: value, source: { type: "env", label: env } };
  }

  return undefined;
}

export function resolveOAuthCredential(input: {
  credentials?: CredentialSet;
  integrationIDs: readonly string[];
}): OAuthCredential | undefined {
  const entry = findEntry(input.credentials, input.integrationIDs, "oauth");
  if (!entry || entry.value.type !== "oauth") return undefined;
  const metadata = entry.value.metadata;
  const accountId =
    (typeof metadata?.accountID === "string" && metadata.accountID) ||
    (typeof metadata?.accountId === "string" && metadata.accountId) ||
    undefined;
  return {
    access: entry.value.access,
    refresh: entry.value.refresh || undefined,
    expires: typeof entry.value.expires === "number" ? entry.value.expires : undefined,
    accountId,
    source: credentialSource(entry)
  };
}

export function describeCredentialSource(source: CredentialSource | undefined): string | undefined {
  if (!source) return undefined;
  if (source.type === "env") return `env:${source.label}`;
  return `credential:${source.label}`;
}

export function credentialFingerprint(credentials: CredentialSet | undefined): string {
  if (!credentials?.length) return "none";
  return credentials
    .map((entry) => {
      const value = tokenFromEntry(entry) ?? entry.value.type;
      return `${entry.integrationID}:${entry.label}:${entry.active ? "1" : "0"}:${value}`;
    })
    .join("\n");
}
