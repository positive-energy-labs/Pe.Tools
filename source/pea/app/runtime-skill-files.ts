import { readFile, writeFile } from "node:fs/promises";

export interface RuntimeSkillDefinition {
  name: string;
  content: string;
}

export type ManagedFileStatus = "created" | "updated" | "unchanged";

export async function ensureFileContent(
  path: string,
  content: string,
  knownExisting?: string | null,
): Promise<ManagedFileStatus> {
  const existing = knownExisting ?? (await readExisting(path));
  if (existing === content) return "unchanged";

  await writeFile(path, content, "utf-8");
  return existing == null ? "created" : "updated";
}

export async function readExisting(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}
