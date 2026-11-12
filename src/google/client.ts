import type { BatchUpdateBody } from "../journal/batch";
import { documentBodyToText } from "../journal/parse";
import { filterDriveFiles, isAccountabilityName } from "../journal/accountability";
import {
  DOC_MIME,
  FOLDER_MIME,
  httpError,
  type DocSnapshot,
  type DriveFile,
  type DriveIO,
} from "../journal/sync";

export class GoogleDrive implements DriveIO {
  constructor(private readonly token: string) {}

  async getFile(id: string): Promise<DriveFile | null> {
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType`);
    if (response.status === 404) return null;
    const file = (await this.json(response)) as DriveFile;
    if (isAccountabilityName(file.name)) throw new Error("Refusing to use a blocked file");
    return file;
  }

  async listChildren(parentId: string): Promise<DriveFile[]> {
    if (parentId.includes("'")) throw new Error("Invalid folder id");
    const files: DriveFile[] = [];
    let pageToken = "";
    do {
      const url = new URL("https://www.googleapis.com/drive/v3/files");
      url.searchParams.set("q", `'${parentId}' in parents and trashed = false`);
      url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType)");
      url.searchParams.set("pageSize", "100");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const data = (await this.json(await this.request(url))) as { files?: DriveFile[]; nextPageToken?: string };
      files.push(...(data.files ?? []));
      pageToken = data.nextPageToken ?? "";
    } while (pageToken);
    return filterDriveFiles(files);
  }

  async createFolder(name: string, parentId: string): Promise<DriveFile> {
    return this.create(name, FOLDER_MIME, parentId);
  }

  async createDoc(name: string, parentId: string): Promise<DriveFile> {
    return this.create(name, DOC_MIME, parentId);
  }

  async getDocument(id: string): Promise<DocSnapshot> {
    const data = (await this.json(
      await this.request(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}`),
    )) as Parameters<typeof documentBodyToText>[0] & { revisionId: string };
    return { text: documentBodyToText(data), revisionId: data.revisionId };
  }

  async batchUpdate(id: string, body: BatchUpdateBody): Promise<void> {
    await this.json(
      await this.request(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(id)}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }

  private async create(name: string, mimeType: string, parentId: string): Promise<DriveFile> {
    if (isAccountabilityName(name)) throw new Error("Refusing to create a blocked file");
    const file = (await this.json(
      await this.request("https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType", {
        method: "POST",
        body: JSON.stringify({ name, mimeType, parents: [parentId] }),
      }),
    )) as DriveFile;
    if (isAccountabilityName(file.name)) throw new Error("Refusing to use a blocked file");
    return file;
  }

  private async request(url: string | URL, init: RequestInit = {}): Promise<Response> {
    return fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
  }

  private async json(response: Response): Promise<unknown> {
    if (response.ok) return response.json();
    const message = (await response.text()) || response.statusText;
    throw httpError(response.status, message);
  }
}
