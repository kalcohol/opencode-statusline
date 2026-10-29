import type { CredentialEntry } from "@opencode/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  credentialFingerprint,
  describeCredentialSource,
  resolveApiCredential,
  resolveOAuthCredential
} from "../src/lib/credentials.js";

const savedEnv = { ...process.env };

function keyEntry(input: {
  id?: string;
  integrationID: string;
  label?: string;
  key: string;
  active?: boolean;
}): CredentialEntry {
  return {
    id: input.id ?? `${input.integrationID}-${input.label ?? "key"}`,
    integrationID: input.integrationID,
    label: input.label ?? "key",
    active: input.active ?? false,
    value: { type: "key", key: input.key }
  };
}

function oauthEntry(input: {
  integrationID: string;
  label?: string;
  access: string;
  active?: boolean;
  metadata?: Record<string, unknown>;
}): CredentialEntry {
  return {
    id: `${input.integrationID}-oauth`,
    integrationID: input.integrationID,
    label: input.label ?? "oauth",
    active: input.active ?? false,
    value: {
      type: "oauth",
      methodID: "test",
      refresh: "refresh",
      access: input.access,
      expires: Date.now() + 60_000,
      metadata: input.metadata
    }
  };
}

describe("V2 credential resolution", () => {
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it("prefers the active saved credential over the environment", () => {
    process.env.DEEPSEEK_API_KEY = "env-key";
    const credential = resolveApiCredential({
      env: ["DEEPSEEK_API_KEY"],
      credentials: [keyEntry({ integrationID: "deepseek", key: "saved-key", active: true })],
      integrationIDs: ["deepseek"]
    });

    expect(credential).toEqual({
      token: "saved-key",
      source: { type: "credential", label: "key" }
    });
  });

  it("falls back to environment variables when no credential matches", () => {
    process.env.DEEPSEEK_API_KEY = "env-key";
    const credential = resolveApiCredential({
      env: ["DEEPSEEK_API_KEY"],
      credentials: [],
      integrationIDs: ["deepseek"]
    });

    expect(credential).toEqual({
      token: "env-key",
      source: { type: "env", label: "DEEPSEEK_API_KEY" }
    });
  });

  it("uses the active credential for the first matching integration", () => {
    const credential = resolveApiCredential({
      env: [],
      credentials: [
        keyEntry({ integrationID: "zai", label: "old", key: "old-key", active: false }),
        keyEntry({ integrationID: "zai", label: "current", key: "new-key", active: true }),
        keyEntry({ integrationID: "zai-coding-plan", label: "plan", key: "plan-key", active: true })
      ],
      integrationIDs: ["zai", "zai-coding-plan"]
    });

    expect(credential).toEqual({
      token: "new-key",
      source: { type: "credential", label: "current" }
    });
  });

  it("does not use OAuth access tokens as generic API credentials", () => {
    const credential = resolveApiCredential({
      env: [],
      credentials: [oauthEntry({ integrationID: "opencode", access: "oauth-access", active: true })],
      integrationIDs: ["opencode"]
    });

    expect(credential).toBeUndefined();
  });

  it("resolves OAuth metadata account ids", () => {
    const credential = resolveOAuthCredential({
      credentials: [
        oauthEntry({
          integrationID: "openai",
          access: "access",
          active: true,
          metadata: { accountID: "account-1" }
        })
      ],
      integrationIDs: ["openai"]
    });

    expect(credential).toMatchObject({
      access: "access",
      refresh: "refresh",
      accountId: "account-1"
    });
  });

  it("isolates credential fingerprints by value, active state, and integration", () => {
    const first = credentialFingerprint([
      keyEntry({ integrationID: "openrouter", label: "a", key: "key-a", active: true })
    ]);
    const second = credentialFingerprint([
      keyEntry({ integrationID: "openrouter", label: "a", key: "key-b", active: true })
    ]);

    expect(first).not.toBe(second);
    expect(describeCredentialSource({ type: "credential", label: "a" })).toBe("credential:a");
  });
});
