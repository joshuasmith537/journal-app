import { config } from "../config";
import { filterDriveFiles, isAccountabilityName } from "./accountability";
import { buildWriteRequests, type BatchUpdateBody } from "./batch";
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

export interface DocSnapshot {
  text: string;
  revisionId: string;
}

export interface DriveIO {
  getFile(id: string): Promise<DriveFile | null>;
  listChildren(parentId: string): Promise<DriveFile[]>;
  createFolder(name: string, parentId: string): Promise<DriveFile>;
  createDoc(name: string, parentId: string): Promise<DriveFile>;
  getDocument(id: string): Promise<DocSnapshot>;
  batchUpdate(id: string, body: BatchUpdateBody): Promise<void>;
}

export type EnsureResult =
  | { ok: true; docId: string }
  | { ok: false; code: "grant"; target: "personal" | "year" | "month" | "doc"; id: string; label: string }
  | { ok: false; code: "confirm-create"; label: string };

export interface EnsureOptions {
  allowCreate?: boolean;
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
  read: () => Promise<DocSnapshot>,
  write: (body: BatchUpdateBody) => Promise<void>,
  build: (text: string, revisionId: string) => BatchUpdateBody,
  attempts = 3,
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const doc = await read();
    const body = build(doc.text, doc.revisionId);
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
    (text, revisionId) => buildWriteRequests(text, revisionId, entry),
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

  const year = await resolveFolder(drive, {
    knownId: knownYear?.folderId,
    name: yearFolderName(at),
    parentId: config.journal.personalFolderId,
    parentGrant: grant("personal", config.journal.personalFolderId, "Personal"),
    knownGrant: knownYear ? grant("year", knownYear.folderId, yearFolderName(at)) : null,
    picked,
    allowCreate: options.allowCreate ?? false,
    confirmLabel: title,
  });
  if ("result" in year) return year.result;

  const month = await resolveFolder(drive, {
    knownId: undefined,
    name: monthFolderName(at),
    parentId: year.id,
    parentGrant: grant("year", year.id, yearFolderName(at)),
    knownGrant: null,
    picked,
    allowCreate: options.allowCreate ?? false,
    confirmLabel: title,
  });
  if ("result" in month) return month.result;

  const children = filterDriveFiles(await drive.listChildren(month.id));
  const existing = children.find((file) => file.name === title && file.mimeType === DOC_MIME);
  if (existing) return { ok: true, docId: existing.id };
  if (!options.allowCreate) return { ok: false, code: "confirm-create", label: title };
  const created = await drive.createDoc(title, month.id);
  if (isAccountabilityName(created.name)) throw new Error("Refusing to use a blocked file");
  return { ok: true, docId: created.id };
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

async function resolveFolder(
  drive: DriveIO,
  args: {
    knownId?: string;
    name: string;
    parentId: string;
    parentGrant: EnsureResult;
    knownGrant: EnsureResult | null;
    picked: DriveFile[];
    allowCreate: boolean;
    confirmLabel: string;
  },
): Promise<{ id: string } | { result: EnsureResult }> {
  if (isAccountabilityName(args.name)) return { result: { ok: false, code: "confirm-create", label: args.confirmLabel } };
  if (args.knownId) {
    const folder = await safeGet(drive, args.knownId);
    if (!folder) return { result: args.knownGrant ?? args.parentGrant };
    if (folder.mimeType !== FOLDER_MIME) throw new Error("The journal target is not a folder");
    return { id: folder.id };
  }
  const picked = await matchPicked(drive, args.picked, args.name, FOLDER_MIME);
  if (picked) return { id: picked.id };
  const parent = await safeGet(drive, args.parentId);
  if (!parent) return { result: args.parentGrant };
  const children = filterDriveFiles(await drive.listChildren(args.parentId));
  const existing = children.find((file) => file.name === args.name && file.mimeType === FOLDER_MIME);
  if (existing) return { id: existing.id };
  if (!args.allowCreate) return { result: { ok: false, code: "confirm-create", label: args.confirmLabel } };
  const created = await drive.createFolder(args.name, args.parentId);
  if (isAccountabilityName(created.name)) throw new Error("Refusing to use a blocked file");
  return { id: created.id };
}
