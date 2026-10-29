import { describe, expect, it, vi } from "vitest";
import {
  createFieldSaveQueue,
  fieldOptions,
  runStatuslineEditor
} from "../src/lib/statusline-editor.js";
import type { StatuslineFieldID } from "../src/lib/statusline-config.js";

describe("statusline editor", () => {
  it("labels selected fields in their chosen order", () => {
    expect(fieldOptions(["branch", "repo"])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "[x] Branch",
          value: "branch",
          description: "#1 branch"
        }),
        expect.objectContaining({
          title: "[x] Repository",
          value: "repo",
          description: "#2 repo"
        })
      ])
    );
  });

  it("serializes saves and preserves operation order", async () => {
    let release: (() => void) | undefined;
    const save = vi.fn(
      (fields: readonly StatuslineFieldID[]) =>
        new Promise<void>((resolve) => {
          if (fields[0] === "repo") release = resolve;
          else resolve();
        })
    );
    const queue = createFieldSaveQueue(save);

    const first = queue(["repo"]);
    const second = queue(["branch"]);
    await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenLastCalledWith(["repo"]);

    release?.();
    await first;
    await second;

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls.map(([fields]) => fields)).toEqual([["repo"], ["branch"]]);
  });

  it("toggles fields, reopens the selector, and clears through the dialog action", async () => {
    const persist = vi.fn(async () => undefined);
    const clearDialog = vi.fn();
    const selections: Array<StatuslineFieldID | undefined> = [
      "repo",
      "branch",
      undefined,
      "repo",
      "branch",
      undefined
    ];
    const select = vi.fn(async (options: { actions?: Array<{ onTrigger: () => void }> }) => {
      const selected = selections.shift();
      if (selected === undefined && select.mock.calls.length === 3) {
        options.actions?.[0]?.onTrigger();
      }
      return selected;
    });

    await runStatuslineEditor({
      fields: () => [],
      persist,
      select,
      clearDialog
    });

    expect(persist.mock.calls.map(([fields]) => fields)).toEqual([
      ["repo"],
      ["repo", "branch"],
      []
    ]);
    expect(clearDialog).toHaveBeenCalledTimes(1);
  });
});
