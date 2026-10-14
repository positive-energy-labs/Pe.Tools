import { afterEach, expect, test } from "vite-plus/test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("the journal stays linear at 10k receipts: the last thousand cost what the first did", async () => {
  const path = file();
  const journal = new ActionJournal(path);
  const batch = async () => {
    const started = performance.now();
    for (let i = 0; i < 1000; i++) await journal.recordFact({ kind: "turn", phase: "started" });
    return performance.now() - started;
  };
  const first = await batch();
  for (let i = 0; i < 8; i++) await batch();
  const last = await batch();
  expect(last).toBeLessThan(first * 3 + 250);
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

test("a version 4 journal is imported whole and rewritten as lines", async () => {
  const path = file();
  const join = { actionId: randomUUID(), requestId: randomUUID() };
  const value = action("kept", "succeeded");
  await writeFile(
    path,
    JSON.stringify({
      version: 4,
      receipts: [
        {
          schema: 1,
          id: randomUUID(),
          revision: 2,
          at: new Date().toISOString(),
          stamp: null,
          join,
          body: { kind: "action", value },
        },
      ],
      mappings: {
        [JSON.stringify(["action", "kept"])]: join.actionId,
        [JSON.stringify(["action-request", "kept"])]: join.requestId,
      },
    }),
  );
  const imported = new ActionJournal(path);
  expect((await imported.list(undefined, "kept"))[0]!.state).toBe("succeeded");
  expect((await readFile(path, "utf8")).split("\n")[0]).toBe('{"version":5}');
  expect(await new ActionJournal(path).read({})).toEqual(await imported.read({}));
});
