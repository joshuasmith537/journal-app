import { describe, expect, it } from "vitest";
import { documentBodyToText, parseJournal } from "../src/journal/parse";
import { KICKER, renderDocument } from "../src/journal/text";
import { entryOne, entryTwo } from "./fixtures";

describe("journal parser", () => {
  it("round-trips the spec template text", () => {
    const template = renderDocument([entryOne]);
    expect(template.startsWith(`${KICKER}\nNovember 2026\n1 entry`)).toBe(true);
    expect(template.endsWith("Source: journal-app\n")).toBe(true);
    expect(template.includes("\u2501".repeat(30))).toBe(true);
    const parsed = parseJournal(template);
    expect(parsed.count).toBe(1);
    expect(parsed.month).toBe("November 2026");
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].title).toBe("Placeholder Title");
    expect(parsed.entries[0].mood).toBe("😐");
    expect(parsed.entries[0].moodWords).toBe("calm, focused");
    expect(parsed.entries[0].place).toBe("Chicago, IL");
    expect(parsed.entries[0].weather).toBe(entryOne.weather);
    expect(parsed.entries[0].body).toBe(entryOne.body);
    expect(parsed.entries[0].moodTags).toEqual(["calm", "focused"]);
    expect(parsed.entries[0].topicTags).toEqual(["placeholder"]);
    expect(parsed.entries[0].status).toBe("Published");
    expect(renderDocument(parsed.entries)).toBe(template);
  });

  it("round-trips two entries and still parses a bot entry without a source line", () => {
    const template = renderDocument([entryOne, entryTwo]);
    const parsed = parseJournal(template);
    expect(parsed.count).toBe(2);
    expect(renderDocument(parsed.entries)).toBe(template);

    const bot = template.replace("\nSource: journal-app\n", "\n");
    const withoutSource = parseJournal(bot.endsWith("\n") ? bot : `${bot}\n`);
    expect(withoutSource.entries[0].title).toBe("Placeholder Title");
    expect(withoutSource.entries[0].status).toBe("Published");
  });

  it("reads Docs API text runs in order", () => {
    expect(
      documentBodyToText({
        body: {
          content: [
            { paragraph: { elements: [{ textRun: { content: "Hello" } }, { textRun: { content: "\n" } }] } },
          ],
        },
      }),
    ).toBe("Hello\n");
  });
});
