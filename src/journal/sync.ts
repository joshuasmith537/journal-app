import { config } from "../config";
import { filterDriveFiles, isAccountabilityName } from "./accountability";
import { buildWriteRequests, type BatchUpdateBody } from "./batch";
import { entryAlreadyInDocument } from "./parse";
import { type JournalDocument } from "./structure";
import {
  type JournalEntry,
  chicagoParts,
  docTitle,
  monthFolderName,
  yearFolderName,
} from "./text";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const DOC_MIME = "application/vnd.google-apps.document";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface DriveIO {
  getFile(id: string): Promise<DriveFile | null>;
  listChildren(parentId: string): Promise<DriveFile[]>;
  createFolder(name: string, parentId: string): Promise<DriveFile>;
  createDoc(name: string, parentId: string): Promise<DriveFile>;
  getDocument(id: string): Promise<JournalDocument>;
  batchUpdate(id: string, body: BatchUpdateBody): Promise<void>;
}

export type EnsureResult =
  | { ok: true; docId: string }
  | { ok: false; code: "grant"; target: "personal" | "year" | "month" | "doc"; id: string; label: string }
  | {
      ok: false;
      code: "pick-then-create";
      parentId: string;
      parentName: string;
      summary: string;
      monthFolder: string;
      docTitle: string;
      yearName: string;
    };

export interface EnsureOptions {
  allowCreate?: boolean;
  /** Create only a missing year folder, then stop so the year folder can be picked through. */
  createYearOnly?: boolean;
  knownFiles?: DriveFile[];
}

export function isRevisionConflict(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = "status" in err ? Number((err as { status: unknown }).status) : Number.NaN;
  return status === 400 && /revision/i.test(err.message);
}

export function httpError(status: number, message: string): Error {
  const err = new Error(message);
  (err as Error & { status: number }).status = status;
  return err;
}

export async function writeWithRevisionLock(
  read: () => Promise<JournalDocument>,
  write: (body: BatchUpdateBody) => Promise<void>,
  build: (doc: JournalDocument, revisionId: string) => BatchUpdateBody,
  attempts = 3,
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const doc = await read();
    const body = build(doc, doc.revisionId);
    if (body.requests.length === 0) return;
    if (body.writeControl.requiredRevisionId !== doc.revisionId) {
      throw new Error("Write is missing the document revision lock");
    }
    try {
      await write(body);
      return;
    } catch (err) {
      last = err;
      if (!isRevisionConflict(err) || attempt === attempts - 1) throw err;
    }
  }
  throw last;
}

export async function publishEntry(drive: DriveIO, entry: JournalEntry, options: EnsureOptions = {}): Promise<EnsureResult> {
  const ensured = await ensureMonthDoc(drive, entry.at, options);
  if (!ensured.ok) return ensured;
  await writeWithRevisionLock(
    () => drive.getDocument(ensured.docId),
    (body) => drive.batchUpdate(ensured.docId, body),
    (doc, revisionId) =>
      entryAlreadyInDocument(doc.text, entry)
        ? { requests: [], writeControl: { requiredRevisionId: revisionId } }
        : buildWriteRequests(doc, revisionId, entry),
  );
  return ensured;
}

export async function ensureMonthDoc(drive: DriveIO, at: Date, options: EnsureOptions = {}): Promise<EnsureResult> {
  const parts = chicagoParts(at);
  const title = docTitle(at);
  const yearKey = String(parts.year) as keyof typeof config.journal.years;
  const knownYear = yearKey in config.journal.years ? config.journal.years[yearKey] : undefined;
  const monthKey = String(parts.month).padStart(2, "0") as "10" | "11";
  const knownMonth = knownYear && monthKey in knownYear.months ? knownYear.months[monthKey] : undefined;
  const picked = filterDriveFiles(options.knownFiles ?? []);

  if (knownMonth) {
    const doc = await safeGet(drive, knownMonth.docId);
    if (!doc) return grant("doc", knownMonth.docId, title);
    if (doc.mimeType !== DOC_MIME) throw new Error("The journal target is not a Google Doc");
    return { ok: true, docId: doc.id };
  }

  const pickedDoc = await matchPicked(drive, picked, title, DOC_MIME);
  if (pickedDoc) return { ok: true, docId: pickedDoc.id };

  const yearName = yearFolderName(at);
  const monthName = monthFolderName(at);
  if (isAccountabilityName(yearName) || isAccountabilityName(monthName) || isAccountabilityName(title)) {
    throw new Error("Refusing to create a blocked file");
  }
  const steps: string[] = [];
  let yearId: string | undefined;
  if (knownYear) {
    const year = await safeGet(drive, knownYear.folderId);
    if (!year) return grant("year", knownYear.folderId, yearName);
    if (year.mimeType !== FOLDER_MIME) throw new Error("The journal target is not a folder");
    yearId = year.id;
  } else {
    const personal = await safeGet(drive, config.journal.personalFolderId);
    if (!personal) return grant("personal", config.journal.personalFolderId, "Personal");
    const children = filterDriveFiles(await drive.listChildren(personal.id));
    const found =
      children.find((file) => file.name === yearName && file.mimeType === FOLDER_MIME) ??
      (await matchPicked(drive, picked, yearName, FOLDER_MIME));
    if (found) yearId = found.id;
    else steps.push(`Folder “${yearName}” inside Personal`);
  }

  let monthId: string | undefined;
  if (yearId) {
    const children = filterDriveFiles(await drive.listChildren(yearId));
    const found =
      children.find((file) => file.name === monthName && file.mimeType === FOLDER_MIME) ??
      (await matchPicked(drive, picked, monthName, FOLDER_MIME));
    if (found) monthId = found.id;
  }
  if (!monthId) steps.push(`Folder “${monthName}” inside ${yearName}`);
  if (monthId) {
    const children = filterDriveFiles(await drive.listChildren(monthId));
    const existing = children.find((file) => file.name === title && file.mimeType === DOC_MIME);
    if (existing) return { ok: true, docId: existing.id };
  }
  steps.push(`Doc “${title}” inside ${monthName}`);
  const plan = {
    ok: false as const,
    code: "pick-then-create" as const,
    parentId: yearId ?? config.journal.personalFolderId,
    parentName: yearId ? yearName : "Personal",
    summary: steps.filter((step) => (options.createYearOnly ? step.startsWith("Folder") && step.includes(`“${yearName}”`) : true)).join("\n"),
    monthFolder: monthName,
    docTitle: title,
    yearName,
  };
  if (options.createYearOnly) {
    if (!yearId) {
      const created = await drive.createFolder(yearName, config.journal.personalFolderId);
      if (isAccountabilityName(created.name)) throw new Error("Refusing to create a blocked file");
      yearId = created.id;
    }
    const rest = steps.filter((step) => !step.includes(`“${yearName}” inside Personal`));
    return { ...plan, parentId: yearId, parentName: yearName, summary: rest.join("\n") };
  }
  if (!options.allowCreate) return plan;

  let monthParent = yearId;
  if (!monthParent) {
    const created = await drive.createFolder(yearName, config.journal.personalFolderId);
    monthParent = created.id;
  }
  let docParent = monthId;
  if (!docParent) {
    const created = await drive.createFolder(monthName, monthParent);
    docParent = created.id;
  }
  const created = await drive.createDoc(title, docParent);
  if (isAccountabilityName(created.name)) throw new Error("Refusing to use a blocked file");
  return { ok: true, docId: created.id };
}

/** Create is offered only after the picker has been opened on the folder that can show the month. */
export function nextCreateStep(parentName: string, opened: { year: boolean; personal: boolean }): "open-picker" | "confirm-month" | "confirm-year" {
  const onYear = parentName !== "Personal";
  if (onYear && opened.year) return "confirm-month";
  if (!onYear && opened.personal) return "confirm-year";
  return "open-picker";
}

export function monthCreateMessage(monthFolder: string, docTitle: string): string {
  return `If you see “${monthFolder}” or “${docTitle}”, choose that. Create only if neither exists.`;
}

/** The year-folder picker ran only when a create confirm named a parent other than Personal. */
export function yearPickerWasOpened(parent: { parentName: string } | null): boolean {
  return parent !== null && parent.parentName !== "Personal";
}

function grant(target: "personal" | "year" | "month" | "doc", id: string, label: string): EnsureResult {
  return { ok: false, code: "grant", target, id, label };
}

async function safeGet(drive: DriveIO, id: string): Promise<DriveFile | null> {
  const file = await drive.getFile(id);
  if (file && isAccountabilityName(file.name)) throw new Error("Refusing to use a blocked file");
  return file;
}

async function matchPicked(drive: DriveIO, picked: DriveFile[], name: string, mimeType: string): Promise<DriveFile | null> {
  if (isAccountabilityName(name)) return null;
  const candidate = picked.find((file) => file.name === name && file.mimeType === mimeType);
  if (!candidate) return null;
  return safeGet(drive, candidate.id);
}

