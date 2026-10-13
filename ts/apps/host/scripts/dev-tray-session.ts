import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface DevTraySession {
  schemaVersion: 1;
  sourceRoot: string;
  serviceFile: string;
  hostInstanceId: string;
  frontendOrigin: string;
  frontendPid: number;
  frontendStartUtc: string;
}

export const devTrayDirectory = (sourceRoot: string) => join(sourceRoot, ".artifacts", "dev-tray");
export async function writeAtomic(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, path);
}
export async function publishDevTraySession(session: DevTraySession) {
  await mkdir(devTrayDirectory(session.sourceRoot), { recursive: true });
  await writeAtomic(join(devTrayDirectory(session.sourceRoot), "session.json"), session);
}
export async function readJson(path: string): Promise<unknown> {
  return JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
}
