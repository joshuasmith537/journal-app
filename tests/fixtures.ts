import type { JournalEntry } from "../src/journal/text";

export const entryOne: JournalEntry = {
  at: new Date("2026-11-10T14:16:00.000Z"),
  title: "Placeholder Title",
  mood: "😐",
  moodWords: "calm, focused",
  place: "Chicago, IL",
  weather: "\u2600\ufe0f 48\u00b0F, clear",
  body: "First placeholder paragraph.\n\nSecond placeholder paragraph.",
  moodTags: ["calm", "focused"],
  topicTags: ["placeholder"],
  status: "Published",
};

export const entryTwo: JournalEntry = {
  at: new Date("2026-11-10T16:00:00.000Z"),
  title: "Placeholder Follow-up",
  mood: "🙂",
  moodWords: "steady",
  place: "Chicago, IL",
  weather: "\u2600\ufe0f 51\u00b0F, clear",
  body: "Another placeholder paragraph.",
  moodTags: ["steady"],
  topicTags: ["placeholder"],
  status: "Published",
};
