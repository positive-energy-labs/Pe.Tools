import { sdkSessions } from "./native-receipt-fixture.ts";
import { partitionFixture } from "./partition-fixture.ts";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { expect, test, vi } from "vite-plus/test";
import {
  actionReceiptSchema,
  actionStepSchema,
  executionTargetSchema,
  takeoffDecisionKey,
  transitionPatches,
} from "@pe/agent-contracts";
import { makeCallRoute } from "../src/call-route.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
const target = { session: "bridge-a", openId: "open-a" };
async function http(dir: string, owner: ActionJournal, invoke: RevitBridge["Service"]["invoke"]) {
  const fixture = await partitionFixture(dir, target);
  const web = HttpRouter.toWebHandler(
    makeCallRoute(owner, fixture.captures, { workspace: fixture.workspace, sdk: sdkSessions }).pipe(
      Layer.provideMerge(
        Layer.succeed(RevitBridge, {
          invoke: (
            key: string,
            ...args: Parameters<RevitBridge["Service"]["invoke"]> extends [string, ...infer Rest]
              ? Rest
              : never
          ) =>
            key === "takeoffs.initialize-carrier"
              ? Effect.succeed({
                  value: { remaining: [] },
                  target: { session: target.session, document: null },
                })
              : invoke(key, ...args),
          list: Effect.succeed([
            {
              sessionId: target.session,
              processId: 42,
              processStartUtcUnixMs: 1000,
              state: {
                openDocuments: [
                  { openId: target.openId, address: fixture.at, isFamilyDocument: false },
                ],
              },
            },
          ]),
        } as unknown as RevitBridge["Service"]),
      ),
    ),
    { disableLogger: true },
  );
  return {
    ...fixture,
    dispose: () => web.dispose(),
    post: (body: unknown) =>
      web.handler(
        new Request("http://host/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        Context.empty() as never,
      ),
    read: (id: string) =>
      web.handler(new Request(`http://host/actions?id=${id}`), Context.empty() as never),
  };
}
test("semantic partition survives lost acceptance; retries join with original reviewed inputs while Work edits remain independent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "partition-semantic-"));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const invoke = vi.fn(() =>
    Effect.promise(async () => {
      await held;
      return {
        value: { geometry: [1, 2, 3] },
        target: { session: target.session, document: null },
      };
    }),
  );
  const owner = new ActionJournal(join(dir, "journal.json"));
  const web = await http(dir, owner, invoke);
  try {
    // Acceptance is deliberately discarded: the caller recovers by its original body/ID.
    await web.post(web.intent("held"));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce());
    expect(await (await web.read("held")).json()).toMatchObject([
      { id: "held", state: "running", destination: { kind: "document", ref: target } },
    ]);
    expect((await web.post(web.intent("held"))).status).toBe(202);
    expect(
      (
        await web.post({
          ...web.intent("held"),
          input: { ...web.intent("held").input, zoneRegion: 42 },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await web.post({
          ...web.intent("held"),
          destination: { kind: "document", ref: { ...target, openId: "reopened" } },
        })
      ).status,
    ).toBe(409);
    expect((await web.post(web.intent("second-pane"))).status).toBe(409);
    await web.workspace.apply(
      web.scope,
      "takeoffs",
      "human",
      transitionPatches(
        ["decisions"],
        takeoffDecisionKey("room-1", "seedless"),
        {},
        {
          kind: "stage",
          rung: { value: "accept" },
        },
      ),
      1,
    );
    release();
    expect(await owner.wait("held")).toMatchObject({
      state: "succeeded",
      result: { value: { geometry: [1, 2, 3] } },
    });
    expect((await web.workspace.read(web.scope, "takeoffs"))?.revision).toBe(2);
    expect((await web.post(web.intent("held"))).status).toBe(200);
    expect(invoke).toHaveBeenCalledOnce();
    const next = web.intent("intentional-next");
    next.bases.work.revision = 2;
    await web.post(next);
    expect((await owner.wait(next.id)).state).toBe("succeeded");
    expect(invoke).toHaveBeenCalledTimes(2);
  } finally {
    release();
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
test("semantic partition completion disk loss reconstructs unknown and never repeats its original native effect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "partition-disk-"));
  const path = join(dir, "journal.json");
  const owner = new ActionJournal(path);
  const invoke = vi.fn(() =>
    Effect.promise(async () => {
      await mkdir(`${path}.tmp`);
      return { value: { executed: true }, target: { session: target.session, document: null } };
    }),
  );
  const web = await http(dir, owner, invoke);
  try {
    await web.post(web.intent("lost"));
    await expect(owner.wait("lost")).rejects.toThrow();
    expect(await owner.list()).toMatchObject([
      { state: "unknown", steps: [{ state: "succeeded" }, { state: "unknown" }] },
    ]);
    expect(JSON.parse(await readFile(path, "utf8")).actions[0].state).toBe("running");
    await rm(`${path}.tmp`, { recursive: true });
    const restored = new ActionJournal(path);
    const second = await http(dir, restored, invoke);
    try {
      expect(await (await second.read("lost")).json()).toMatchObject([{ state: "unknown" }]);
      expect((await second.post(web.intent("lost"))).status).toBe(200);
      expect((await second.post(web.intent("new"))).status).toBe(409);
      expect(invoke).toHaveBeenCalledOnce();
    } finally {
      await second.dispose();
    }
  } finally {
    await web.dispose();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
test("receipt schema rejects impossible operation combinations", () => {
  const base = {
    id: "a",
    key: "takeoffs.partition",
    kind: "workflow" as const,
    actor: "human",
    destination: { kind: "document", ref: target },
    request: {},
    bases: {},
    steps: [],
    preparation: { state: "unprepared" },
    recovery: [],
    publication: { state: "unrequested" },
    startedAt: "now",
  };
  expect(actionReceiptSchema.safeParse({ ...base, state: "running" }).success).toBe(true);
  const step = { id: "s", key: "native", kind: "native", input: {} };
  expect(actionStepSchema.safeParse({ ...step, state: "running" }).success).toBe(true);
  expect(actionStepSchema.safeParse({ ...step, state: "running", result: {} }).success).toBe(false);
  expect(
    actionStepSchema.safeParse({
      ...step,
      state: "unknown",
      error: "lost",
      status: 503,
      notDispatched: true,
    }).success,
  ).toBe(false);
  expect(executionTargetSchema.safeParse({ kind: "host", ref: target }).success).toBe(false);
  expect(actionReceiptSchema.safeParse({ ...base, state: "succeeded" }).success).toBe(false);
  expect(actionReceiptSchema.safeParse({ ...base, state: "running", result: {} }).success).toBe(
    false,
  );
  expect(actionReceiptSchema.safeParse({ ...base, state: "unknown" }).success).toBe(false);
});
