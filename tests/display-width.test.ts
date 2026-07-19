import { describe, expect, it } from "vitest";
import { displayColumns, takeColumns } from "../src/lib/display-width.js";

describe("terminal display width", () => {
  it("measures combining marks and joined emoji as grapheme clusters", () => {
    expect(displayColumns("e\u0301")).toBe(1);
    expect(displayColumns("A\u{1F469}\u200D\u{1F4BB}B")).toBe(4);
  });

  it("does not split a joined emoji while truncating", () => {
    expect(takeColumns("A\u{1F469}\u200D\u{1F4BB}B", 3)).toBe("A\u{1F469}\u200D\u{1F4BB}");
  });
});
