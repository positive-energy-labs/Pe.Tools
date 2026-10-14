import { afterEach, expect, test } from "vite-plus/test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessEvent, HostEvent } from "@pe/agent-contracts";
import { HostLog } from "../src/host-log.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { logReceipts } from "../src/gateway-owner.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), "pe-host-log-"));
  dirs.push(path);
  return path;
};
const said = (thread: string, seq: number, text = `t${seq}`): HostEvent => ({
  kind: "thread",
  thread,
  event: { seq, at: new Date().toISOString(), kind: "title_changed", title: text } as HarnessEvent,
});

test("ids are monotonic across a reopen and a reader resumes after its cursor", () => {
  const path = dir();
  const log = new HostLog(path);
  for (let seq = 1; seq <= 5; seq++) log.append(said("a", seq));
  const reopened = new HostLog(path);
  expect(reopened.last).toBe(5);
  expect(reopened.append(said("a", 6)).id).toBe(6);
  const { gap, entries } = reopened.read(3);
  expect(gap).toBe(false);
  expect(entries.map((e) => e.id)).toEqual([4, 5, 6]);
  expect(
    reopened.read(0, (e) => e.event.kind === "thread" && e.event.thread === "b").entries,
  ).toEqual([]);
});

test("subscribers see each entry once, in id order, as it is appended", () => {
  const log = new HostLog(dir());
  const seen: number[] = [];
  const stop = log.subscribe((entry) => seen.push(entry.id));
  log.append(said("a", 1));
  log.append(said("b", 1));
  stop();
  log.append(said("a", 2));
  expect(seen).toEqual([1, 2]);
});

test("retention drops whole old segments; a cursor below the floor reads as a gap", () => {
  const path = dir();
  const log = new HostLog(path, { segmentBytes: 400, segments: 2, entryBytes: 4096 });
  for (let seq = 1; seq <= 40; seq++) log.append(said("a", seq));
  expect(readdirSync(path).length).toBeLessThanOrEqual(2);
  expect(log.floor).toBeGreaterThan(1);
  const stale = log.read(0);
  expect(stale.gap).toBe(true);
  expect(stale.entries[0]!.id).toBe(log.floor);
  expect(stale.entries.at(-1)!.id).toBe(40);
  expect(log.read(log.floor - 1).gap).toBe(false);
  expect(new HostLog(path, { segmentBytes: 400, segments: 2, entryBytes: 4096 }).last).toBe(40);
});

test("an entry over the bound is kept as a pointer to its owner, never the payload", () => {
  const log = new HostLog(dir(), { segmentBytes: 1 << 20, segments: 2, entryBytes: 1024 });
  const entry = log.append(said("a", 7, "x".repeat(4000)));
  expect(entry.event).toEqual({
    kind: "oversize",
    of: "thread",
    ref: { thread: "a", seq: 7 },
    bytes: expect.any(Number),
  });
  expect(JSON.stringify(log.read(0).entries)).not.toContain("xxxx");
});

test("forget removes a deleted thread's entries and never reuses its ids", () => {
  const path = dir();
  const log = new HostLog(path);
  log.append(said("a", 1));
  log.append(said("gone", 1, "secret"));
  log.append(said("gone", 2, "secret"));
  log.forget((e) => e.event.kind === "thread" && e.event.thread === "gone");
  expect(JSON.stringify(log.read(0).entries)).not.toContain("secret");
  const reopened = new HostLog(path);
  expect(reopened.last).toBe(3);
  expect(reopened.append(said("a", 2)).id).toBe(4);
});

test("a torn last line from a crash is skipped, not fatal", async () => {
  const path = dir();
  const log = new HostLog(path);
  log.append(said("a", 1));
  const { appendFileSync } = await import("node:fs");
  appendFileSync(join(path, readdirSync(path)[0]!), '{"id":2,"at":"2026');
  const reopened = new HostLog(path);
  expect(reopened.last).toBe(1);
  expect(reopened.read(0).entries.map((e) => e.id)).toEqual([1]);
  reopened.append(said("a", 2));
  expect(new HostLog(path).read(0).entries.map((e) => e.id)).toEqual([1, 2]);
});

test("each committed receipt revision is appended in commit order", async () => {
  const path = dir();
  const journal = new ActionJournal(join(path, "journal.json"));
  const log = new HostLog(join(path, "log"));
  logReceipts(journal, log);
  const first = await journal.recordFact({ kind: "turn", phase: "started" });
  const second = await journal.recordFact({ kind: "turn", phase: "finished" });
  expect(log.read(0).entries.map((e) => e.event)).toEqual([
    { kind: "receipt", receipt: first },
    { kind: "receipt", receipt: second },
  ]);
});
