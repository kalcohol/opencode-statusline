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
};

describe("package runtime boundary", () => {
  it("exports a precompiled TUI entry", () => {
    expect(pkg.exports?.["./tui"]).toEqual({
      types: "./dist/tui.d.ts",
      default: "./dist/tui.js"
    });
    expect(pkg.scripts?.prepack).toBe("npm run build");
    expect(pkg.scripts?.build).toContain("node scripts/clean-dist.mjs && tsc");
    expect(pkg.private).toBe(true);
  });

  it("aligns the OpenTUI runtime and keeps the host plugin API as a peer", () => {
    expect(pkg.dependencies?.["@opentui/core"]).toMatch(/^\^0\.4\./);
    expect(pkg.dependencies?.["@opentui/keymap"]).toMatch(/^\^0\.4\./);
    expect(pkg.dependencies?.["@opentui/solid"]).toMatch(/^\^0\.4\./);
    expect(pkg.dependencies?.["@opencode-ai/plugin"]).toBeUndefined();
    expect(pkg.devDependencies?.["@opencode-ai/plugin"]).toBeTruthy();
    expect(pkg.peerDependencies?.["@opencode-ai/plugin"]).toBeTruthy();
  });

  it("ships generated JavaScript without stale JSX output", async () => {
    const distTui = new URL("../dist/tui.js", import.meta.url);
    const source = await readFile(distTui, "utf8");

    await expect(access(new URL("../dist/tui.jsx", import.meta.url))).rejects.toThrow();
    await expect(access(new URL("../dist/tui.tsx", import.meta.url))).rejects.toThrow();
    expect(source).toContain("createComponent");
    expect(source).toContain("opencode-statusline");
    expect(source).toContain("session_prompt_right");
    expect(source).not.toContain("process.platform");
    expect(source).not.toContain("jsx-dev-runtime");
  });
});
