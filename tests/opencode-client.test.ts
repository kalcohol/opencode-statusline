import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveActiveModel, type MinimalOpencodeClient } from "../src/lib/opencode-client.js";

const previousStateDir = process.env.OPENCODE_STATUSLINE_STATE_DIR;
let stateDir = "";

function writeModelState(recent: unknown[]): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, "model.json"), `${JSON.stringify({ recent })}\n`);
}

describe("resolveActiveModel", () => {
  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-statusline-"));
    process.env.OPENCODE_STATUSLINE_STATE_DIR = stateDir;
  });

  afterEach(() => {
    if (previousStateDir === undefined) delete process.env.OPENCODE_STATUSLINE_STATE_DIR;
    else process.env.OPENCODE_STATUSLINE_STATE_DIR = previousStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("uses the TUI recent model before a stale session model", async () => {
    writeModelState([{ providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" }]);
    const client: MinimalOpencodeClient = {
      session: {
        get: async () => ({ model: { providerID: "zai", id: "glm-4.5" } })
      }
    };

    await expect(
      resolveActiveModel({
        client,
        sessionID: "ses_1",
        config: { model: "deepseek/deepseek-chat" },
        providers: [
          { id: "openrouter", models: { "anthropic/claude-sonnet-4": {} } },
          { id: "zai", models: { "glm-4.5": {} } }
        ]
      })
    ).resolves.toEqual({ providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" });
  });

  it("prefers the authoritative TUI state directory over a guessed environment path", async () => {
    const guessedDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-statusline-guessed-"));
    process.env.OPENCODE_STATUSLINE_STATE_DIR = guessedDir;
    writeModelState([{ providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" }]);

    await expect(resolveActiveModel({
      client: {},
      sessionID: "ses_1",
      stateDir,
      providers: [{ id: "openrouter", models: { "anthropic/claude-sonnet-4": {} } }]
    })).resolves.toEqual({ providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" });

    fs.rmSync(guessedDir, { recursive: true, force: true });
  });

  it("keeps an explicit command model first", async () => {
    writeModelState([{ providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" }]);

    await expect(
      resolveActiveModel({
        client: {},
        sessionID: "ses_1",
        commandModel: "kimi/k2"
      })
    ).resolves.toEqual({ providerID: "kimi", modelID: "k2" });
  });

  it("skips recent models that are not configured providers", async () => {
    writeModelState([
      { providerID: "missing", modelID: "nope" },
      { providerID: "kimi", modelID: "k2" }
    ]);

    await expect(
      resolveActiveModel({
        client: {},
        sessionID: "ses_1",
        providers: [{ id: "kimi", models: { k2: {} } }]
      })
    ).resolves.toEqual({ providerID: "kimi", modelID: "k2" });
  });

  it("keeps the session model when the recent model state is older than session activity", async () => {
    writeModelState([{ providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" }]);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(stateDir, "model.json"), old, old);
    const client: MinimalOpencodeClient = {
      session: {
        get: async () => ({
          model: { providerID: "zai", id: "glm-4.5" },
          time: { updated: Date.now() }
        })
      }
    };

    await expect(
      resolveActiveModel({
        client,
        sessionID: "ses_1",
        providers: [
          { id: "openrouter", models: { "anthropic/claude-sonnet-4": {} } },
          { id: "zai", models: { "glm-4.5": {} } }
        ]
      })
    ).resolves.toEqual({ providerID: "zai", modelID: "glm-4.5" });
  });

  it("uses config.model before stale recent state from an older TUI run", async () => {
    writeModelState([{ providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" }]);
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(stateDir, "model.json"), old, old);

    await expect(
      resolveActiveModel({
        client: {},
        sessionID: "ses_1",
        config: { model: "deepseek/deepseek-chat" },
        providers: [
          { id: "openrouter", models: { "anthropic/claude-sonnet-4": {} } },
          { id: "deepseek", models: { "deepseek-chat": {} } }
        ]
      })
    ).resolves.toEqual({ providerID: "deepseek", modelID: "deepseek-chat" });
  });
});
