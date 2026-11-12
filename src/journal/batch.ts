import { assertConsistent, isEmptyDocument, type JournalDocument } from "./structure";
import {
  DIVIDER,
  type JournalEntry,
  type LineKind,
  type MarkedLine,
  countLine,
  documentLines,
  entryLines,
} from "./text";

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface TextStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  fontSize: { magnitude: number; unit: "PT" };
  foregroundColor: { color: { rgbColor: RgbColor } };
  backgroundColor: { color?: { rgbColor: RgbColor } };
  weightedFontFamily: { fontFamily: string; weight: number };
}

export interface ParagraphStyle {
  namedStyleType: "NORMAL_TEXT" | "HEADING_1";
  lineSpacing: number;
  spaceAbove: { magnitude: number; unit: "PT" };
  spaceBelow: { magnitude: number; unit: "PT" };
}

export interface DocRequest {
  insertText?: { location: { index: number }; text: string };
  deleteContentRange?: { range: { startIndex: number; endIndex: number } };
  updateTextStyle?: {
    range: { startIndex: number; endIndex: number };
    textStyle: TextStyle;
    fields: string;
  };
  updateParagraphStyle?: {
    range: { startIndex: number; endIndex: number };
    paragraphStyle: ParagraphStyle;
    fields: string;
  };
}

export interface BatchUpdateBody {
  requests: DocRequest[];
  writeControl: { requiredRevisionId: string };
}

export const TEXT_FIELDS =
  "bold,italic,underline,strikethrough,fontSize,foregroundColor,backgroundColor,weightedFontFamily";
export const PARA_FIELDS = "namedStyleType,lineSpacing,spaceAbove,spaceBelow";

export function hexToRgb(hex: string): RgbColor {
  const value = hex.replace("#", "");
  return {
    red: Number.parseInt(value.slice(0, 2), 16) / 255,
    green: Number.parseInt(value.slice(2, 4), 16) / 255,
    blue: Number.parseInt(value.slice(4, 6), 16) / 255,
  };
}

function textStyle(options: {
  font: string;
  size: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  background?: string;
}): TextStyle {
  const bold = options.bold ?? false;
  return {
    bold,
    italic: options.italic ?? false,
    underline: false,
    strikethrough: false,
    fontSize: { magnitude: options.size, unit: "PT" },
    foregroundColor: { color: { rgbColor: hexToRgb(options.color) } },
    backgroundColor: options.background ? { color: { rgbColor: hexToRgb(options.background) } } : {},
    weightedFontFamily: { fontFamily: options.font, weight: bold ? 700 : 400 },
  };
}

function paragraphStyle(named: "NORMAL_TEXT" | "HEADING_1"): ParagraphStyle {
  return {
    namedStyleType: named,
    lineSpacing: 100,
    spaceAbove: { magnitude: 0, unit: "PT" },
    spaceBelow: { magnitude: 0, unit: "PT" },
  };
}

function stylesFor(kind: LineKind): { text: TextStyle | null; paragraph: ParagraphStyle } {
  const normal = paragraphStyle("NORMAL_TEXT");
  switch (kind) {
    case "kicker":
      return { paragraph: normal, text: textStyle({ font: "Montserrat", size: 9, color: "#1A73E8", bold: true }) };
    case "month":
      return { paragraph: normal, text: textStyle({ font: "Montserrat", size: 34, color: "#202124" }) };
    case "count":
      return { paragraph: normal, text: textStyle({ font: "Lato", size: 10, color: "#5F6368" }) };
    case "divider":
      return { paragraph: normal, text: textStyle({ font: "Arial", size: 11, color: "#DADCE0" }) };
    case "date":
      return { paragraph: normal, text: textStyle({ font: "Arial", size: 9, color: "#1A73E8", bold: true }) };
    case "title":
      return { paragraph: paragraphStyle("HEADING_1"), text: textStyle({ font: "Arial", size: 20, color: "#000000" }) };
    case "mood":
    case "tags":
      return { paragraph: normal, text: textStyle({ font: "Arial", size: 10, color: "#5F6368", italic: true }) };
    case "info":
      return {
        paragraph: normal,
        text: textStyle({ font: "Arial", size: 9, color: "#3C4043", background: "#F1F3F4" }),
      };
    case "blank":
      return { paragraph: normal, text: null };
    case "body":
    case "status":
    case "source":
      return { paragraph: normal, text: textStyle({ font: "Arial", size: 11, color: "#000000" }) };
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown line kind ${exhaustive}`);
    }
  }
}

interface Layout {
  kind: LineKind;
  textStart: number;
  textEnd: number;
  paraEnd: number;
}

function layouts(insertText: string, insertIndex: number, lines: MarkedLine[], skipLeadingNewline: boolean): Layout[] {
  let text = insertText;
  let index = insertIndex;
  if (skipLeadingNewline) {
    if (!text.startsWith("\n")) throw new Error("Expected a leading newline before the appended entry");
    text = text.slice(1);
    index += 1;
  }
  const parts = text.split("\n");
  if (parts.length !== lines.length) {
    throw new Error(`Insert has ${parts.length} paragraphs but ${lines.length} were described`);
  }
  const out: Layout[] = [];
  let cursor = index;
  for (let i = 0; i < parts.length; i += 1) {
    if (parts[i] !== lines[i].text) throw new Error(`Paragraph ${i} does not match the journal text`);
    const textStart = cursor;
    const textEnd = cursor + parts[i].length;
    const paraEnd = textEnd + 1;
    out.push({ kind: lines[i].kind, textStart, textEnd, paraEnd });
    cursor = paraEnd;
  }
  return out;
}

function styleRequests(items: Layout[], segmentEnd: number): DocRequest[] {
  const requests: DocRequest[] = [];
  for (const item of items) {
    const styles = stylesFor(item.kind);
    // A range that includes the segment's final newline is rejected by the Docs API.
    const paraEnd = Math.min(item.paraEnd, segmentEnd - 1);
    if (paraEnd > item.textStart) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: item.textStart, endIndex: paraEnd },
          paragraphStyle: styles.paragraph,
          fields: PARA_FIELDS,
        },
      });
    }
    if (item.textEnd > item.textStart && styles.text) {
      requests.push({
        updateTextStyle: {
          range: { startIndex: item.textStart, endIndex: item.textEnd },
          textStyle: styles.text,
          fields: TEXT_FIELDS,
        },
      });
    }
  }
  return requests;
}

export function findCount(doc: JournalDocument): { start: number; text: string; count: number } {
  const paragraph = doc.paragraphs[2];
  if (!paragraph || paragraph.text !== paragraph.plain) throw new Error("banner count line not found");
  const match = paragraph.plain.match(/^(\d+) (?:entry|entries) {2}\u00b7 {2}Journal: Personal$/);
  if (!match) throw new Error("banner count line not found");
  return { start: paragraph.startIndex, text: paragraph.plain, count: Number(match[1]) };
}

function withLock(requests: DocRequest[], revisionId: string): BatchUpdateBody {
  return { requests, writeControl: { requiredRevisionId: revisionId } };
}

export function buildCreateRequests(entry: JournalEntry, revisionId: string): BatchUpdateBody {
  const lines = documentLines([entry]);
  const insertText = lines.map((line) => line.text).join("\n");
  const segmentEnd = insertText.length + 2;
  return withLock(
    [
      { insertText: { location: { index: 1 }, text: insertText } },
      ...styleRequests(layouts(insertText, 1, lines, false), segmentEnd),
    ],
    revisionId,
  );
}

interface AppendPlan {
  index: number;
  insertText: string;
  lines: MarkedLine[];
  skipLeadingNewline: boolean;
}

/**
 * Insert after the last non-empty paragraph, using the body's structural end.
 * A trailing empty paragraph must not become an extra blank line before the divider.
 * A banner with zero entries keeps the blank line under its divider.
 */
export function planAppend(doc: JournalDocument, count: number, entry: JournalEntry): AppendPlan {
  const lastNonEmpty = [...doc.paragraphs].reverse().find((paragraph) => paragraph.text !== "");
  if (!lastNonEmpty) throw new Error("Document has no content to append after");
  const atEnd = lastNonEmpty.endIndex === doc.endIndex;
  const entryOnly = entryLines(entry);
  const joined = entryOnly.map((line) => line.text).join("\n");
  if (count >= 1) {
    const lines: MarkedLine[] = [{ kind: "divider", text: DIVIDER }, { kind: "blank", text: "" }, ...entryOnly];
    return {
      index: atEnd ? doc.endIndex - 1 : lastNonEmpty.endIndex,
      insertText: `${atEnd ? "\n" : ""}${DIVIDER}\n\n${joined}`,
      lines,
      skipLeadingNewline: atEnd,
    };
  }
  if (atEnd) {
    return {
      index: doc.endIndex - 1,
      insertText: `\n\n${joined}`,
      lines: [{ kind: "blank", text: "" }, ...entryOnly],
      skipLeadingNewline: true,
    };
  }
  return {
    index: lastNonEmpty.endIndex,
    insertText: `\n${joined}`,
    lines: entryOnly,
    skipLeadingNewline: true,
  };
}

export function buildAppendRequests(doc: JournalDocument, revisionId: string, entry: JournalEntry): BatchUpdateBody {
  assertConsistent(doc);
  const found = findCount(doc);
  const next = countLine(found.count + 1);
  const delta = next.length - found.text.length;
  const plan = planAppend(doc, found.count, entry);
  const insertAt = plan.index + delta;
  const segmentEnd = doc.endIndex + delta + plan.insertText.length;
  const countLayout: Layout = {
    kind: "count",
    textStart: found.start,
    textEnd: found.start + next.length,
    paraEnd: found.start + next.length + 1,
  };
  return withLock(
    [
      { deleteContentRange: { range: { startIndex: found.start, endIndex: found.start + found.text.length } } },
      { insertText: { location: { index: found.start }, text: next } },
      ...styleRequests([countLayout], doc.endIndex + delta),
      { insertText: { location: { index: insertAt }, text: plan.insertText } },
      ...styleRequests(layouts(plan.insertText, insertAt, plan.lines, plan.skipLeadingNewline), segmentEnd),
    ],
    revisionId,
  );
}

/** Empty docs get a banner plus the entry. Anything else is an append. A doc with no banner is refused. */
export function buildWriteRequests(doc: JournalDocument, revisionId: string, entry: JournalEntry): BatchUpdateBody {
  if (isEmptyDocument(doc)) return buildCreateRequests(entry, revisionId);
  return buildAppendRequests(doc, revisionId, entry);
}
