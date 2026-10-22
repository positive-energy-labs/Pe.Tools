import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
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
import { writeJournal } from "./journal-fixture.ts";
import { human } from "./callers.ts";

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

const action = (id: string, state: "running" | "succeeded") => ({
  id,
  kind: "operation" as const,
  key: "probe.read",
  caller: human,
  basis: null,
  destination: { kind: "host" },
  request: {},
  bases: {},
  // An in-flight native step: a restart cannot know its outcome, so the attempt stays unknown.
  steps:
    state === "running"
      ? [{ id: `${id}-step`, key: "probe", kind: "native" as const, input: {}, state }]
      : [],
  preparation: { state: "ready", value: null },
  recovery: [],
  publication: { state: "unrequested" },
  startedAt: new Date().toISOString(),
  state,
  ...(state === "succeeded" ? { result: null } : {}),
});

test("retention keeps the newest settled receipts and every open action, across a reload", async () => {
  const path = file();
  await writeJournal(path, [action("open", "running"), action("old", "succeeded")]);
  const journal = new ActionJournal(path, () => null, 100);
  for (let i = 0; i < 500; i++) await journal.recordFact({ kind: "turn", phase: "started" });
  const reloaded = new ActionJournal(path, () => null, 100);
  const receipts = await reloaded.read({});
  expect(receipts.length).toBeLessThanOrEqual(111);
  expect((await reloaded.list(undefined, "open"))[0]!.state).toBe("unknown");
  expect(await reloaded.list(undefined, "old")).toEqual([]);
  expect((await readFile(path, "utf8")).trim().split("\n").length).toBeLessThan(400);
});
