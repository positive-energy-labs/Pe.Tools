import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Linearity is counted in bytes the journal writes, not milliseconds: wall time here swung 10x with
// whatever else the machine was running, bytes do not.
const io = vi.hoisted(() => ({ bytes: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  const counted =
    <A extends unknown[]>(write: (path: never, data: never, ...rest: A) => Promise<void>) =>
    (path: never, data: never, ...rest: A) => {
      io.bytes += Buffer.byteLength(String(data));
      return write(path, data, ...rest);
    };
  return { ...fs, appendFile: counted(fs.appendFile), writeFile: counted(fs.writeFile) };
});
import { ActionJournal } from "../src/action-journal.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const file = () => {
  const dir = mkdtempSync(join(tmpdir(), "pe-journal-"));
  dirs.push(dir);
  return join(dir, "journal.json");
};

test("the journal stays linear at 10k receipts: the last thousand write what the first did", async () => {
  const path = file();
  const journal = new ActionJournal(path);
  const batch = async () => {
    const before = io.bytes;
    for (let i = 0; i < 1000; i++) await journal.recordFact({ kind: "turn", phase: "started" });
    return io.bytes - before;
  };
  const first = await batch();
  for (let i = 0; i < 8; i++) await batch();
  const last = await batch();
  expect(last).toBeLessThan(first * 3);
  // One line per revision: the file grows with what was written, never with its square.
  expect((await stat(path)).size).toBeLessThan(10_000 * 1024);
  expect((await new ActionJournal(path).read({})).length).toBe(10_000);
}, 120_000);
