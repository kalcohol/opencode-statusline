import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
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

function apiWithGenerationMetrics() {
  const message = {
    id: "msg_1",
    role: "assistant",
    time: { created: 1_000, completed: 4_000 },
    tokens: {
      input: 10,
      output: 80,
      reasoning: 0,
      cache: { read: 0, write: 0 }
    }
  };
  const partsByMessage: Record<string, unknown[]> = {
    msg_1: [
      {
        id: "prt_1",
        type: "text",
        time: { start: 1_600, end: 3_600 },
        text: "hello"
      }
    ]
  };
  return {
    state: {
      config: { model: "openrouter/model-a" },
      provider: [{ id: "openrouter", name: "OpenRouter", models: { "model-a": {} } }],
      path: { worktree: "", directory: "" },
      vcs: undefined,
      session: {
        get: () => ({ model: { providerID: "openrouter", id: "model-a" } }),
        messages: () => [message],
        status: () => ({ type: "idle" })
      },
      part: (messageID: string) => partsByMessage[messageID] ?? []
    }
  };
}

function assistantMessage(
  id: string,
  input: number,
  output: number,
  extra: { cost?: number; cacheRead?: number; cacheWrite?: number; model?: unknown } = {}
) {
  return {
    id,
    role: "assistant",
    cost: extra.cost,
    model: extra.model,
    tokens: {
      input,
      output,
      reasoning: 0,
      cache: { read: extra.cacheRead ?? 0, write: extra.cacheWrite ?? 0 }
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

  it("renders TTFT and generation speed from message and part timing", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["generation_metrics"] }));

    await expect(buildTuiStatusline(apiWithGenerationMetrics() as any, "ses_1")).resolves.toBe("ttft 600ms gen 40 tok/s");
  });

  it("renders tracked git diff insertion and deletion counts", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["git_diff_stats"] }));
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: tempDir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: tempDir, stdio: "ignore" });
    fs.writeFileSync(path.join(tempDir, "file.txt"), "one\ntwo\nthree\n");
    execFileSync("git", ["add", "file.txt"], { cwd: tempDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tempDir, stdio: "ignore" });
    fs.writeFileSync(path.join(tempDir, "file.txt"), "one\nTWO\nthree\nfour\n");

    const api = {
      state: {
        config: { model: "openrouter/model-a" },
        provider: [{ id: "openrouter", name: "OpenRouter", models: { "model-a": {} } }],
        path: { worktree: tempDir, directory: tempDir },
        vcs: undefined,
        session: {
          get: () => ({ model: { providerID: "openrouter", id: "model-a" } }),
          messages: () => [],
          status: () => ({ type: "idle" })
        }
      }
    };

    await expect(buildTuiStatusline(api as any, "ses_1")).resolves.toBe("+2,-1");
  });

  it("keeps the last complete generation metrics while a new response is incomplete", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["generation_metrics"] }));
    const messages = [
      {
        id: "msg_1",
        role: "assistant",
        time: { created: 1_000, completed: 4_000 },
        tokens: { input: 10, output: 80, reasoning: 0, cache: { read: 0, write: 0 } }
      },
      {
        id: "msg_2",
        role: "assistant",
        time: { created: 5_000 },
        tokens: { input: 10, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
      }
    ];
    const partsByMessage: Record<string, unknown[]> = {
      msg_1: [{ id: "prt_1", type: "text", time: { start: 1_600, end: 3_600 }, text: "done" }],
      msg_2: [{ id: "prt_2", type: "text", time: { start: 5_300 }, text: "" }]
    };
    const api = {
      state: {
        config: { model: "openrouter/model-a" },
        provider: [{ id: "openrouter", name: "OpenRouter", models: { "model-a": {} } }],
        path: { worktree: "", directory: "" },
        vcs: undefined,
        session: {
          get: () => ({ model: { providerID: "openrouter", id: "model-a" } }),
          messages: () => messages,
          status: () => ({ type: "idle" })
        },
        part: (messageID: string) => partsByMessage[messageID] ?? []
      }
    };

    await expect(buildTuiStatusline(api as any, "ses_1")).resolves.toBe("ttft 600ms gen 40 tok/s");
  });

  it("uses concise branch, agent, token, and child-session text", async () => {
    fs.writeFileSync(
      process.env.OPENCODE_STATUSLINE_CONFIG!,
      JSON.stringify({ fields: ["branch", "agent_status", "session_io", "session_total"] })
    );
    const messagesBySession: Record<string, unknown[]> = {
      ses_1: [assistantMessage("msg_parent", 1024, 2048)],
      ses_child: [assistantMessage("msg_child", 3072, 4096)]
    };
    const api = {
      state: {
        config: { model: "openrouter/model-a" },
        provider: [{ id: "openrouter", name: "OpenRouter", models: { "model-a": {} } }],
        path: { worktree: "", directory: "" },
        vcs: { branch: "master" },
        session: {
          get: () => ({ model: { providerID: "openrouter", id: "model-a" } }),
          messages: (sessionID: string) => messagesBySession[sessionID] ?? [],
          status: () => ({ type: "idle" })
        }
      },
      client: {
        session: {
          children: async () => [{ id: "ses_child" }]
        }
      }
    };

    await expect(buildTuiStatusline(api as any, "ses_1")).resolves.toBe("master | idle | 4K in / 6K out | 10K used");
  });

  it("aggregates child-session tokens from the client when local state has not loaded them", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["session_io", "session_total"] }));
    const api = {
      state: {
        config: { model: "openrouter/model-a" },
        provider: [{ id: "openrouter", name: "OpenRouter", models: { "model-a": {} } }],
        path: { worktree: "", directory: "" },
        vcs: undefined,
        session: {
          get: () => ({ model: { providerID: "openrouter", id: "model-a" } }),
          messages: (sessionID: string) => sessionID === "ses_1" ? [assistantMessage("msg_parent", 1024, 2048)] : [],
          status: () => ({ type: "idle" })
        }
      },
      client: {
        session: {
          children: async () => [{ id: "ses_child" }],
          messages: async (input: { sessionID?: string }) => (
            input.sessionID === "ses_child"
              ? { data: [assistantMessage("msg_child", 3072, 4096)] }
              : { data: [] }
          )
        }
      }
    };

    await expect(buildTuiStatusline(api as any, "ses_1")).resolves.toBe("4K in / 6K out | 10K used");
  });

  it("renders recorded session cost including child sessions", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["session_cost"] }));
    const messagesBySession: Record<string, unknown[]> = {
      ses_1: [assistantMessage("msg_parent", 1024, 2048, { cost: 0.0123 })],
      ses_child: [assistantMessage("msg_child", 3072, 4096, { cost: 0.0077 })]
    };
    const api = {
      state: {
        config: { model: "openrouter/model-a" },
        provider: [{ id: "openrouter", name: "OpenRouter", models: { "model-a": {} } }],
        path: { worktree: "", directory: "" },
        vcs: undefined,
        session: {
          get: () => ({ model: { providerID: "openrouter", id: "model-a" } }),
          messages: (sessionID: string) => messagesBySession[sessionID] ?? [],
          status: () => ({ type: "idle" })
        }
      },
      client: {
        session: {
          children: async () => [{ id: "ses_child" }]
        }
      }
    };

    await expect(buildTuiStatusline(api as any, "ses_1")).resolves.toBe("cost $0.02");
  });

  it("estimates session cost from model pricing when recorded cost is missing", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["session_cost"] }));
    const api = {
      state: {
        config: { model: "openrouter/model-a" },
        provider: [{
          id: "openrouter",
          name: "OpenRouter",
          models: {
            "model-a": {
              cost: [{ input: 10, output: 20, cache: { read: 1, write: 5 } }]
            }
          }
        }],
        path: { worktree: "", directory: "" },
        vcs: undefined,
        session: {
          get: () => ({ model: { providerID: "openrouter", id: "model-a" } }),
          messages: () => [assistantMessage("msg_parent", 2_000, 1_000, { cacheRead: 1_000 })],
          status: () => ({ type: "idle" })
        }
      }
    };

    await expect(buildTuiStatusline(api as any, "ses_1")).resolves.toBe("eq $0.03");
  });

  it("omits subagent status when all child sessions are idle", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["subagent_status"] }));
    const api = {
      state: {
        config: { model: "openrouter/model-a" },
        provider: [{ id: "openrouter", name: "OpenRouter", models: { "model-a": {} } }],
        path: { worktree: "", directory: "" },
        vcs: undefined,
        session: {
          get: () => ({ model: { providerID: "openrouter", id: "model-a" } }),
          messages: () => [],
          status: () => ({ type: "idle" })
        }
      },
      client: {
        session: {
          children: async () => [{ id: "ses_child_1" }, { id: "ses_child_2" }]
        }
      }
    };

    await expect(buildTuiStatusline(api as any, "ses_1")).resolves.toBe("");
  });

  it("omits subagent status for inactive current subagent sessions", async () => {
    fs.writeFileSync(process.env.OPENCODE_STATUSLINE_CONFIG!, JSON.stringify({ fields: ["subagent_status"] }));
    const api = {
      state: {
        config: { model: "openrouter/model-a" },
        provider: [{ id: "openrouter", name: "OpenRouter", models: { "model-a": {} } }],
        path: { worktree: "", directory: "" },
        vcs: undefined,
        session: {
          get: () => ({ parentID: "ses_parent", model: { providerID: "openrouter", id: "model-a" } }),
          messages: () => [],
          status: () => ({ type: "idle" })
        }
      }
    };

    await expect(buildTuiStatusline(api as any, "ses_child")).resolves.toBe("");
  });
});
