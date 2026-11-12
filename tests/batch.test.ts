import { describe, expect, it } from "vitest";
import { buildAppendRequests, buildCreateRequests, buildWriteRequests, type TextStyle } from "../src/journal/batch";
import { structureFromPlainText } from "../src/journal/structure";
import { DIVIDER, KICKER, renderDocument } from "../src/journal/text";
import { applyDoc, paragraphRangesStayInside } from "./applyDoc";
import { entryOne, entryTwo } from "./fixtures";

function hex(style: Partial<TextStyle> | undefined): string {
  const rgb = style?.foregroundColor?.color.rgbColor;
  if (!rgb) return "";
  const channel = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${channel(rgb.red)}${channel(rgb.green)}${channel(rgb.blue)}`;
}

function background(style: Partial<TextStyle> | undefined): string {
  const rgb = style?.backgroundColor?.color?.rgbColor;
  if (!rgb) return "";
  const channel = (value: number) => Math.round(value * 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${channel(rgb.red)}${channel(rgb.green)}${channel(rgb.blue)}`;
}

describe("entry batchUpdate builder", () => {
  it("builds the spec template text and styles for a new document", () => {
    const template = renderDocument([entryOne]);
    const body = buildCreateRequests(entryOne, "rev-1");
    expect(body.writeControl.requiredRevisionId).toBe("rev-1");
    const applied = applyDoc(body.requests);
    paragraphRangesStayInside(body.requests);
    expect(applied.text).toBe(template);
    expect(applied.paragraphs.map((paragraph) => paragraph.text).join("\n") + "\n").toBe(template);

    const byText = new Map(applied.paragraphs.filter((paragraph) => paragraph.text).map((paragraph) => [paragraph.text, paragraph]));
    const kicker = byText.get(KICKER);
    expect(kicker?.textStyle?.weightedFontFamily).toEqual({ fontFamily: "Montserrat", weight: 700 });
    expect(kicker?.textStyle?.fontSize).toEqual({ magnitude: 9, unit: "PT" });
    expect(kicker?.textStyle?.bold).toBe(true);
    expect(hex(kicker?.textStyle)).toBe("#1A73E8");
    expect(kicker?.para).toMatchObject({ namedStyleType: "NORMAL_TEXT", lineSpacing: 115, spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" } });

    const month = byText.get("November 2026");
    expect(month?.textStyle?.weightedFontFamily).toEqual({ fontFamily: "Montserrat", weight: 400 });
    expect(month?.textStyle?.fontSize).toEqual({ magnitude: 34, unit: "PT" });
    expect(month?.textStyle?.bold).toBe(false);
    expect(hex(month?.textStyle)).toBe("#202124");
    expect(month?.para?.lineSpacing).toBe(115);

    const count = byText.get("1 entry  \u00b7  Journal: Personal");
    expect(count?.textStyle?.weightedFontFamily).toEqual({ fontFamily: "Lato", weight: 400 });
    expect(count?.textStyle?.fontSize).toEqual({ magnitude: 10, unit: "PT" });
    expect(hex(count?.textStyle)).toBe("#5F6368");
    expect(count?.para?.lineSpacing).toBe(115);

    const divider = byText.get(DIVIDER);
    expect(divider?.textStyle?.weightedFontFamily).toEqual({ fontFamily: "Arial", weight: 400 });
    expect(divider?.textStyle?.fontSize).toEqual({ magnitude: 11, unit: "PT" });
    expect(hex(divider?.textStyle)).toBe("#DADCE0");
    expect(divider?.para?.lineSpacing).toBe(115);

    const bannerBlank = applied.paragraphs[4];
    expect(bannerBlank?.text).toBe("");
    expect(bannerBlank?.para?.lineSpacing).toBe(115);

    const date = byText.get("TUESDAY, NOVEMBER 10, 2026 \u00b7 08:16");
    expect(date?.textStyle?.weightedFontFamily).toEqual({ fontFamily: "Arial", weight: 700 });
    expect(date?.textStyle?.bold).toBe(true);
    expect(date?.textStyle?.fontSize).toEqual({ magnitude: 9, unit: "PT" });
    expect(hex(date?.textStyle)).toBe("#1A73E8");
    expect(date?.para).toMatchObject({ namedStyleType: "NORMAL_TEXT", lineSpacing: 100, spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" } });

    const titleText = "Placeholder Title  \u{1F610}";
    const title = byText.get(titleText);
    expect(title?.para).toEqual({ namedStyleType: "HEADING_1", lineSpacing: 100 });
    expect(title?.textStyle).toEqual({});
    const titleStart = template.indexOf(titleText) + 1;
    const titleStyle = body.requests.find((request) => request.updateParagraphStyle?.range.startIndex === titleStart);
    expect(titleStyle?.updateParagraphStyle?.fields).toBe("namedStyleType,lineSpacing,spaceAbove,spaceBelow");
    expect(titleStyle?.updateParagraphStyle?.paragraphStyle.spaceAbove).toBeUndefined();
    expect(titleStyle?.updateParagraphStyle?.paragraphStyle.spaceBelow).toBeUndefined();
    const titleTextReset = body.requests.find((request) => request.updateTextStyle?.range.startIndex === titleStart);
    expect(titleTextReset?.updateTextStyle?.textStyle).toEqual({});
    expect(titleTextReset?.updateTextStyle?.fields).toContain("weightedFontFamily");
    expect(titleTextReset?.updateTextStyle?.fields).toContain("link");

    const mood = byText.get("Mood: calm, focused");
    expect(mood?.textStyle?.weightedFontFamily?.fontFamily).toBe("Arial");
    expect(mood?.textStyle?.italic).toBe(true);
    expect(mood?.textStyle?.fontSize).toEqual({ magnitude: 10, unit: "PT" });
    expect(hex(mood?.textStyle)).toBe("#5F6368");
    expect(mood?.para?.lineSpacing).toBe(100);

    const info = applied.paragraphs.find((paragraph) => paragraph.text.includes("\u{1F4CD}"));
    expect(info?.text).toBe("\u{1F563} 08:16  \u00b7  \u{1F4CD} Chicago, IL  \u00b7  \u2600\ufe0f 48\u00b0F, clear");
    expect(info?.textStyle?.weightedFontFamily).toEqual({ fontFamily: "Arial", weight: 400 });
    expect(info?.textStyle?.bold).toBe(false);
    expect(info?.textStyle?.fontSize).toEqual({ magnitude: 9, unit: "PT" });
    expect(hex(info?.textStyle)).toBe("#3C4043");
    expect(background(info?.textStyle)).toBe("#F1F3F4");
    expect(info?.para).not.toHaveProperty("backgroundColor");

    const bodyLine = byText.get("First placeholder paragraph.");
    expect(bodyLine?.textStyle).toMatchObject({ bold: false, italic: false, fontSize: { magnitude: 11, unit: "PT" }, weightedFontFamily: { fontFamily: "Arial", weight: 400 } });
    expect(hex(bodyLine?.textStyle)).toBe("#000000");
    expect(bodyLine?.para?.lineSpacing).toBe(100);

    const tags = byText.get("#calm #focused  \u00b7  #placeholder");
    expect(tags?.textStyle?.weightedFontFamily?.fontFamily).toBe("Arial");
    expect(tags?.textStyle?.italic).toBe(true);
    expect(tags?.textStyle?.fontSize).toEqual({ magnitude: 10, unit: "PT" });
    expect(hex(tags?.textStyle)).toBe("#5F6368");

    for (const line of ["Journal: November 2026 \u00b7 Published", "Source: journal-app"]) {
      const paragraph = byText.get(line);
      expect(paragraph?.textStyle?.fontSize).toEqual({ magnitude: 8, unit: "PT" });
      expect(paragraph?.textStyle?.bold).toBe(false);
      expect(paragraph?.textStyle?.italic).toBe(false);
      expect(paragraph?.textStyle?.weightedFontFamily).toEqual({ fontFamily: "Arial", weight: 400 });
      expect(hex(paragraph?.textStyle)).toBe("#9AA0A6");
      expect(paragraph?.para?.lineSpacing).toBe(100);
    }

    const normal = body.requests.find((request) => request.updateNamedStyle?.namedStyle.namedStyleType === "NORMAL_TEXT");
    expect(normal?.updateNamedStyle?.namedStyle).toMatchObject({
      textStyle: { bold: false, fontSize: { magnitude: 11, unit: "PT" }, weightedFontFamily: { fontFamily: "Arial", weight: 400 } },
      paragraphStyle: { lineSpacing: 115, spaceAbove: { magnitude: 0, unit: "PT" }, spaceBelow: { magnitude: 0, unit: "PT" } },
    });
    const heading = body.requests.find((request) => request.updateNamedStyle?.namedStyle.namedStyleType === "HEADING_1");
    expect(heading?.updateNamedStyle?.namedStyle).toMatchObject({
      textStyle: { bold: false, fontSize: { magnitude: 20, unit: "PT" }, weightedFontFamily: { fontFamily: "Arial", weight: 400 } },
      paragraphStyle: { spaceAbove: { magnitude: 20, unit: "PT" }, spaceBelow: { magnitude: 6, unit: "PT" } },
    });
    expect(heading?.updateNamedStyle?.fields).not.toContain("lineSpacing");
    expect(body.requests.some((request) => request.createHeader?.type === "DEFAULT")).toBe(true);
    expect(JSON.stringify(body.requests)).not.toContain("Imported from");
    expect(template.endsWith("Source: journal-app\n")).toBe(true);
    expect(template.trimEnd().endsWith(DIVIDER)).toBe(false);
  });

  it("appends a second entry and updates the banner count without rewriting the first", () => {
    const original = renderDocument([entryOne]);
    const body = buildAppendRequests(structureFromPlainText(original), "rev-9", entryTwo);
    expect(body.writeControl.requiredRevisionId).toBe("rev-9");
    const applied = applyDoc(body.requests, original);
    paragraphRangesStayInside(body.requests, original);
    const expected = renderDocument([entryOne, entryTwo]);
    expect(applied.text).toBe(expected);
    expect(applied.text).toContain("2 entries  \u00b7  Journal: Personal");
    expect(applied.text).not.toContain("1 entry  \u00b7  Journal: Personal");
    expect(applied.text).toContain("Placeholder Title  \u{1F610}");
    expect(applied.text).toContain("Source: journal-app\n\u2501");
    const count = applied.paragraphs.find((paragraph) => paragraph.text.startsWith("2 entries"));
    expect(count?.textStyle?.weightedFontFamily?.fontFamily).toBe("Lato");
    expect(count?.textStyle?.fontSize?.magnitude).toBe(10);
    expect(hex(count?.textStyle)).toBe("#5F6368");
    expect(count?.para?.lineSpacing).toBe(115);
    const between = applied.paragraphs.filter((paragraph) => paragraph.text === DIVIDER);
    expect(between[0]?.para).toBeUndefined();
    expect(between[1]?.para?.lineSpacing).toBe(100);
    expect(between[1]?.textStyle?.fontSize).toEqual({ magnitude: 11, unit: "PT" });
    expect(hex(between[1]?.textStyle)).toBe("#DADCE0");
  });

  it("refuses to write a document that has no banner", () => {
    expect(() => buildWriteRequests(structureFromPlainText("Hello\n"), "rev", entryOne)).toThrow(/banner count/);
  });
});
