import { describe, expect, it } from "vitest";
import {
  clockEmoji,
  docTitle,
  formatDateLine,
  formatInfoLine,
  formatWeather,
  monthFolderName,
} from "../src/journal/text";

describe("America/Chicago time", () => {
  it("formats the spec example as a 24-hour Chicago date line", () => {
    expect(formatDateLine(new Date("2026-11-10T14:16:00.000Z"))).toBe(
      "TUESDAY, NOVEMBER 10, 2026 \u00b7 08:16",
    );
  });

  it("uses CDT in July and does not zero-pad the day", () => {
    expect(formatDateLine(new Date("2026-07-04T15:05:00.000Z"))).toBe(
      "SATURDAY, JULY 4, 2026 \u00b7 10:05",
    );
  });

  it("formats midnight as 00:00", () => {
    expect(formatDateLine(new Date("2026-01-01T06:00:00.000Z"))).toBe(
      "THURSDAY, JANUARY 1, 2026 \u00b7 00:00",
    );
  });

  it("keeps the hour before the November DST fallback in October", () => {
    const at = new Date("2026-11-01T04:30:00.000Z");
    expect(formatDateLine(at)).toBe("SATURDAY, OCTOBER 31, 2026 \u00b7 23:30");
    expect(monthFolderName(at)).toBe("10 - October");
    expect(docTitle(at)).toBe("Personal Journal \u2013 October 2026");
  });

  it("uses CST after the November DST fallback", () => {
    const at = new Date("2026-11-01T07:30:00.000Z");
    expect(formatDateLine(at)).toBe("SUNDAY, NOVEMBER 1, 2026 \u00b7 01:30");
    expect(monthFolderName(at)).toBe("11 - November");
  });

  it("picks the nearest half-hour clock emoji", () => {
    expect(clockEmoji(8, 16)).toBe("\u{1F563}");
    expect(clockEmoji(10, 0)).toBe("\u{1F559}");
    expect(clockEmoji(23, 30)).toBe("\u{1F566}");
    expect(clockEmoji(0, 0)).toBe("\u{1F55B}");
  });

  it("formats the info strip like the spec and never includes coordinates", () => {
    const line = formatInfoLine(
      new Date("2026-11-10T14:16:00.000Z"),
      "Chicago, IL",
      formatWeather(0, 48.4),
    );
    expect(line).toBe("\u{1F563} 08:16  \u00b7  \u{1F4CD} Chicago, IL  \u00b7  \u2600\ufe0f 48\u00b0F, clear");
    expect(line).not.toMatch(/\d+\.\d+/);
  });
});
