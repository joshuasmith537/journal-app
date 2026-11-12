export const DOT = "\u00b7";
export const WIDE = `  ${DOT}  `;
export const NARROW = ` ${DOT} `;
export const EN_DASH = "\u2013";
export const DIVIDER = "\u2501".repeat(30);
export const KICKER = `${"PERSONAL".split("").join(" ")}   ${"JOURNAL".split("").join(" ")}`;
export const SOURCE_LINE = "Source: journal-app";
export const MOODS = ["😞", "😕", "😐", "🙂", "😄"] as const;
export type Mood = (typeof MOODS)[number];

export type EntryStatus = "Published" | "Draft";

export interface JournalEntry {
  at: Date;
  title: string;
  mood: Mood;
  moodWords: string;
  place: string;
  /** Formatted `☀️ 48°F, clear`, or null when weather was unavailable. */
  weather: string | null;
  /** Verbatim body. Blank lines separate paragraphs. */
  body: string;
  moodTags: string[];
  topicTags: string[];
  status: EntryStatus;
}

export interface ChicagoParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  monthName: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const CLOCKS: ReadonlyArray<readonly [string, string]> = [
  ["🕛", "🕧"],
  ["🕐", "🕜"],
  ["🕑", "🕝"],
  ["🕒", "🕞"],
  ["🕓", "🕟"],
  ["🕔", "🕠"],
  ["🕕", "🕡"],
  ["🕖", "🕢"],
  ["🕗", "🕣"],
  ["🕘", "🕤"],
  ["🕙", "🕥"],
  ["🕚", "🕦"],
];

export function chicagoParts(at: Date): ChicagoParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of dtf.formatToParts(at)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const monthName = bag.month;
  const month = MONTHS.indexOf(monthName as (typeof MONTHS)[number]) + 1;
  if (!monthName || month < 1) throw new Error("Could not read the Chicago calendar date");
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month,
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    weekday: bag.weekday,
    monthName,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function monthLabel(at: Date): string {
  const parts = chicagoParts(at);
  return `${parts.monthName} ${parts.year}`;
}

export function yearFolderName(at: Date): string {
  return String(chicagoParts(at).year);
}

export function monthFolderName(at: Date): string {
  const parts = chicagoParts(at);
  return `${pad(parts.month)} - ${parts.monthName}`;
}

export function docTitle(at: Date): string {
  const parts = chicagoParts(at);
  return `Personal Journal ${EN_DASH} ${parts.monthName} ${parts.year}`;
}

export function formatDateLine(at: Date): string {
  const parts = chicagoParts(at);
  return `${parts.weekday.toUpperCase()}, ${parts.monthName.toUpperCase()} ${parts.day}, ${parts.year}${NARROW}${pad(parts.hour)}:${pad(parts.minute)}`;
}

/** Nearest half-hour clock face. A tie (minute 15 or 45) rounds forward. */
export function clockEmoji(hour: number, minute: number): string {
  const total = hour * 60 + minute;
  const rounded = Math.round(total / 30) * 30;
  const normalized = ((rounded % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60) % 24;
  const half = normalized % 60 === 30;
  return CLOCKS[hour24 % 12][half ? 1 : 0];
}

export function formatInfoLine(at: Date, place: string, weather: string | null): string {
  const parts = chicagoParts(at);
  const time = `${pad(parts.hour)}:${pad(parts.minute)}`;
  const sky = weather ?? "\u2014";
  return `${clockEmoji(parts.hour, parts.minute)} ${time}${WIDE}\u{1F4CD} ${place}${WIDE}${sky}`;
}

const WMO: Record<number, { emoji: string; summary: string }> = {
  0: { emoji: "\u2600\ufe0f", summary: "clear" },
  1: { emoji: "\u{1F324}\ufe0f", summary: "mainly clear" },
  2: { emoji: "\u26c5", summary: "partly cloudy" },
  3: { emoji: "\u2601\ufe0f", summary: "overcast" },
  45: { emoji: "\u{1F32B}\ufe0f", summary: "fog" },
  48: { emoji: "\u{1F32B}\ufe0f", summary: "fog" },
  51: { emoji: "\u{1F326}\ufe0f", summary: "drizzle" },
  53: { emoji: "\u{1F326}\ufe0f", summary: "drizzle" },
  55: { emoji: "\u{1F326}\ufe0f", summary: "drizzle" },
  56: { emoji: "\u{1F327}\ufe0f", summary: "freezing drizzle" },
  57: { emoji: "\u{1F327}\ufe0f", summary: "freezing drizzle" },
  61: { emoji: "\u{1F327}\ufe0f", summary: "rain" },
  63: { emoji: "\u{1F327}\ufe0f", summary: "rain" },
  65: { emoji: "\u{1F327}\ufe0f", summary: "rain" },
  66: { emoji: "\u{1F327}\ufe0f", summary: "freezing rain" },
  67: { emoji: "\u{1F327}\ufe0f", summary: "freezing rain" },
  71: { emoji: "\u{1F328}\ufe0f", summary: "snow" },
  73: { emoji: "\u{1F328}\ufe0f", summary: "snow" },
  75: { emoji: "\u{1F328}\ufe0f", summary: "snow" },
  77: { emoji: "\u{1F328}\ufe0f", summary: "snow" },
  80: { emoji: "\u{1F326}\ufe0f", summary: "showers" },
  81: { emoji: "\u{1F326}\ufe0f", summary: "showers" },
  82: { emoji: "\u{1F326}\ufe0f", summary: "showers" },
  85: { emoji: "\u{1F328}\ufe0f", summary: "snow showers" },
  86: { emoji: "\u{1F328}\ufe0f", summary: "snow showers" },
  95: { emoji: "\u26c8\ufe0f", summary: "thunderstorm" },
  96: { emoji: "\u26c8\ufe0f", summary: "thunderstorm" },
  99: { emoji: "\u26c8\ufe0f", summary: "thunderstorm" },
};

export function formatWeather(code: number, tempF: number): string {
  let rounded = Math.round(tempF);
  if (Object.is(rounded, -0)) rounded = 0;
  const mapped = WMO[code] ?? { emoji: "\u{1F321}\ufe0f", summary: "unknown" };
  return `${mapped.emoji} ${rounded}\u00b0F, ${mapped.summary}`;
}

export function countLine(count: number): string {
  const word = count === 1 ? "entry" : "entries";
  return `${count} ${word}${WIDE}Journal: Personal`;
}

export function incrementCountLine(line: string): string {
  const match = line.match(/^(\d+) (?:entry|entries) {2}\u00b7 {2}Journal: Personal$/);
  if (!match) throw new Error("banner count line not found");
  return countLine(Number(match[1]) + 1);
}

export function normalizeTag(raw: string): string {
  const cleaned = raw.trim().replace(/^#+/, "").replace(/\s+/g, "-");
  return cleaned ? `#${cleaned}` : "";
}

export function formatHashtags(moodTags: string[], topicTags: string[]): string | null {
  const mood = moodTags.map(normalizeTag).filter(Boolean).join(" ");
  const topic = topicTags.map(normalizeTag).filter(Boolean).join(" ");
  if (mood && topic) return `${mood}${WIDE}${topic}`;
  if (mood) return mood;
  if (topic) return topic;
  return null;
}

export type LineKind =
  | "kicker"
  | "month"
  | "count"
  | "bannerDivider"
  | "bannerBlank"
  | "divider"
  | "blank"
  | "date"
  | "title"
  | "mood"
  | "info"
  | "body"
  | "tags"
  | "status"
  | "source";

export interface MarkedLine {
  kind: LineKind;
  text: string;
}

export function entryLines(entry: JournalEntry): MarkedLine[] {
  const lines: MarkedLine[] = [
    { kind: "date", text: formatDateLine(entry.at) },
    { kind: "title", text: `${entry.title}  ${entry.mood}` },
    ...(entry.moodWords.trim() ? [{ kind: "mood" as const, text: `Mood: ${entry.moodWords.trim()}` }] : []),
    { kind: "info", text: formatInfoLine(entry.at, entry.place, entry.weather) },
    { kind: "blank", text: "" },
  ];
  const body = entry.body.replace(/\n+$/, "");
  if (body.length) {
    for (const line of body.split("\n")) {
      lines.push({ kind: line === "" ? "blank" : "body", text: line });
    }
  }
  const tags = formatHashtags(entry.moodTags, entry.topicTags);
  if (tags) lines.push({ kind: "tags", text: tags });
  lines.push({ kind: "status", text: `Journal: ${monthLabel(entry.at)}${NARROW}${entry.status}` });
  lines.push({ kind: "source", text: SOURCE_LINE });
  return lines;
}

export function documentLines(entries: JournalEntry[]): MarkedLine[] {
  if (entries.length === 0) throw new Error("A journal document needs at least one entry");
  const lines: MarkedLine[] = [
    { kind: "kicker", text: KICKER },
    { kind: "month", text: monthLabel(entries[0].at) },
    { kind: "count", text: countLine(entries.length) },
    { kind: "bannerDivider", text: DIVIDER },
    { kind: "bannerBlank", text: "" },
  ];
  entries.forEach((entry, index) => {
    if (index > 0) lines.push({ kind: "divider", text: DIVIDER }, { kind: "blank", text: "" });
    lines.push(...entryLines(entry));
  });
  return lines;
}

export function renderDocument(entries: JournalEntry[]): string {
  return `${documentLines(entries).map((line) => line.text).join("\n")}\n`;
}

/** Banner only, including the blank line after the divider. Count may be 0. */
export function renderBanner(at: Date, count: number): string {
  return `${[KICKER, monthLabel(at), countLine(count), DIVIDER, ""].join("\n")}\n`;
}

export function entryIdentity(at: Date, title: string): string {
  const parts = chicagoParts(at);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}${pad(parts.minute)} ${EN_DASH} ${title}`;
}

function zoneOffset(date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    Number(bag.year),
    Number(bag.month) - 1,
    Number(bag.day),
    hour,
    Number(bag.minute),
    Number(bag.second),
  );
  return asUtc - date.getTime();
}

export function chicagoLocalToDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const utc = guess - zoneOffset(new Date(guess - zoneOffset(new Date(guess))));
  return new Date(utc);
}
