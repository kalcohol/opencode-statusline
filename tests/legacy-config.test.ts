import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLegacyStatuslineFields } from "../src/lib/legacy-config.js";

const previous = process.env.OPENCODE_STATUSLINE_CONFIG;
const roots: string[] = [];

function legacyFile(contents: string): void {
  const root = mkdtempSync(path.join(tmpdir(), "statusline-legacy-"));
  roots.push(root);
  const file = path.join(root, "statusline-plugin.json");
  writeFileSync(file, contents);
  process.env.OPENCODE_STATUSLINE_CONFIG = file;
}

afterEach(() => {
  if (previous === undefined) delete process.env.OPENCODE_STATUSLINE_CONFIG;
  else process.env.OPENCODE_STATUSLINE_CONFIG = previous;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("V1 statusline config bridge", () => {
  it("imports recognized fields in their stored order", () => {
    legacyFile(
      JSON.stringify({
        version: 1,
        fields: ["repo", "generation_metrics", "subagent_status", "speed", "nope"]
      })
    );

    expect(loadLegacyStatuslineFields()).toEqual([
      "repo",
      "generation_metrics",
      "subagent_status"
    ]);
  });

  it("preserves an explicitly cleared selection", () => {
    legacyFile(JSON.stringify({ version: 1, fields: [] }));

    expect(loadLegacyStatuslineFields()).toEqual([]);
  });

  it("ignores malformed state", () => {
    legacyFile("{not json");

    expect(loadLegacyStatuslineFields()).toBeUndefined();
  });
});
