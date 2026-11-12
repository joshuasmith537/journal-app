import {
  DIVIDER,
  DOT,
  MOODS,
  NARROW,
  SOURCE_LINE,
  WIDE,
  type JournalEntry,
  type Mood,
  chicagoLocalToDate,
  formatDateLine,
} from "./text";

const MONTH_INDEX: Record<string, number> = {
  JANUARY: 1,
  FEBRUARY: 2,
  MARCH: 3,
  APRIL: 4,
  MAY: 5,
  JUNE: 6,
  JULY: 7,
  AUGUST: 8,
  SEPTEMBER: 9,
  OCTOBER: 10,
  NOVEMBER: 11,
  DECEMBER: 12,
};

const DATE_RE = /^([A-Za-z]+), ([A-Za-z]+) (\d{1,2}), (\d{4})\s+\u00b7\s+(.+)$/;
const COUNT_RE = /^(\d+) (entry|entries) {2}\u00b7 {2}Journal: Personal$/;
const STATUS_RE = new RegExp(`^(?:Imported from )?Journal: (.+)${escapeRegExp(NARROW)}(Published|Draft)$`);
const TITLE_RE = new RegExp(`^(.*)  (${MOODS.join("|")})$`, "u");

export interface ParsedJournal {
  count: number;
  month: string;
  entries: JournalEntry[];
  /** Entries whose shape or time could not be read. The rest of the doc is kept. */
  skipped: number;
}

export function parseJournal(documentText: string): ParsedJournal {
  const normalized = documentText.replace(/\r\n/g, "\n");
  const stripped = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = stripped.split("\n");
  if (lines.length < 5) throw new Error("Journal document is missing its banner");
  const countMatch = lines[2].match(COUNT_RE);
  if (!countMatch) throw new Error("banner count line not found");
  if (lines[3] !== DIVIDER) throw new Error("Journal banner divider is missing");
  const entries: JournalEntry[] = [];
  let skipped = 0;
  for (const block of splitEntries(lines.slice(5))) {
    const parsed = tryParseBlock(block);
    if (parsed) entries.push(parsed);
    else if (block.some((line) => line.trim() !== "")) skipped += 1;
  }
  return { count: Number(countMatch[1]), month: lines[1], entries, skipped };
}

export function entryAlreadyInDocument(text: string, entry: JournalEntry): boolean {
  const date = formatDateLine(entry.at);
  const title = `${entry.title}  ${entry.mood}`;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== date) continue;
    let end = lines.length;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (DATE_RE.test(lines[next])) {
        end = next;
        break;
      }
    }
    const block = lines.slice(index, end);
    if (block.includes(title) && block.includes(SOURCE_LINE)) return true;
  }
  return false;
}

export function cacheWarning(staleDocs: number, skippedEntries: number): string | null {
  const parts: string[] = [];
  if (staleDocs > 0) parts.push("Couldn't refresh a journal doc. Showing the saved copy.");
  if (skippedEntries > 0) parts.push("Some entries in a journal doc could not be read.");
  return parts.length ? parts.join(" ") : null;
}

export function documentBodyToText(doc: {
  body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> } }> };
}): string {
  let text = "";
  for (const block of doc.body?.content ?? []) {
    for (const element of block.paragraph?.elements ?? []) {
      if (element.textRun?.content) text += element.textRun.content;
    }
  }
  return text;
}

function splitEntries(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index] === DIVIDER && current.length > 0) {
      blocks.push(current);
      current = [];
      continue;
    }
    if (lines[index] === DIVIDER && current.length === 0) {
      index += 1;
      if (lines[index] === "") index += 1;
      continue;
    }
    current.push(lines[index]);
    index += 1;
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function tryParseBlock(input: string[]): JournalEntry | null {
  const lines = [...input];
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.at(-1) === SOURCE_LINE) lines.pop();
  const statusLine = lines.pop();
  const statusMatch = statusLine?.match(STATUS_RE);
  if (!statusMatch) return null;
  let moodTags: string[] = [];
  let topicTags: string[] = [];
  const maybeTags = lines.at(-1) ?? "";
  const hadTags = maybeTags.startsWith("#") || maybeTags.startsWith(`  ${DOT}`);
  if (hadTags) {
    const parsed = parseTags(lines.pop() ?? "");
    moodTags = parsed.moodTags;
    topicTags = parsed.topicTags;
  }
  const dateLine = lines[0];
  const titleLine = lines[1];
  if (!dateLine || !titleLine) return null;
  const titleMatch = titleLine.match(TITLE_RE);
  const clock = parseClock(dateLine);
  if (!titleMatch || !clock) return null;
  let moodWords = "";
  let infoLine: string | undefined;
  let blank: string | undefined;
  let bodyLines: string[] = [];
  if (lines[2]?.startsWith("Mood:")) {
    moodWords = lines[2].slice("Mood:".length).trim();
    infoLine = lines[3];
    blank = lines[4];
    bodyLines = lines.slice(5);
  } else {
    infoLine = lines[2];
    blank = lines[3];
    bodyLines = lines.slice(4);
  }
  if (infoLine === undefined || blank !== "") return null;
  if (hadTags && bodyLines.at(-1) === "") bodyLines.pop();
  const info = tryParseInfo(infoLine);
  if (!info) return null;
  return {
    at: clock,
    title: titleMatch[1],
    mood: titleMatch[2] as Mood,
    moodWords,
    place: info.place,
    weather: info.weather,
    body: bodyLines.join("\n"),
    moodTags,
    topicTags,
    status: statusMatch[2] as JournalEntry["status"],
  };
}

function parseClock(line: string): Date | null {
  const match = line.match(DATE_RE);
  if (!match) return null;
  const month = MONTH_INDEX[match[2].toUpperCase()];
  const time = match[5].trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?(?:\s*(?:CT|CST|CDT))?$/i);
  if (!month || !time) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2]);
  if (minute > 59 || hour > 23) return null;
  const ampm = time[3]?.toUpperCase();
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === "PM" && hour !== 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
  }
  return chicagoLocalToDate(Number(match[4]), month, Number(match[3]), hour, minute);
}

function tryParseInfo(line: string): { place: string; weather: string | null } | null {
  const parts = line.split(WIDE);
  if (parts.length !== 3 || !parts[1].startsWith("\u{1F4CD} ")) return null;
  const weather = parts[2] === "\u2014" ? null : parts[2];
  return { place: parts[1].slice("\u{1F4CD} ".length), weather };
}

function parseTags(line: string): { moodTags: string[]; topicTags: string[] } {
  if (line.includes(WIDE)) {
    const [mood, topic] = line.split(WIDE);
    return { moodTags: tagNames(mood), topicTags: tagNames(topic) };
  }
  return { moodTags: tagNames(line), topicTags: [] };
}

function tagNames(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.replace(/^#+/, ""))
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
