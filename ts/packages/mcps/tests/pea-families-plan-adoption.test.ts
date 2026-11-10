import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Layer, Scope } from "effect";
import { bindWork } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { markDispatched } from "../../../apps/host/src/action-dispatch.ts";
import { admittedBuiltinsLayer } from "../../../apps/host/src/admitted-builtins.ts";
import { DuctFiles } from "../../../apps/host/src/ducts-files.ts";
import { PictureCaptureStore } from "../../../apps/host/src/captures-route.ts";
import { hostOwnership } from "../../../apps/host/src/host-ownership.ts";
import { fileRouteDocumentStore } from "../../../apps/host/src/route-document-store.ts";
import { HostDocumentMarks, hostMarks } from "../../../apps/host/src/document-marks.ts";
import {
  captureStore,
  detachedBridge,
  sessionView,
  testDocumentMarks,
  journalAt,
  callRouteOver,
} from "../../../apps/host/tests/effect-test.ts";
import { sdkSessions } from "../../../apps/host/tests/native-receipt-fixture.ts";
import { serveRoutes } from "../../../apps/host/tests/real-server.ts";
import { peaTurns } from "./pea-turn.fixture.ts";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "pea-families-principal-"));
  const scope = Scope.makeUnsafe();
  const workspace = new RouteWorkspace({
    registrations: [],
    store: fileRouteDocumentStore(join(dir, "work")),
  });
  await Effect.runPromise(Layer.buildWithScope(admittedBuiltinsLayer(workspace), scope));
  const ref = { session: "B", openId: "open-B" };
  const key = bindWork("families", null, undefined, ref);
  await workspace.view(key, "families");
  await workspace.apply(
    key,
    "families",
    "human",
    [
      {
        path: ["scope", "edit"],
        value: {
          value: {
            categoryNames: ["Air Terminals"],
            familyNames: [],
            placementScope: "AllLoaded",
          },
        },
      },
    ],
    0,
  );
  const dispatched: string[] = [];
  const bridge = detachedBridge({
    list: Effect.succeed([
      sessionView({
        sessionId: "B",
        connected: true,
        processId: 43,
        processStartUtcUnixMs: 1000,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        state: { openDocuments: [{ openId: "open-B", isFamilyDocument: false }] },
      }),
    ]),
    invoke: (
      operation: string,
      _input: unknown,
      _session?: string,
      _openId?: string | null,
      id?: string,
    ) =>
      Effect.promise(async () => {
        if (id) await markDispatched(id);
        dispatched.push(operation);
        const value =
          operation === "revit.catalog.loaded-families"
            ? {
                summary: { truncated: false },
                issues: [],
                families: [
                  {
                    familyId: 1,
                    familyUniqueId: "uid-1",
                    familyName: "Diffuser",
                    categoryName: "Air Terminals",
                    typeCount: 1,
                    types: [{ typeId: 11, typeName: "24x24" }],
                    parameters: [],
                    issues: [],
                    isPartial: false,
                    placedInstanceCount: 0,
                  },
                ],
              }
            : operation === "families.plan"
              ? {
                  diagnostics: [],
                  families: [
                    {
                      familyId: 1,
                      familyName: "Diffuser",
                      planHash: "reviewed-plan",
                      changes: [],
                      runEffects: ["Set Model"],
                      refusals: [],
                      warnings: [],
                    },
                  ],
                }
              : operation === "families.apply"
                ? {
                    diagnostics: [],
                    receipts: [
                      {
                        familyId: 1,
                        familyName: "Diffuser",
                        success: true,
                        converged: true,
                        residue: [],
                        errors: [],
                      },
                    ],
                  }
                : (() => {
                    throw Error(`Unexpected native dispatch ${operation}`);
                  })();
        return { target: { session: "B", document: null }, value };
      }),
  });
  const journal = journalAt(join(dir, "actions.jsonl"), Date.now);
  const server = await serveRoutes(
    callRouteOver(journal, captureStore(join(dir, "captures")), {
      sdk: sdkSessions,
      workspace,
      podsRoot: dir,
    }).pipe(
      Layer.provide(DuctFiles.layer()),
      Layer.provide(PictureCaptureStore.layer()),
      Layer.provide(Layer.succeed(HostDocumentMarks, hostMarks(testDocumentMarks(bridge)))),
    ),
    bridge,
  );
  const turns = peaTurns();
  onTestFinished(async () => {
    await journal.close();
    await server.close();
    await Effect.runPromise(Scope.close(scope, Exit.void));
    await rm(dir, { recursive: true, force: true });
  });
  const source = {
    path: "edit/diffuser.json",
    content: JSON.stringify({ family: { name: "Diffuser" } }),
  };
  const stage = async (value: object) => {
    const view = (await workspace.view(key, "families"))!;
    expect(
      await workspace.apply(
        key,
        "families",
        "human",
        [
          {
            path: ["writeIntent", "families.apply", "edit"],
            value: { value },
          },
        ],
        view.revision,
      ),
    ).toMatchObject({ ok: true });
  };
  const invoke = async (id: string, token: string, command: string, extra = {}) => {
    const work = (await workspace.view(key, "families"))!.handle;
    const response = await fetch(`${server.base}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-pe-context": token },
      body: JSON.stringify({
        id,
        key: command,
        target: { kind: "document", ref },
        input: { work, ...extra },
      }),
    });
    expect(response.ok, await response.clone().text()).toBe(true);
    return journal.wait(id);
  };
  return { ...turns, source, stage, invoke, dispatched, journal };
}

test("Families HTTP apply refuses adoption of a foreign Pea thread's plan before dispatch", async () => {
  const f = await fixture();
  const author = f.newTurn("plan-author");
  expect(
    await f.invoke("foreign-plan", author.token, "families.plan", { source: f.source }),
  ).toMatchObject({ state: "succeeded" });
  const other = f.newTurn("applying-thread");
  // Own outer preview gets through the generic caller gate. Direct adoption must still reject the foreign plan.
  await f.stage({ source: f.source });
  expect(await f.invoke("own-preview", other.token, "families.apply.preview")).toMatchObject({
    state: "succeeded",
  });
  await f.stage({ plan: "foreign-plan" });
  const before = f.dispatched.length;
  const refused = await f.invoke("foreign-apply", other.token, "families.apply");
  expect(refused, JSON.stringify(refused)).toMatchObject({
    state: "failed",
    refusal: { code: "preview.caller" },
    steps: [],
    notDispatched: true,
  });
  expect(f.dispatched.slice(before)).toEqual([]);
});

test("Families HTTP apply adopts the same Pea thread's plan in the next minted turn", async () => {
  const f = await fixture();
  const first = f.newTurn("reviewed-family");
  const plan = await f.invoke("reviewed-plan", first.token, "families.plan", { source: f.source });
  expect(plan, JSON.stringify(plan)).toMatchObject({ state: "succeeded" });
  await f.stage({ plan: "reviewed-plan" });
  expect(await f.invoke("reviewed-preview", first.token, "families.apply.preview")).toMatchObject({
    state: "succeeded",
  });
  const next = f.newTurn("reviewed-family");
  const applying = f.invoke("next-turn-apply", next.token, "families.apply");
  await vi.waitFor(async () => {
    const receipt = (await f.journal.list()).find((row) => row.id === "next-turn-apply");
    if (receipt?.state === "failed") throw Error(JSON.stringify(receipt));
    expect(f.runs.commandWindow("next-turn-apply")).toBeDefined();
  });
  f.runs.decide(next.run.thread, f.runs.commandWindow("next-turn-apply")!.requestId, "allow_now");
  const applied = await applying;
  expect(applied, JSON.stringify(applied)).toMatchObject({
    state: "succeeded",
    result: { native: { receipts: [{ familyId: 1, success: true }] } },
  });
  if (applied.caller.kind !== "pea" || plan.caller.kind !== "pea")
    throw Error("Expected Pea callers for cross-turn family adoption");
  expect(applied.caller.context).not.toBe(plan.caller.context);
  expect(applied.caller.run).toEqual(next.run);
  expect(f.dispatched.filter((operation) => operation === "families.apply")).toHaveLength(1);
  const reused = await f.invoke("reused-plan-apply", next.token, "families.apply");
  expect(reused).toMatchObject({
    state: "failed",
    refusal: { kind: "claimed", by: "next-turn-apply" },
  });
  expect(f.dispatched.filter((operation) => operation === "families.apply")).toHaveLength(1);
});

// R7's owner claim must survive the generic boundary independently of the outer preview claim.
test("R7 Families HTTP applies reserve the adopted Plan across distinct outer previews", async () => {
  const f = await fixture();
  const turn = f.newTurn("exclusive-family");
  expect(
    await f.invoke("exclusive-plan", turn.token, "families.plan", { source: f.source }),
  ).toMatchObject({ state: "succeeded" });
  await f.stage({ plan: "exclusive-plan" });
  expect(await f.invoke("first-preview", turn.token, "families.apply.preview")).toMatchObject({
    state: "succeeded",
  });
  const before = f.dispatched.length;
  const first = f.invoke("first-apply", turn.token, "families.apply");
  let second: ReturnType<typeof f.invoke> | undefined;
  try {
    await vi.waitFor(() => expect(f.runs.commandWindow("first-apply")).toBeDefined());
    // A new read-only preview must not reserve the inner plan; its later Apply must.
    expect(await f.invoke("second-preview", turn.token, "families.apply.preview")).toMatchObject({
      state: "succeeded",
    });
    second = f.invoke("second-apply", turn.token, "families.apply");
    await vi.waitFor(async () =>
      expect((await f.journal.list()).find((row) => row.id === "second-apply")).toBeDefined(),
    );
    const rows = (await f.journal.list()).filter((row) =>
      ["first-apply", "second-apply"].includes(row.id),
    );
    expect(rows.filter((row) => row.refusal?.kind === "claimed")).toHaveLength(1);
    expect(rows.find((row) => row.id === "second-apply")).toMatchObject({
      state: "failed",
      notDispatched: true,
      steps: [],
      refusal: {
        kind: "claimed",
        by: "first-apply",
        claim: { kind: "receipt", id: "exclusive-plan" },
      },
    });
    expect(f.dispatched.slice(before)).toEqual([]);
    expect(f.dispatched.filter((operation) => operation === "families.apply")).toHaveLength(0);
    f.runs.decide(turn.run.thread, f.runs.commandWindow("first-apply")!.requestId, "allow_now");
    expect(await first).toMatchObject({ state: "succeeded" });
    expect(await second).toMatchObject({ state: "failed", refusal: { kind: "claimed" } });
    expect(f.dispatched.filter((operation) => operation === "families.apply")).toHaveLength(1);
  } finally {
    f.runs.closeAll();
    await Promise.allSettled([first, ...(second ? [second] : [])]);
  }
});
