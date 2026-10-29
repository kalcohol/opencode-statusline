import type { SessionMessageInfo } from "@opencode/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatuslineEvents } from "../src/lib/statusline-events.js";

const tokens = (input: number, output: number) => ({
  input,
  output,
  reasoning: 0,
  cache: { read: 0, write: 0 }
});

const user = (id: string, created: number) =>
  ({ id, type: "user", time: { created } }) as unknown as SessionMessageInfo;

const assistant = (id: string, created: number, streamed: number, output: number) =>
  ({
    id,
    type: "assistant",
    time: { created, streamed, completed: streamed },
    agent: "build",
    model: { id: "model", providerID: "test" },
    content: [],
    tokens: tokens(100, output)
  }) as unknown as SessionMessageInfo;

function setup(messages: Map<string, SessionMessageInfo[]>) {
  const badge: Array<{ count: number; speed?: number }> = [];
  const refresh = vi.fn();
  const clearQuotaCaches = vi.fn();
  const resetQuota = vi.fn();
  const syncMessages = vi.fn(async (sessionID: string) => {
    if (!messages.has(sessionID)) messages.set(sessionID, []);
  });
  const events = new StatuslineEvents({
    currentSessionID: () => "root",
    subtree: () => [{ id: "root" }, { id: "child" }, { id: "loaded" }],
    messages: (sessionID) => messages.get(sessionID) ?? [],
    syncMessages,
    clearQuotaCaches,
    resetQuota,
    refresh,
    setBadge: (state) => badge.push(state)
  });
  return { events, badge, refresh, clearQuotaCaches, resetQuota, syncMessages };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("statusline event wiring", () => {
  it("counts a child completion once and adds an execution-boundary speed", async () => {
    const messages = new Map<string, SessionMessageInfo[]>();
    const child = [user("boundary", 0)];
    messages.set("child", child);
    const { events, badge, refresh } = setup(messages);

    events.start("child");
    child.push(user("new-user", 10), assistant("new-assistant", 10, 1_010, 100));
    events.success("child");

    expect(refresh).toHaveBeenCalled();
    expect(badge.at(-1)).toEqual({ count: 1, speed: 100 });

    events.success("child");
    expect(badge.at(-1)).toEqual({ count: 1, speed: 100 });
  });

  it("clears the badge after the completion window", () => {
    vi.useFakeTimers();
    const messages = new Map<string, SessionMessageInfo[]>();
    messages.set("child", [user("boundary", 0)]);
    const { events, badge } = setup(messages);

    events.start("child");
    events.success("child");
    vi.advanceTimersByTime(8_000);

    expect(badge.at(-1)).toEqual({ count: 0 });
  });

  it("does not count failed executions as completions", () => {
    const messages = new Map<string, SessionMessageInfo[]>();
    messages.set("child", [user("boundary", 0)]);
    const { events, badge } = setup(messages);

    events.start("child");
    events.fail("child");
    events.success("child");

    expect(badge).toEqual([]);
  });

  it("syncs empty descendant sessions once for family generation", () => {
    const messages = new Map<string, SessionMessageInfo[]>();
    messages.set("loaded", [user("loaded-user", 0)]);
    const { events, syncMessages } = setup(messages);

    events.syncFamily([{ id: "root" }, { id: "child" }, { id: "loaded" }]);
    events.syncFamily([{ id: "root" }, { id: "child" }, { id: "loaded" }]);

    expect(syncMessages).toHaveBeenCalledTimes(1);
    expect(syncMessages).toHaveBeenCalledWith("child");
  });

  it("clears quota caches and resets quota state on credential changes", () => {
    const { events, refresh, clearQuotaCaches, resetQuota } = setup(new Map());

    events.credentialChanged();

    expect(clearQuotaCaches).toHaveBeenCalledTimes(1);
    expect(resetQuota).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("resets badge and family sync state when the session changes", () => {
    const messages = new Map<string, SessionMessageInfo[]>();
    messages.set("child", []);
    const { events, badge, syncMessages } = setup(messages);

    events.start("child");
    events.success("child");
    events.syncFamily([{ id: "root" }, { id: "child" }]);
    events.resetSession();
    events.syncFamily([{ id: "root" }, { id: "child" }]);

    expect(badge.at(-1)).toEqual({ count: 0 });
    expect(syncMessages).toHaveBeenCalledTimes(2);
  });
});
