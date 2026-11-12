import { describe, expect, it } from "vitest";
import { filterDriveFiles, isAccountabilityName } from "../src/journal/accountability";

const PERSONAL = { id: "doc-nov", name: "Personal Journal \u2013 November 2026", mimeType: "application/vnd.google-apps.document" };
const BLOCKED_DOC = { id: "blocked-doc", name: "Accountability Journal", mimeType: "application/vnd.google-apps.document" };
const BLOCKED_FOLDER = { id: "blocked-folder", name: "Accountability Journal", mimeType: "application/vnd.google-apps.folder" };
const BLOCKED_PREFIX = { id: "blocked-prefix", name: "Notes - Accountability Journal", mimeType: "application/vnd.google-apps.document" };

describe("Accountability filter", () => {
  it("drops docs and folders named Accountability Journal from a listing", () => {
    const visible = filterDriveFiles([PERSONAL, BLOCKED_DOC, BLOCKED_FOLDER, BLOCKED_PREFIX, { id: "other", name: "Accountability", mimeType: "application/vnd.google-apps.document" }]);
    expect(visible.map((file) => file.id)).toEqual(["doc-nov", "other"]);
    expect(visible.some((file) => isAccountabilityName(file.name))).toBe(false);
  });

  it("matches the phrase regardless of case", () => {
    expect(isAccountabilityName("accountability journal")).toBe(true);
    expect(isAccountabilityName("Personal Journal \u2013 November 2026")).toBe(false);
  });
});
