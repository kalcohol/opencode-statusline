import { describe, expect, it } from "vitest";
import { familySyncTargets, isSubtreeSession } from "../src/lib/statusline-view-logic.js";

describe("statusline view logic", () => {
  const subtree = [{ id: "root" }, { id: "child" }, { id: "grandchild" }];

  it("recognizes only current or descendant session events", () => {
    expect(isSubtreeSession("root", "root", subtree)).toBe(false);
    expect(isSubtreeSession("child", "root", subtree)).toBe(true);
    expect(isSubtreeSession("grandchild", "root", subtree)).toBe(true);
    expect(isSubtreeSession("sibling", "root", subtree)).toBe(false);
  });

  it("syncs each empty descendant once and skips messages that are already loaded", () => {
    const synced = new Set<string>();
    const messages = (id: string) => (id === "grandchild" ? [{ id: "m" }] : []);

    expect(
      familySyncTargets({
        sessions: subtree,
        currentSessionID: "root",
        synced,
        messages
      })
    ).toEqual(["child"]);

    synced.add("child");
    expect(
      familySyncTargets({
        sessions: subtree,
        currentSessionID: "root",
        synced,
        messages
      })
    ).toEqual([]);
  });
});
