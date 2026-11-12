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

const DATE_RE = new RegExp(`^([A-Z]+), ([A-Z]+) (\\d{1,2}), (\\d{4})${escapeRegExp(NARROW)}(\\d{2}):(\\d{2})$`);
const COUNT_RE = /^(\d+) (entry|entries) {2}\u00b7 {2}Journal: Personal$/;
const STATUS_RE = new RegExp(`^Journal: (.+)${escapeRegExp(NARROW)}(Published|Draft)$`);
const TITLE_RE = new RegExp(`^(.*)  (${MOODS.join("|")})$`, "u");

export interface ParsedJournal {
  count: number;
  month: string;
  entries: JournalEntry[];
}

export function parseJournal(documentText: string): ParsedJournal {
  const normalized = documentText.replace(/\r\n/g, "\n");
  const stripped = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = stripped.split("\n");
  if (lines.length < 5) throw new Error("Journal document is missing its banner");
  const countMatch = lines[2].match(COUNT_RE);
  if (!countMatch) throw new Error("banner count line not found");
  if (lines[3] !== DIVIDER) throw new Error("Journal banner divider is missing");
  const entries = splitEntries(lines.slice(5)).map(parseBlock);
  return { count: Number(countMatch[1]), month: lines[1], entries };
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

function parseBlock(input: string[]): JournalEntry {
  const lines = [...input];
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.at(-1) === SOURCE_LINE) lines.pop();
  const statusLine = lines.pop();
  const statusMatch = statusLine?.match(STATUS_RE);
  if (!statusMatch) throw new Error("Journal entry is missing its status line");
  let moodTags: string[] = [];
  let topicTags: string[] = [];
  const maybeTags = lines.at(-1) ?? "";
  if (maybeTags.startsWith("#") || maybeTags.startsWith(`  ${DOT}`)) {
    const parsed = parseTags(lines.pop() ?? "");
    moodTags = parsed.moodTags;
    topicTags = parsed.topicTags;
  }
  const [dateLine, titleLine, moodLine, infoLine, blank, ...bodyLines] = lines;
  if (!dateLine || !DATE_RE.test(dateLine)) throw new Error("Journal entry is missing its date line");
  const titleMatch = titleLine?.match(TITLE_RE);
  if (!titleMatch) throw new Error("Journal entry is missing its title");
  const moodMatch = moodLine?.match(/^Mood: (.*)$/);
  if (!moodMatch || infoLine === undefined || blank !== "") throw new Error("Journal entry shape does not match the journal format");
  const info = parseInfo(infoLine);
  const date = parseDateLine(dateLine);
  const body = bodyLines.join("\n");
  const entry: JournalEntry = {
    at: date,
    title: titleMatch[1],
    mood: titleMatch[2] as Mood,
    moodWords: moodMatch[1].trim(),
    place: info.place,
    weather: info.weather,
    body,
    moodTags,
    topicTags,
    status: statusMatch[2] as JournalEntry["status"],
  };
  if (formatDateLine(entry.at) !== dateLine) throw new Error("Journal date line could not be read in America/Chicago");
  return entry;
}

function parseDateLine(line: string): Date {
  const match = line.match(DATE_RE);
  if (!match) throw new Error("Journal date line could not be read");
  const month = MONTH_INDEX[match[2]];
  if (!month) throw new Error("Journal date line has an unknown month");
  return chicagoLocalToDate(Number(match[4]), month, Number(match[3]), Number(match[5]), Number(match[6]));
}

function parseInfo(line: string): { place: string; weather: string | null } {
  const parts = line.split(WIDE);
  if (parts.length !== 3 || !parts[1].startsWith("\u{1F4CD} ")) {
    throw new Error("Journal info line could not be read");
  }
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
