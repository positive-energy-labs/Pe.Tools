import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Receipt, HarnessThreadSummary } from "@pe/agent-contracts";
import { emptyThreadHead, emptyThreadLifecycle } from "@pe/agent-contracts";
import { createScheduledTasks, type ScheduledLaunch } from "../src/scheduled-tasks.ts";
import { threadHistory } from "../src/thread-history.ts";
import { asCaller, human, pea } from "./callers.ts";
import { peRoutes } from "@pe/agent-contracts/pe-api";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const at = new Date(2026, 9, 14, 3, 0);
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pe-scheduler-"));
  dirs.push(dir);
  const path = join(dir, "tasks.json");
  let clock = new Date(at);
  const read = vi.fn(async () => [] as Receipt[]);
  const launch = vi.fn((_input: ScheduledLaunch) => ({
    threadId: randomUUID(),
    completion: Promise.resolve(),
  }));
  const options = {
    path,
    receipts: { read, subscribe: () => () => {} },
    evidence: () => new Set(["eligible"]),
    launch,
    now: () => clock,
  };
  return {
    path,
    read,
    launch,
    options,
    advance: (ms: number) => {
      clock = new Date(+clock + ms);
    },
  };
}
const ELIGIBLE_ACTION = "00000000-0000-4000-8000-0000000000a1";
/** An action a Pea thread admitted; its native steps join it by the opaque action id. */
const action = (thread: string, actionId: string): Receipt => ({
  schema: 1,
  id: randomUUID(),
  revision: 1,
  at: at.toISOString(),
  stamp: null,
  join: { requestId: randomUUID(), actionId },
  body: {
    kind: "action",
    value: {
      id: actionId,
      key: "arbitrary",
      caller: { kind: "pea", context: "c", thread },
      effects: [],
      consumes: [],
      claims: [],
      consent: null,
      basis: null,
      target: { kind: "host" },
      input: {},
      steps: [],
      prepared: { state: "unprepared" },
      recovery: [],
      startedAt: at.toISOString(),
      state: "succeeded",
      result: null,
    },
  },
});
const receipt = (
  verdict: "ok" | "running" | "rejected" = "ok",
  actionId = ELIGIBLE_ACTION,
): Receipt => ({
  schema: 1,
  id: randomUUID(),
  revision: 1,
  at: at.toISOString(),
  stamp: null,
  join: { requestId: "00000000-0000-4000-8000-000000000001", actionId },
  body: {
    kind: "native",
    verdict,
    localRef: {
      requestId: "00000000-0000-4000-8000-000000000001",
      key: "arbitrary",
      process: { pid: 123, processStartUtc: at.toISOString(), executable: "Revit.exe" },
    },
  },
});

test("claim covers gate await and turn lifetime; concurrent poll and force cannot overlap", async () => {
  const f = fixture();
  let gate!: (r: Receipt[]) => void;
  let finish!: () => void;
  f.read.mockImplementation(
    () =>
      new Promise((resolve) => {
        gate = resolve;
      }),
  );
  f.launch.mockImplementation(() => ({
    threadId: randomUUID(),
    completion: new Promise<void>((resolve) => {
      finish = resolve;
    }),
  }));
  const service = createScheduledTasks(f.options);
  const running = service.run("feedback-miner");
  await expect(service.run("feedback-miner", true)).rejects.toThrow("already running");
  gate([action("eligible", ELIGIBLE_ACTION), ...Array.from({ length: 25 }, () => receipt())]);
  await vi.waitFor(() => expect(f.launch).toHaveBeenCalledOnce());
  f.advance(2 * 86_400_000);
  await service.poll();
  expect(f.launch).toHaveBeenCalledOnce();
  expect(JSON.parse(readFileSync(f.path, "utf8"))[0].lastStatus).toBe("running");
  finish();
  await running;
  expect(service.list()[0]?.lastStatus).toBe("succeeded");
  await service.close();
});

test("force bypasses volume only and interrupted persisted run advances without replay", async () => {
  const f = fixture();
  const service = createScheduledTasks(f.options);
  await service.run("feedback-miner", true);
  expect(f.read).not.toHaveBeenCalled();
  expect(f.launch).toHaveBeenCalledOnce();
  await service.close();
  const rows = service.list();
  rows[0]!.lastStatus = "running";
  writeFileSync(f.path, JSON.stringify(rows));
  f.advance(86_400_000);
  const restarted = createScheduledTasks(f.options);
  await restarted.poll();
  expect(f.launch).toHaveBeenCalledOnce();
  expect(restarted.list()[0]).toMatchObject({ lastStatus: "failed", runCount: 1 });
  await restarted.close();
});

test("scheduler routes declare admin admission and deny anonymous and Pea callers", async () => {
  const f = fixture();
  const service = createScheduledTasks(f.options);
  for (const key of ["tasks.list", "tasks.enabled", "tasks.run"] as const) {
    expect(peRoutes[key].permission).toBe("admin");
    expect(peRoutes[key].principal).toBe("human");
  }
  expect((await service.fetch(new Request("http://host/pe/tasks"))).status).toBe(403);
  expect((await asCaller(pea(), service.fetch)(new Request("http://host/pe/tasks"))).status).toBe(
    403,
  );
  expect((await asCaller(human, service.fetch)(new Request("http://host/pe/tasks"))).status).toBe(
    200,
  );
  await service.close();
});

test("history pages only settled eligible threads, excludes miner and joins receipts by opaque thread id", async () => {
  const summary = (id: string): HarnessThreadSummary & { events: [] } => ({
    id,
    harness: "claude",
    providerId: "claude",
    providerName: "Claude",
    title: id,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    modelId: null,
    lastSeq: 0,
    cursor: 0,
    head: emptyThreadHead,
    lifecycle: { ...emptyThreadLifecycle(), status: "settled", settledAt: at.toISOString() },
    tabs: [],
    activity: { state: "idle", pending: 0, lastSeq: 0, message: null },
    events: [],
  });
  const normal = summary("normal");
  const miner = summary("miner");
  miner.origin = { kind: "scheduled", taskId: "feedback-miner", runId: randomUUID() };
  const active = summary("active");
  active.lifecycle.status = "active";
  const read = vi.fn(async () => [receipt()]);
  const threadJoin = vi.fn(async () => "opaque-id");
  const handler = threadHistory({
    snapshot: () => [normal, miner, active],
    receipts: { read, subscribe: () => () => {} },
    threadJoin,
  });
  const request = (extra = {}) =>
    new Request(
      `http://host/pe/thread-history?query=${encodeURIComponent(JSON.stringify({ since: new Date(0).toISOString(), before: at.toISOString(), ...extra }))}`,
    );
  expect((await handler(request())).status).toBe(403);
  const fetch = asCaller(pea(), handler);
  const listed = await (await fetch(request())).json();
  expect(listed.items.map((r: { id: string }) => r.id)).toEqual(["normal"]);
  const detail = await (await fetch(request({ threadId: "normal", limit: 1 }))).json();
  expect(detail.items[0].kind).toBe("receipt");
  expect(threadJoin).toHaveBeenCalledWith("normal");
  expect(read).toHaveBeenCalledWith({ threadId: "opaque-id" });
  expect((await fetch(request({ threadId: "miner" }))).status).toBe(404);
});

test("only a succeeded run advances the mining watermark; a failed start keeps its window", async () => {
  const f = fixture();
  const service = createScheduledTasks(f.options);
  const epoch = new Date(0).toISOString();
  const since = () => /since=(\S+),/.exec(f.launch.mock.calls.at(-1)![0].prompt)?.[1];
  f.launch.mockImplementationOnce(() => ({
    threadId: randomUUID(),
    completion: Promise.reject(Error("provider failed to start")),
  }));
  await service.run("feedback-miner", true);
  expect(service.list()[0]).toMatchObject({ lastStatus: "failed", lastStartedAt: null });
  f.advance(60_000);
  await service.run("feedback-miner", true);
  expect(since()).toBe(epoch);
  const mark = new Date(+at + 60_000).toISOString();
  expect(service.list()[0]).toMatchObject({ lastStatus: "succeeded", lastStartedAt: mark });
  f.advance(60_000);
  await service.run("feedback-miner", true);
  expect(since()).toBe(mark);
  await service.close();
});
