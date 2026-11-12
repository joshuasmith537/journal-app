import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { config, isConfigured } from "../src/config";
import { DRIVE_SCOPE, authPrompt, pickerParent } from "../src/google/auth";
import { buildAppendRequests, buildCreateRequests } from "../src/journal/batch";
import { cacheWarning, entryAlreadyInDocument, parseJournal } from "../src/journal/parse";
import { readDocsBody, structureFromPlainText, UnreadableDocumentError } from "../src/journal/structure";
import {
  DOC_MIME,
  FOLDER_MIME,
  ensureMonthDoc,
  publishEntry,
  type DriveIO,
} from "../src/journal/sync";
import { formatHashtags, renderBanner, renderDocument, type JournalEntry } from "../src/journal/text";
import { chooseWeather } from "../src/weather";
import { placeCspMeta } from "../src/cspMeta";
import { applyDoc, paragraphRangesStayInside } from "./applyDoc";
import { entryOne, entryTwo } from "./fixtures";

const YEAR_2026 = config.journal.years["2026"].folderId;
const PERSONAL = config.journal.personalFolderId;

describe("structural append index", () => {
  it("inserts at the body endIndex, not the length of text with images removed", () => {
    const plain = structureFromPlainText(renderDocument([entryOne]));
    const withImage = readDocsBody({
      revisionId: "rev",
      body: {
        content: plain.paragraphs.map((paragraph, index) => {
          const shift = index === 0 ? 0 : 1;
          const start = paragraph.startIndex + shift;
          if (index !== 0) {
            return {
              startIndex: start,
              endIndex: paragraph.endIndex + 1,
              paragraph: { elements: [{ startIndex: start, endIndex: paragraph.endIndex + 1, textRun: { content: `${paragraph.text}\n` } }] },
            };
          }
          const imageAt = start + 2;
          return {
            startIndex: start,
            endIndex: paragraph.endIndex + 1,
            paragraph: {
              elements: [
                { startIndex: start, endIndex: imageAt, textRun: { content: paragraph.text.slice(0, 2) } },
                { startIndex: imageAt, endIndex: imageAt + 1, inlineObjectElement: { inlineObjectId: "img" } },
                { startIndex: imageAt + 1, endIndex: paragraph.endIndex + 1, textRun: { content: `${paragraph.text.slice(2)}\n` } },
              ],
            },
          };
        }),
      },
    });
    expect(withImage.endIndex).toBe(plain.endIndex + 1);
    const body = buildAppendRequests(withImage, "rev", entryTwo);
    const insert = body.requests.filter((request) => request.insertText).at(-1);
    const count = body.requests.find((request) => request.deleteContentRange);
    expect(insert?.insertText?.location.index).toBe(withImage.endIndex - 1 + ("2 entries".length - "1 entry".length));
    expect(insert?.insertText?.location.index).not.toBe(withImage.text.length + ("2 entries".length - "1 entry".length));
    expect(count?.deleteContentRange?.range.startIndex).toBe(withImage.paragraphs[2].startIndex);
    const aligned = `${" ".repeat(withImage.endIndex - 1)}`;
    paragraphRangesStayInside(body.requests, aligned);
    const flatStart = withImage.text.split("\n").reduce((offset, line, index) => (index < 2 ? offset + line.length + 1 : offset), 1);
    expect(count?.deleteContentRange?.range.startIndex).not.toBe(flatStart);
  });

  it("refuses a paragraph whose indexes do not match its text", () => {
    expect(() =>
      readDocsBody({
        body: {
          content: [
            {
              startIndex: 1,
              endIndex: 20,
              paragraph: { elements: [{ startIndex: 1, endIndex: 4, textRun: { content: "Hi\n" } }] },
            },
          ],
        },
      }),
    ).toThrow(UnreadableDocumentError);
  });
});

describe("trailing blank paragraph", () => {
  it("does not add an extra blank line before the divider", () => {
    const trailing = `${renderDocument([entryOne])}\n`;
    const applied = applyDoc(buildAppendRequests(structureFromPlainText(trailing), "rev", entryTwo).requests, trailing);
    expect(applied.text).toBe(renderDocument([entryOne, entryTwo]));
    expect(applied.text).not.toContain("journal-app\n\n\u2501");
  });

  it("keeps the blank line under a zero-entry banner", () => {
    const banner = renderBanner(entryOne.at, 0);
    const applied = applyDoc(buildAppendRequests(structureFromPlainText(banner), "rev", entryOne).requests, banner);
    expect(applied.text).toBe(renderDocument([entryOne]));
    expect(applied.text).toContain(`${"\u2501".repeat(30)}\n\nTUESDAY`);
  });
});

describe("tolerant parser", () => {
  it("reads AM/PM and CT times and skips an unreadable entry", () => {
    const good = renderDocument([entryOne, entryTwo]);
    const variant = good
      .replace("TUESDAY, NOVEMBER 10, 2026 \u00b7 08:16", "TUESDAY, NOVEMBER 10, 2026 \u00b7 8:16 AM CT")
      .replace(
        "TUESDAY, NOVEMBER 10, 2026 \u00b7 10:00\nPlaceholder Follow-up  \u{1F642}",
        "NOT A DATE LINE\nPlaceholder Follow-up  \u{1F642}",
      );
    const parsed = parseJournal(variant);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
    expect(parsed.entries[0].title).toBe("Placeholder Title");
    expect(parsed.entries[0].at.toISOString()).toBe("2026-11-10T14:16:00.000Z");
  });

  it("does not describe a stale copy as a silent success", () => {
    expect(cacheWarning(1, 0)).toMatch(/saved copy/i);
    expect(cacheWarning(0, 2)).toMatch(/could not be read/i);
    expect(cacheWarning(0, 0)).toBeNull();
  });
});

describe("lost batchUpdate response", () => {
  it("does not append again when the date, title, and source line are already there", async () => {
    let text = renderDocument([entryOne]);
    let writes = 0;
    const drive: DriveIO = {
      async getFile() {
        return { id: "doc", name: "Personal Journal \u2013 November 2026", mimeType: DOC_MIME };
      },
      async listChildren() {
        return [];
      },
      async createFolder() {
        throw new Error("no");
      },
      async createDoc() {
        throw new Error("no");
      },
      async getDocument() {
        return structureFromPlainText(text, "rev");
      },
      async batchUpdate(_id, body) {
        writes += 1;
        text = applyDoc(body.requests, text).text;
        throw new Error("response lost");
      },
    };
    await expect(publishEntry(drive, entryTwo)).rejects.toThrow(/response lost/);
    expect(writes).toBe(1);
    expect(entryAlreadyInDocument(text, entryTwo)).toBe(true);
    await publishEntry(drive, entryTwo);
    expect(writes).toBe(1);
  });
});

describe("new month creation", () => {
  it("names every folder and doc it would create and does not create them first", async () => {
    const created: string[] = [];
    const drive = memoryDrive(created);
    const at = new Date("2027-01-15T18:00:00.000Z");
    const pending = await ensureMonthDoc(drive, at);
    expect(pending).toMatchObject({ ok: false, code: "pick-then-create", parentId: PERSONAL, parentName: "Personal" });
    if (pending.ok || pending.code !== "pick-then-create") throw new Error("expected a plan");
    expect(pending.summary).toContain("Folder “2027” inside Personal");
    expect(pending.summary).toContain("Folder “01 - January” inside 2027");
    expect(pending.summary).toContain("Doc “Personal Journal \u2013 January 2027” inside 01 - January");
    expect(created).toEqual([]);
    const made = await ensureMonthDoc(drive, at, { allowCreate: true });
    expect(made.ok).toBe(true);
    expect(created).toEqual(["2027", "01 - January", "Personal Journal \u2013 January 2027"]);
  });

  it("does not aim the picker at an Accountability location", () => {
    expect(pickerParent("abc", "Accountability Journal")).toBeUndefined();
    expect(pickerParent("abc", "Personal")).toBe("abc");
    expect(pickerParent(YEAR_2026, "2026")).toBe(YEAR_2026);
  });
});

describe("live journal text", () => {
  it("parses the legacy October status line and never writes it", () => {
    const doc = renderDocument([entryOne]).replace(
      "Journal: November 2026 \u00b7 Published",
      "Imported from Journal: October 2026 \u00b7 Published",
    );
    const parsed = parseJournal(doc);
    expect(parsed.skipped).toBe(0);
    expect(parsed.entries[0].status).toBe("Published");
    expect(renderDocument(parsed.entries)).not.toContain("Imported from");
    expect(renderDocument(parsed.entries)).toContain("Journal: November 2026 \u00b7 Published");
  });

  it("reads a caption hyperlink without using text length as the append index", () => {
    const plain = structureFromPlainText(renderDocument([entryOne]));
    const last = plain.paragraphs[plain.paragraphs.length - 1];
    const doc = readDocsBody({
      revisionId: "rev",
      body: {
        content: [
          ...plain.paragraphs.slice(0, -1).map((paragraph) => ({
            startIndex: paragraph.startIndex,
            endIndex: paragraph.endIndex,
            paragraph: {
              elements: [{ startIndex: paragraph.startIndex, endIndex: paragraph.endIndex, textRun: { content: `${paragraph.text}\n` } }],
            },
          })),
          {
            startIndex: last.startIndex,
            endIndex: last.endIndex,
            paragraph: {
              elements: [
                {
                  startIndex: last.startIndex,
                  endIndex: last.endIndex,
                  textRun: { content: `${last.text}\n`, textStyle: { link: { url: "https://example.com" }, fontSize: { magnitude: 9, unit: "PT" } } },
                },
              ],
            },
          },
        ],
      },
    });
    const request = buildAppendRequests(doc, "rev", entryTwo).requests.filter((item) => item.insertText).at(-1);
    expect(request?.insertText?.location.index).toBe(doc.endIndex - 1 + ("2 entries".length - "1 entry".length));
  });
});

describe("smaller review fixes", () => {
  it("uses a referrer policy the Picker API key can see", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('content="strict-origin-when-cross-origin"');
    expect(html).not.toContain("no-referrer");
    const pagesReferrer = `${new URL("https://joshuasmith537.github.io/journal-app/").origin}/`;
    const localhostReferrer = `${new URL("http://localhost:5173/journal-app/").origin}/`;
    expect(pagesReferrer.startsWith("https://joshuasmith537.github.io/")).toBe(true);
    expect(localhostReferrer.startsWith("http://localhost:5173/")).toBe(true);
  });

  it("ships the public Google client identifiers and drive.file only", () => {
    expect(isConfigured()).toBe(true);
    expect(config.googleClientId).toBe("677493523826-8f57ce9pfmibj2p8l08jg1f0mbt01bpq.apps.googleusercontent.com");
    expect(config.googlePickerApiKey).toBe("AIzaSyDQv6CHB1Iyxa2yCXFNQDQPWGj-RUih8T8");
    expect(config.googleCloudProjectNumber).toBe("677493523826");
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });

  it("places the CSP meta before scripts and styles", () => {
    const html = placeCspMeta('<head>\n    <script src="/app.js"></script>\n    <link rel="stylesheet" href="/app.css">\n  </head>', "default-src 'self'");
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("<script"));
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("stylesheet"));
  });

  it("restricts pages deployment permissions to the deploy job", () => {
    const workflow = readFileSync(".github/workflows/pages.yml", "utf8");
    const build = workflow.split("deploy:")[0];
    const deploy = workflow.split("deploy:")[1];
    expect(build).not.toContain("pages: write");
    expect(build).not.toContain("id-token: write");
    expect(deploy).toContain("pages: write");
    expect(deploy).toContain("id-token: write");
  });

  it("asks for consent only before the first grant", () => {
    expect(authPrompt(false)).toBe("consent");
    expect(authPrompt(true)).toBe("");
  });

  it("uses fresh weather when online and the previous value when not", () => {
    expect(chooseWeather(true, "\u2600\ufe0f 70\u00b0F, clear", "\u2601\ufe0f 40\u00b0F, overcast")).toMatch(/70/);
    expect(chooseWeather(false, null, "\u2601\ufe0f 40\u00b0F, overcast")).toMatch(/40/);
    expect(chooseWeather(true, null, "\u2601\ufe0f 40\u00b0F, overcast")).toMatch(/40/);
  });

  it("omits an empty mood line and a leading separator on topic-only tags", () => {
    const entry: JournalEntry = { ...entryOne, moodWords: "   ", moodTags: [], topicTags: ["topic-a"] };
    const lines = renderDocument([entry]);
    expect(lines).not.toContain("Mood:");
    expect(lines).toContain("#topic-a");
    expect(lines).not.toContain("  \u00b7  #topic-a");
    expect(formatHashtags([], ["topic-a"])).toBe("#topic-a");
    expect(parseJournal(lines).entries[0].moodWords).toBe("");
  });

  it("keeps paragraph styles off the final newline of a created doc", () => {
    paragraphRangesStayInside(buildCreateRequests(entryOne, "rev").requests);
  });
});

function memoryDrive(created: string[]): DriveIO {
  const files = new Map<string, { id: string; name: string; mimeType: string; parent?: string }>([
    [PERSONAL, { id: PERSONAL, name: "Personal", mimeType: FOLDER_MIME }],
    [YEAR_2026, { id: YEAR_2026, name: "2026", mimeType: FOLDER_MIME, parent: PERSONAL }],
  ]);
  return {
    async getFile(id) {
      const file = files.get(id);
      return file ? { id: file.id, name: file.name, mimeType: file.mimeType } : null;
    },
    async listChildren(parentId) {
      return [...files.values()]
        .filter((file) => file.parent === parentId)
        .map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType }));
    },
    async createFolder(name, parentId) {
      created.push(name);
      const id = `folder-${created.length}`;
      files.set(id, { id, name, mimeType: FOLDER_MIME, parent: parentId });
      return { id, name, mimeType: FOLDER_MIME };
    },
    async createDoc(name, parentId) {
      created.push(name);
      const id = `doc-${created.length}`;
      files.set(id, { id, name, mimeType: DOC_MIME, parent: parentId });
      return { id, name, mimeType: DOC_MIME };
    },
    async getDocument() {
      return structureFromPlainText("\n", "rev");
    },
    async batchUpdate() {
      throw new Error("not used");
    },
  };
}
