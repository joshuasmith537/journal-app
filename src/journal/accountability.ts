/** Phrase the app must never read, list, write, or surface. */
const BLOCKED = "accountability journal";

export function isAccountabilityName(name: string): boolean {
  return name.toLowerCase().includes(BLOCKED);
}

export function filterDriveFiles<T extends { name: string }>(files: T[]): T[] {
  return files.filter((file) => !isAccountabilityName(file.name));
}
