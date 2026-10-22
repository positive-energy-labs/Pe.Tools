import { asCaller, human } from "./callers.ts";
import { HostLog } from "../src/host-log.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
