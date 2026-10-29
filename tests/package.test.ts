import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
) as {
  exports?: Record<string, { default?: string; types?: string }>;
  scripts?: Record<string, string>;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  "oc-plugin"?: unknown;
};

describe("V2 TUI package boundary", () => {
  it("exports only a precompiled TUI entry", () => {
    expect(pkg.exports).toEqual({
      "./tui": {
        types: "./dist/tui.d.ts",
        default: "./dist/tui.js"
      }
    });
    expect(pkg["oc-plugin"]).toBeUndefined();
    expect(pkg.scripts?.prepack).toBe("npm run build");
    expect(pkg.scripts?.build).toContain("node scripts/clean-dist.mjs && tsc");
    expect(pkg.private).toBe(true);
  });

  it("uses the V2 plugin API while keeping host packages external", () => {
    expect(pkg.dependencies?.["@opencode/plugin"]).toBeUndefined();
    expect(pkg.dependencies?.["@opencode/client"]).toBeUndefined();
    expect(pkg.dependencies?.["@opencode-ai/plugin"]).toBeUndefined();
    expect(pkg.devDependencies?.["@opencode/plugin"]).toMatch(/^\^2\./);
    expect(pkg.devDependencies?.["@opencode/client"]).toMatch(/^\^2\./);
    expect(pkg.peerDependencies?.["@opencode/plugin"]).toMatch(/^\^2\./);
    expect(pkg.peerDependencies?.["@opencode/client"]).toMatch(/^\^2\./);
    expect(pkg.dependencies?.["@opentui/core"]).toBeUndefined();
    expect(pkg.dependencies?.["@opentui/solid"]).toBeUndefined();
    expect(pkg.peerDependencies?.["@opentui/core"]).toMatch(/0\.7\.0/);
    expect(pkg.peerDependencies?.["@opentui/solid"]).toMatch(/0\.7\.0/);
    expect(pkg.peerDependencies?.["solid-js"]).toBeTruthy();
  });

  it("ships a V2 default plugin module without stale JSX output", async () => {
    const distTui = new URL("../dist/tui.js", import.meta.url);
    const source = await readFile(distTui, "utf8");

    await expect(access(new URL("../dist/tui.jsx", import.meta.url))).rejects.toThrow();
    await expect(access(new URL("../dist/tui.tsx", import.meta.url))).rejects.toThrow();
    expect(source).toContain("Plugin.define");
    expect(source).toContain('append: "prompt.footer.status"');
    expect(source).toMatch(/slash:\s*\{\s*name:\s*"quota"/);
    expect(source).toContain("arguments: true");
    expect(source).not.toContain("session_prompt_right");
    expect(source).not.toContain("jsx-dev-runtime");
  });
});
