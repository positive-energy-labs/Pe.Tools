import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Receipt, HarnessThreadSummary } from "@pe/agent-contracts";
import { emptyThreadHead, emptyThreadLifecycle } from "@pe/agent-contracts";
import {
  createScheduledTasks,
  feedbackMiner,
  missedRun,
  nextRun,
  revitTouching,
  scheduleSchema,
  type ScheduledLaunch,
} from "../src/scheduled-tasks.ts";
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
  const options = { path, receipts: { read, subscribe: () => () => {} }, launch, now: () => clock };
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
const receipt = (verdict: "ok" | "running" | "rejected" = "ok"): Receipt => ({
  schema: 1,
  id: randomUUID(),
  revision: 1,
  at: at.toISOString(),
  stamp: null,
  join: { requestId: "00000000-0000-4000-8000-000000000001" },
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

test("schedule interval floor, strictly future local time, weekday mask and missed grace", () => {
  expect(scheduleSchema.safeParse({ type: "interval", everyMs: 59_999 }).success).toBe(false);
  expect(nextRun({ type: "interval", everyMs: 60_000 }, at)).toBe(
    new Date(+at + 60_000).toISOString(),
  );
  expect(scheduleSchema.safeParse({ type: "fixed_time", timeOfDay: "24:00" }).success).toBe(false);
  const daily = { type: "fixed_time", timeOfDay: "03:00" } as const;
  expect(new Date(nextRun(daily, at)).getDate()).toBe(15);
  const monday = new Date(nextRun({ ...daily, weekdays: [1] }, at));
  expect(monday.getDay()).toBe(1);
  expect(monday.getHours()).toBe(3);
  expect(nextRun({ ...daily, weekdays: [] }, at)).toBe(nextRun(daily, at));
  expect(missedRun(daily, at.toISOString(), new Date(+at + 600_000))).toBe(false);
  expect(missedRun(daily, at.toISOString(), new Date(+at + 600_001))).toBe(true);
  expect(
    missedRun({ type: "interval", everyMs: 60_000 }, at.toISOString(), new Date(+at + 86_400_000)),
  ).toBe(false);
});

test("first run persists default miner and disabled state survives restart", async () => {
  const f = fixture();
  const service = createScheduledTasks(f.options);
  expect(service.list()[0]).toMatchObject({
    id: "feedback-miner",
    enabled: true,
    gate: { minRevitReceipts: 25 },
    schedule: { type: "fixed_time", timeOfDay: "03:00" },
  });
  expect(JSON.parse(readFileSync(f.path, "utf8"))).toHaveLength(1);
  const response = await asCaller(
    human,
    service.fetch,
  )(
    new Request("http://host/pe/tasks/feedback-miner/enabled", {
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    }),
  );
  expect(response.status).toBe(200);
  await service.close();
  const restarted = createScheduledTasks(f.options);
  expect(restarted.list()[0]?.enabled).toBe(false);
  await restarted.close();
});

test("gate skips without a thread or turn; revisions and native running/refused facts do not inflate volume", async () => {
  const f = fixture();
  const service = createScheduledTasks(f.options);
  const rows = Array.from({ length: 24 }, () => receipt());
  f.read.mockResolvedValue([
    ...rows,
    { ...rows[0]!, revision: 2 },
    receipt("running"),
    receipt("rejected"),
  ]);
  await service.run("feedback-miner");
  expect(f.launch).not.toHaveBeenCalled();
  expect(service.list()[0]).toMatchObject({
    lastStatus: "skipped",
    runCount: 1,
    threadId: null,
    lastStartedAt: null,
  });
  f.read.mockResolvedValue([...rows, receipt()]);
  await service.run("feedback-miner");
  expect(f.launch).toHaveBeenCalledOnce();
  expect(service.list()[0]?.lastStatus).toBe("succeeded");
  expect(
    revitTouching({
      ...receipt(),
      body: { kind: "usage", event: "host_op", counters: { tsOnly: true } },
    }),
  ).toBe(false);
  await service.close();
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
  gate(Array.from({ length: 25 }, () => receipt()));
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

test("missed fixed time reschedules, interval catches up once, launch failures persist", async () => {
  const f = fixture();
  const row = feedbackMiner(at);
  row.nextRunAt = at.toISOString();
  writeFileSync(f.path, JSON.stringify([row]));
  f.advance(600_001);
  const service = createScheduledTasks(f.options);
  await service.poll();
  expect(f.launch).not.toHaveBeenCalled();
  expect(service.list()[0]?.runCount).toBe(0);
  await service.close();
  // A non-shipped task: the shipped miner's definition always comes from the build.
  const custom = {
    ...row,
    id: "custom",
    schedule: { type: "interval", everyMs: 60_000 },
    gate: null,
  };
  writeFileSync(f.path, JSON.stringify([custom]));
  f.launch.mockImplementation(() => {
    throw Error("No ready provider");
  });
  const intervals = createScheduledTasks(f.options);
  await intervals.poll();
  expect(intervals.list().find((r) => r.id === "custom")).toMatchObject({
    lastStatus: "failed",
    runCount: 1,
  });
  await intervals.poll();
  expect(f.launch).toHaveBeenCalledOnce();
  await intervals.close();
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
    head: { ...emptyThreadHead, hostNow: at.toISOString(), grantView: null },
    lifecycle: { ...emptyThreadLifecycle(), status: "settled", settledAt: at.toISOString() },
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

test("human run-now honors the gate unless explicitly forced and preserves async failure", async () => {
  const f = fixture();
  const service = createScheduledTasks(f.options);
  const fetch = asCaller(human, service.fetch);
  const request = (force: boolean) =>
    new Request("http://host/pe/tasks/feedback-miner/run", {
      method: "POST",
      body: JSON.stringify({ force }),
    });
  expect((await fetch(request(false))).status).toBe(200);
  await vi.waitFor(() => expect(service.list()[0]?.lastStatus).toBe("skipped"));
  expect(f.launch).not.toHaveBeenCalled();
  f.launch.mockImplementation(() => ({
    threadId: randomUUID(),
    completion: Promise.reject(Error("fake turn failed")),
  }));
  expect((await fetch(request(true))).status).toBe(200);
  await vi.waitFor(() => expect(service.list()[0]?.lastStatus).toBe("failed"));
  expect(service.list()[0]?.lastError).toContain("fake turn failed");
  expect(f.launch).toHaveBeenCalledOnce();
  await service.close();
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

test("a stored shipped miner takes this build's definition and keeps its enabled flag and run state", () => {
  const f = fixture();
  const stale = {
    ...feedbackMiner(at),
    prompt: "an older release's prompt",
    gate: { minRevitReceipts: 1 },
    enabled: false,
    runCount: 4,
  };
  writeFileSync(f.path, JSON.stringify([stale]));
  const [miner] = createScheduledTasks(f.options).list();
  expect(miner!.prompt).toBe(feedbackMiner(at).prompt);
  expect(miner!.gate).toEqual(feedbackMiner(at).gate);
  expect(miner!.enabled).toBe(false);
  expect(miner!.runCount).toBe(4);
});
