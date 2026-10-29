import { describe, expect, it } from "vitest";
import { SubagentBadgeTracker } from "../src/lib/subagent-badge.js";

describe("subagent badge tracker", () => {
  it("records the execution boundary and counts a completion once", () => {
    const tracker = new SubagentBadgeTracker();
    tracker.start("child", "before-execution");

    expect(tracker.finish("child")).toEqual({
      counted: true,
      afterID: "before-execution"
    });
    expect(tracker.finish("child")).toEqual({ counted: false });
  });

  it("allows the same child to count a later execution", () => {
    const tracker = new SubagentBadgeTracker();
    tracker.start("child", "first");
    expect(tracker.finish("child").counted).toBe(true);
    tracker.start("child", "second");
    expect(tracker.finish("child")).toEqual({ counted: true, afterID: "second" });
  });

  it("clears done state, fails, and resets session boundaries", () => {
    const tracker = new SubagentBadgeTracker();
    tracker.start("child", "first");
    tracker.finish("child");
    tracker.clearDone();
    expect(tracker.finish("child")).toEqual({ counted: true, afterID: undefined });

    tracker.start("child", "second");
    tracker.fail("child");
    expect(tracker.finish("child")).toEqual({ counted: false });

    tracker.reset();
    expect(tracker.finish("other")).toEqual({ counted: true, afterID: undefined });
  });

  it("works without a known message boundary", () => {
    const tracker = new SubagentBadgeTracker();
    tracker.start("child", undefined);
    expect(tracker.finish("child")).toEqual({ counted: true, afterID: undefined });
  });
});
