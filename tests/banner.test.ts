import { describe, expect, it } from "vitest";
import { incrementCountLine } from "../src/journal/text";

describe("banner count", () => {
  it("changes the singular line to plural", () => {
    expect(incrementCountLine("1 entry  \u00b7  Journal: Personal")).toBe(
      "2 entries  \u00b7  Journal: Personal",
    );
  });

  it("increments a plural line without changing the label", () => {
    expect(incrementCountLine("2 entries  \u00b7  Journal: Personal")).toBe(
      "3 entries  \u00b7  Journal: Personal",
    );
  });

  it("refuses a line that is not the banner", () => {
    expect(() => incrementCountLine("1 entry · Journal: Personal")).toThrow(/banner count/);
  });
});
