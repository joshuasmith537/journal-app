import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { buildWriteRequests, type BatchUpdateBody } from "../src/journal/batch";
import {
  DOC_MIME,
  FOLDER_MIME,
  type DriveFile,
  type DriveIO,
  ensureMonthDoc,
  httpError,
  publishEntry,
  writeWithRevisionLock,
} from "../src/journal/sync";
import { structureFromPlainText } from "../src/journal/structure";
import { docTitle, renderDocument } from "../src/journal/text";
import { applyDoc } from "./applyDoc";
import { entryOne, entryTwo } from "./fixtures";

const NOV_DOC = config.journal.years["2026"].months["11"].docId;
const YEAR_2026 = config.journal.years["2026"].folderId;
const PERSONAL = config.journal.personalFolderId;

function file(id: string, name: string, mimeType: string): DriveFile {
  return { id, name, mimeType };
}

describe("revision lock", () => {
  it("re-reads and retries when the required revision is rejected", async () => {
    let revision = 1;
    let writes = 0;
    const seen: string[] = [];
    const text = renderDocument([entryOne]);
    await writeWithRevisionLock(
      async () => structureFromPlainText(text, `rev-${revision}`),
      async (body) => {
        writes += 1;
        seen.push(body.writeControl.requiredRevisionId);
        if (writes === 1) {
          revision = 2;
          throw httpError(400, "The required revision ID does not match the current revision");
        }
      },
      (doc, revisionId) => buildWriteRequests(doc, revisionId, entryTwo),
    );
    expect(seen).toEqual(["rev-1", "rev-2"]);
    expect(writes).toBe(2);
  });

  it("does not retry a non-revision failure", async () => {
    let reads = 0;
    await expect(
      writeWithRevisionLock(
        async () => {
          reads += 1;
          return structureFromPlainText(renderDocument([entryOne]), "rev-1");
        },
        async () => {
          throw httpError(400, "invalid request");
        },
        (doc, revisionId) => buildWriteRequests(doc, revisionId, entryTwo),
      ),
    ).rejects.toThrow(/invalid request/);
    expect(reads).toBe(1);
  });
});

describe("month doc resolution", () => {
  it("uses the known November doc and never creates another", async () => {
    const created: string[] = [];
    const drive = fake({
      files: [
        file(PERSONAL, "Personal", FOLDER_MIME),
        file(YEAR_2026, "2026", FOLDER_MIME),
        file(NOV_DOC, "Personal Journal \u2013 November 2026", DOC_MIME),
      ],
      onCreate(name) {
        created.push(name);
      },
    });
    const result = await ensureMonthDoc(drive, entryOne.at, { allowCreate: true });
    expect(result).toEqual({ ok: true, docId: NOV_DOC });
    expect(created).toEqual([]);
  });

  it("asks for a grant instead of duplicating a known doc that is not accessible", async () => {
    const created: string[] = [];
    const drive = fake({
      files: [file(PERSONAL, "Personal", FOLDER_MIME), file(YEAR_2026, "2026", FOLDER_MIME)],
      onCreate(name) {
        created.push(name);
      },
    });
    const result = await ensureMonthDoc(drive, entryOne.at, { allowCreate: true });
    expect(result).toMatchObject({ ok: false, code: "grant", target: "doc", id: NOV_DOC });
    expect(created).toEqual([]);
  });

  it("ignores Accountability Journal listings and confirms before creating a new month", async () => {
    const gets: string[] = [];
    const created: Array<{ name: string; parent: string }> = [];
    const drive = fake({
      files: [
        file(PERSONAL, "Personal", FOLDER_MIME),
        file(YEAR_2026, "2026", FOLDER_MIME),
        file("blocked-folder", "Accountability Journal", FOLDER_MIME),
        file("blocked-doc", "Accountability Journal", DOC_MIME),
      ],
      children: {
        [YEAR_2026]: ["blocked-folder", "blocked-doc"],
      },
      onGet(id) {
        gets.push(id);
      },
      onCreate(name, parent) {
        created.push({ name, parent });
      },
    });
    const december = new Date("2026-12-15T18:00:00.000Z");
    const pending = await ensureMonthDoc(drive, december);
    expect(pending).toMatchObject({
      ok: false,
      code: "pick-then-create",
      parentId: YEAR_2026,
      parentName: "2026",
    });
    if (pending.ok || pending.code !== "pick-then-create") throw new Error("expected a create plan");
    expect(pending.summary).toContain("Folder “12 - December” inside 2026");
    expect(pending.summary).toContain(`Doc “${docTitle(december)}” inside 12 - December`);
    expect(pending.summary).not.toContain("Folder “2026”");
    expect(created).toEqual([]);
    expect(gets).not.toContain("blocked-folder");
    expect(gets).not.toContain("blocked-doc");

    const createdDrive = fake({
      files: [file(PERSONAL, "Personal", FOLDER_MIME), file(YEAR_2026, "2026", FOLDER_MIME)],
      children: { [YEAR_2026]: [] },
      onCreate(name, parent) {
        created.push({ name, parent });
      },
    });
    const made = await ensureMonthDoc(createdDrive, december, { allowCreate: true });
    expect(made.ok).toBe(true);
    expect(created).toContainEqual({ name: "12 - December", parent: YEAR_2026 });
    expect(created).toContainEqual({ name: "Personal Journal \u2013 December 2026", parent: expect.any(String) });
  });

  it("uses a picked doc and does not create a second one", async () => {
    const created: string[] = [];
    const picked = file("picked-dec", "Personal Journal \u2013 December 2026", DOC_MIME);
    const drive = fake({
      files: [picked, file("blocked-doc", "Accountability Journal", DOC_MIME)],
      onCreate(name) {
        created.push(name);
      },
    });
    const result = await ensureMonthDoc(drive, new Date("2026-12-15T18:00:00.000Z"), {
      knownFiles: [picked, file("blocked-doc", "Accountability Journal", DOC_MIME)],
    });
    expect(result).toEqual({ ok: true, docId: "picked-dec" });
    expect(created).toEqual([]);
  });

  it("does not call batchUpdate when the banner is missing", async () => {
    let writes = 0;
    const drive = fake({
      files: [file(NOV_DOC, "Personal Journal \u2013 November 2026", DOC_MIME)],
      text: "Not a journal\n",
      onWrite() {
        writes += 1;
      },
    });
    await expect(publishEntry(drive, entryOne)).rejects.toThrow(/banner count/);
    expect(writes).toBe(0);
  });

  it("appends with the revision returned by the read", async () => {
    let locked = "";
    const original = renderDocument([entryOne]);
    const drive = fake({
      files: [file(NOV_DOC, "Personal Journal \u2013 November 2026", DOC_MIME)],
      text: original,
      revision: "rev-start",
      onWrite(body) {
        locked = body.writeControl.requiredRevisionId;
        const applied = applyDoc(body.requests, original);
        expect(applied.text).toBe(renderDocument([entryOne, entryTwo]));
      },
    });
    const result = await publishEntry(drive, entryTwo);
    expect(result).toEqual({ ok: true, docId: NOV_DOC });
    expect(locked).toBe("rev-start");
  });
});

function fake(options: {
  files: DriveFile[];
  children?: Record<string, string[]>;
  text?: string;
  revision?: string;
  onCreate?: (name: string, parent: string) => void;
  onGet?: (id: string) => void;
  onWrite?: (body: BatchUpdateBody) => void;
}): DriveIO {
  const byId = new Map(options.files.map((item) => [item.id, item]));
  const children = new Map<string, string[]>(Object.entries(options.children ?? {}).map(([id, list]) => [id, [...list]]));
  let text = options.text ?? "\n";
  let revision = options.revision ?? "rev-1";
  let sequence = 0;
  return {
    async getFile(id) {
      options.onGet?.(id);
      return byId.get(id) ?? null;
    },
    async listChildren(parentId) {
      return (children.get(parentId) ?? []).map((id) => byId.get(id)).filter((item): item is DriveFile => Boolean(item));
    },
    async createFolder(name, parentId) {
      options.onCreate?.(name, parentId);
      sequence += 1;
      const created = file(`folder-${sequence}`, name, FOLDER_MIME);
      byId.set(created.id, created);
      children.set(parentId, [...(children.get(parentId) ?? []), created.id]);
      children.set(created.id, []);
      return created;
    },
    async createDoc(name, parentId) {
      options.onCreate?.(name, parentId);
      sequence += 1;
      const created = file(`doc-${sequence}`, name, DOC_MIME);
      byId.set(created.id, created);
      children.set(parentId, [...(children.get(parentId) ?? []), created.id]);
      return created;
    },
    async getDocument() {
      return structureFromPlainText(text, revision);
    },
    async batchUpdate(_id, body) {
      options.onWrite?.(body);
      text = applyDoc(body.requests, text).text;
      revision = `${revision}-next`;
    },
  };
}
