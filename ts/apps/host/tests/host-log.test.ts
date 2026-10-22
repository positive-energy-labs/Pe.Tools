import { afterEach, expect, test } from "vite-plus/test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessEvent, HostEvent } from "@pe/agent-contracts";
import { HostLog } from "../src/host-log.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { createPeClient, servePeRoute } from "@pe/agent-contracts/pe-api";

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

test("GET /pe/log pages the log after a cursor, by kind and thread", async () => {
  const log = new HostLog(dir());
  for (let seq = 1; seq <= 3; seq++) log.append(said("a", seq));
  log.append(said("b", 1));
  const routes = createPeRoutes({
    registrations: [],
    store: { getState: async () => null, setState: async () => {} },
    heads: { observe: () => () => {} },
    log,
  });
  const client = createPeClient("http://host", (url, init) =>
    servePeRoute(new Request(url, init), routes.fetch),
  );
  const first = await client.call("log.read", {
    query: { after: "1", thread: "a", limit: "1" },
  });
  expect([first.entries.map((e) => e.id), first.next, first.more, first.gap]).toEqual([
    [2],
    2,
    true,
    false,
  ]);
  const rest = await client.call("log.read", { query: { after: String(first.next), thread: "a" } });
  expect([rest.entries.map((e) => e.id), rest.next, rest.more]).toEqual([[3], 3, false]);
  expect((await client.call("log.read", { query: { kind: "receipt" } })).entries).toEqual([]);
  await expect(client.call("log.read", { query: { after: "x" } })).rejects.toMatchObject({
    status: 400,
  });
});
