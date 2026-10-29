import { describe, expect, it } from "vitest";
import { PROVIDER_ADAPTERS, resolveProviderAdapter } from "../src/lib/providers/registry.js";

describe("provider adapter registry", () => {
  it("routes every alias to exactly one adapter", () => {
    const seen = new Map<string, string>();
    for (const adapter of PROVIDER_ADAPTERS) {
      const aliases = [...new Set([adapter.id, ...adapter.aliases].map((alias) => alias.toLowerCase()))];
      for (const key of aliases) {
        expect(seen.get(key)).toBeUndefined();
        seen.set(key, adapter.id);
        expect(resolveProviderAdapter(key)?.id).toBe(adapter.id);
      }
    }
  });

  it("keeps provider-specific integration whitelists", () => {
    for (const adapter of PROVIDER_ADAPTERS) {
      expect(adapter.integrationIDs.length).toBeGreaterThan(0);
      for (const integrationID of adapter.integrationIDs) {
        expect(resolveProviderAdapter(integrationID)).toBeDefined();
      }
    }
  });

  it("returns undefined for unknown providers", () => {
    expect(resolveProviderAdapter("custom-alpha")).toBeUndefined();
    expect(resolveProviderAdapter("")).toBeUndefined();
  });
});
