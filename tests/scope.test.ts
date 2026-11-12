import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceText(dir: string): string {
  const parts: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) parts.push(sourceText(full));
    else if (entry.name.endsWith(".ts")) parts.push(readFileSync(full, "utf8"));
  }
  return parts.join("\n");
}

describe("OAuth scope", () => {
  it("requests drive.file and no broader Drive or Docs scope", () => {
    const src = sourceText(path.join(process.cwd(), "src"));
    expect(src).toContain("https://www.googleapis.com/auth/drive.file");
    expect(src).not.toMatch(/googleapis\.com\/auth\/drive(?!\.file)/);
    expect(src).not.toMatch(/googleapis\.com\/auth\/documents/);
  });
});
