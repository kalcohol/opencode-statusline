import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTuiStatusline } from "../src/lib/statusline.js";

const previousConfigPath = process.env.OPENCODE_STATUSLINE_CONFIG;
const previousStateDir = process.env.OPENCODE_STATUSLINE_STATE_DIR;
let tempDir = "";

function apiWithContextLimit(context: number | undefined) {
  return {
    state: {
      config: { model: "openrouter/model-a" },
      provider: [
        {
          id: "openrouter",
          name: "OpenRouter",
          models: {
            "model-a": context === undefined ? {} : { limit: { context } }
          }
        }
      ],
      path: { worktree: "", directory: "" },
      vcs: undefined,
      session: {
        get: () => ({ model: { providerID: "openrouter", id: "model-a" } }),
        messages: () => [],
        status: () => ({ type: "idle" })
      }
    }
  };
}

describe("buildTuiStatusline", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-statusline-"));
    process.env.OPENCODE_STATUSLINE_CONFIG = path.join(tempDir, "statusline-plugin.json");
    process.env.OPENCODE_STATUSLINE_STATE_DIR = tempDir;
  });

  afterEach(() => {
    if (previousConfigPath === undefined) delete process.env.OPENCODE_STATUSLINE_CONFIG;
    else process.env.OPENCODE_STATUSLINE_CONFIG = previousConfigPath;
    if (previousStateDir === undefined) delete process.env.OPENCODE_STATUSLINE_STATE_DIR;
    else process.env.OPENCODE_STATUSLINE_STATE_DIR = previousStateDir;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("renders current model context length when available", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["context_length"] }));

    await expect(buildTuiStatusline(apiWithContextLimit(200_000) as any, "ses_1")).resolves.toBe("ctx max 195K");
  });

  it("omits context length when the provider has no model limit", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["context_length"] }));

    await expect(buildTuiStatusline(apiWithContextLimit(undefined) as any, "ses_1")).resolves.toBe("");
  });
});
