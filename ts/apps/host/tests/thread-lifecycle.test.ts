import { asCaller, human } from "./callers.ts";
import { HostLog } from "../src/host-log.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyThreadLifecycle, type HarnessEvent } from "@pe/agent-contracts";
import { createHarnessThreads } from "../src/harness/threads.ts";
import type { Providers } from "../src/harness/providers.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});
function fixture(events: HarnessEvent[] = []) {
  const root = mkdtempSync(join(tmpdir(), "pe-lifecycle-"));
  mkdirSync(join(root, "thread"));
  const meta = {
    id: "thread",
    harness: "claude",
    providerId: "claude",
    providerName: "Claude",
    title: "Original",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    modelId: null,
    acpSessionId: null,
    models: [],
    traits: [],
    traitValues: {},
    head: { defaultTarget: null, revision: 0 },
    lifecycle: emptyThreadLifecycle(),
    forkOf: null,
  };
  writeFileSync(join(root, "thread", "meta.json"), JSON.stringify(meta));
  writeFileSync(
    join(root, "thread", "events.jsonl"),
    events.map((event) => JSON.stringify(event)).join("\n"),
  );
  const options = {
    root,
    log: new HostLog(join(root, ".log")),
    worldRoot: root,
    mcpServer: () => ({ name: "unused", command: "unused", args: [], env: [] }),
    providers: {
      get: () => undefined,
      keys: () => [],
      invalidate: () => {},
    } as unknown as Providers,
  };
  const threads = createHarnessThreads(options);
  const host = { ...threads, fetch: asCaller(human, threads.fetch) };
  cleanups.push(async () => {
    await host.close();
    rmSync(root, { recursive: true, force: true });
  });
  const call = async (change?: object) => {
    const response = await host.fetch(
      new Request(
        "http://host/pe/threads/thread",
        change
          ? {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(change),
            }
          : {},
      ),
    );
    return { status: response.status, value: await response.json() };
  };
  return { host, call, root, options };
}

test("lifecycle transitions persist, reject stale windows, and keep the exact target", async () => {
  const { host, call, root, options } = fixture();
  const scope = { kind: "open", ref: { session: "exact/session", openId: "exact/open" } };
  await host.fetch(
    new Request("http://host/pe/scope/thread", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultTarget: scope,
        expectedRevision: 0,
        displayLabel: "Operations.rvt",
      }),
    }),
  );
  expect((await call({ expectedRevision: 0, pinned: true })).status).toBe(200);
  expect((await call({ expectedRevision: 0, status: "settled" })).status).toBe(409);
  const settled = await call({ expectedRevision: 1, status: "settled" });
  expect(settled.value.lifecycle).toMatchObject({
    pinned: false,
    status: "settled",
    snoozedUntil: null,
    revision: 2,
  });
  const pinned = await call({ expectedRevision: 2, pinned: true });
  expect(pinned.value.lifecycle.status).toBe("active");
  expect(pinned.value.head).toMatchObject({
    defaultTarget: scope,
    displayLabel: "Operations.rvt",
    revision: 1,
  });
  await host.close();
  const reopened = createHarnessThreads(options);
  expect(
    (await (await reopened.fetch(new Request("http://host/pe/threads/thread"))).json()).lifecycle,
  ).toMatchObject({ pinned: true, revision: 3 });
  expect(
    JSON.parse(readFileSync(join(root, "thread", "meta.json"), "utf8")).head.defaultTarget,
  ).toEqual(scope);
  await reopened.close();
});

test("read watermark is monotonic; rename neither wakes snooze nor creates unread activity", async () => {
  const event: HarnessEvent = {
    kind: "turn_end",
    turnId: "done",
    stopReason: "end_turn",
    seq: 1,
    at: "2026-10-01T00:00:00.000Z",
  };
  const { call } = fixture([event]);
  await call({ expectedRevision: 0, readSeq: 1 });
  await call({ expectedRevision: 0, readSeq: 0 });
  expect((await call()).value.lifecycle.readSeq).toBe(1);
  expect((await call({ expectedRevision: 0, readSeq: 99 })).status).toBe(400);
  await call({ expectedRevision: 0, snoozedUntil: "2099-10-11T12:00:00.000Z" });
  const renamed = await call({ title: "Renamed" });
  expect(renamed.value.lifecycle.snoozedUntil).toBe("2099-10-11T12:00:00.000Z");
  expect(renamed.value.activity.lastSeq).toBe(1);
});

test("restart recovery expires asks; archive and restore keep history", async () => {
  const event: HarnessEvent = {
    kind: "question_request",
    turnId: null,
    requestId: "ask",
    message: "Choose",
    requestedSchema: {},
    seq: 1,
    at: "2026-10-01T00:00:00.000Z",
  };
  // Recovery expires the unresolved ask; write it into the fixture's next host after checking recovery.
  const { call, root } = fixture([event]);
  const recovered = (await call()).value;
  expect(recovered.activity.pending).toBe(0);
  const before = readFileSync(join(root, "thread", "events.jsonl"), "utf8");
  expect((await call({ expectedRevision: 0, status: "archived" })).status).toBe(200);
  expect(readFileSync(join(root, "thread", "events.jsonl"), "utf8")).toBe(before);
  expect((await call({ expectedRevision: 1, status: "active" })).status).toBe(200);
});

test("stale automatic reads preserve a newer explicit unread choice", async () => {
  const { call } = fixture([
    {
      kind: "turn_end",
      turnId: "done",
      stopReason: "end_turn",
      seq: 1,
      at: "2026-10-01T00:00:00.000Z",
    },
  ]);
  await call({ expectedRevision: 0, readSeq: 1 });
  await call({ expectedRevision: 0, explicitUnread: true });
  expect((await call({ expectedRevision: 0, readSeq: 1 })).status).toBe(409);
  expect((await call()).value.lifecycle).toMatchObject({
    revision: 1,
    readSeq: 1,
    explicitUnread: true,
  });
  expect((await call({ expectedRevision: 1, readSeq: 1 })).value.lifecycle).toMatchObject({
    revision: 2,
    explicitUnread: false,
  });
});

test("a real prompt reopens settled work with a new anchor; active prompts retain it", async () => {
  const { host, call } = fixture();
  await call({ expectedRevision: 0, status: "settled" });
  const send = () =>
    host.fetch(
      new Request("http://host/pe/threads/thread/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: randomUUID(), text: "Continue" }),
      }),
    );
  await send();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const reopened = (await call()).value.lifecycle;
  expect(reopened).toMatchObject({ status: "active", settledAt: null });
  expect(reopened.reopenedAt).not.toBeNull();
  await send();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect((await call()).value.lifecycle.reopenedAt).toBe(reopened.reopenedAt);
});

test("an opted-in old conversation does not auto-settle immediately after reopening", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
  const { call } = fixture();
  await call({ expectedRevision: 0, status: "settled", autoSettle: "1d" });
  await call({ expectedRevision: 1, status: "active" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await call()).value.lifecycle.status).toBe("active");
});

test("the threads Reading projects scope and lifecycle changes for an off-thread reader", async () => {
  const { host, call } = fixture();
  vi.useFakeTimers();
  const seen: string[] = [];
  const release = host.observe({ kind: "threads" }, (frame) => seen.push(JSON.stringify(frame)))!;
  expect(seen.at(-1)).toContain('"pinned":false');
  await call({ expectedRevision: 0, pinned: true });
  await vi.advanceTimersByTimeAsync(100);
  expect(seen.at(-1)).toContain('"pinned":true');
  release();
});
