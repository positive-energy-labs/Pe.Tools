import { afterEach, expect, test, vi } from "vite-plus/test";
import { address, canonicalRouteInput, type Caller } from "@pe/agent-contracts";
import { Deferred, Effect } from "effect";
import { settle } from "./effect-test.ts";
import { human, pea } from "./callers.ts";
import { RequestIdentity, admittedRequestIdentity } from "../src/request-services.ts";
import { HOST_RPC_BRIDGE_SESSION_HEADER, HOST_RPC_DOCUMENT_HEADER } from "@pe/host-contracts/operation-types";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { nativeFixture } from "./fans-native.fixture.ts";
import { presentLosses } from "../../web/src/ducts/reviews.ts";
import { snapshot } from "../../web/src/ducts/test-fixture.ts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import rosterCapture from "../../../packages/host-contracts/src/fixtures/k2-roster.json" with { type: "json" };
import fanCapture from "../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json" with { type: "json" };
import { withInvocationContext } from "@pe/runtime/context";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";

const closes: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
const fixture = async (snapshotFor?: Parameters<typeof nativeFixture>[1]) => {
  const f = await nativeFixture("test", snapshotFor);
  closes.push(() => f.close());
  return f;
};
async function stage(f: Awaited<ReturnType<typeof nativeFixture>>) {
  const staged = await f.saved.apply(
    { ...f.key, route: "fans" },
    "fans",
    "human",
    [
      { path: ["flows", "4", "edit"], value: { value: { cfm: 250 } } },
      { path: ["parameters", "terminalFlow", "edit"], value: { value: "PE_M_Grd_AirFlow" } },

    ],
    0,
  );
  if (!staged.ok) throw Error(JSON.stringify(staged));
  const ducts = await f.saved.apply(f.key, "ducts", "human", [{ path: ["writeIntent", "edit"], value: { value: { groups: ["g1"] } } }], 0);
  if (!ducts.ok) throw Error(JSON.stringify(ducts));
  return { key: f.key, revision: ducts.revision };
}
async function command(
  f: Awaited<ReturnType<typeof nativeFixture>>,
  id: string,
  key: string,
  work: unknown,
  caller?: Caller,
) {
  const response = await f.post("/actions", { id, key, target: f.target, input: { work } }, caller);
  if (!response.ok)
    throw Error(`Fixture command ${key}: ${response.status} ${await response.text()}`);
}

test("fixture HTTP roster uses the real sheet service and strict open-document inventory", async () => {
  const roster = nativeResponseSchema("ducts.snapshot.walk").parse(rosterCapture);
  const fan = nativeResponseSchema("ducts.snapshot.walk").parse(fanCapture);
  const f = await fixture((key) => (key === "ducts.snapshot.roster" ? roster : fan));
  const frames: unknown[] = [];
  const release = f.observeHostResource(
    { kind: "ducts-snapshot", target: f.target.ref, selector: { kind: "roster" } },
    (frame) => frames.push(frame),
  );
  const response = await f.api.fetch(
    new Request("http://fixture/pe/ducts/roster", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: f.target.ref }),
    }),
  );
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.rows.length).toBeGreaterThan(0);
  const muas = body.rows.find((row: { mark: string }) => row.mark === "MUAS-1");
  expect(muas).toBeDefined();
  const sheet = await f.api.fetch(
    new Request("http://fixture/pe/ducts/sheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: f.target.ref,
        mode: "fan",
        unitId: muas.unitId,
        portIndex: muas.portIndex,
      }),
    }),
  );
  const opened = await sheet.json();
  expect(sheet.status, JSON.stringify(opened)).toBe(200);
  expect(opened.fan.mark).toBe("MUAS-1");
  const edit = await withInvocationContext({ caller: { kind: "human", via: "local" } }, () =>
    f.api.fetch(
      new Request(
        peRouteUrl(
          "work.apply",
          {
            params: { route: "fans" },
            query: { open: `${f.target.ref.session}/${f.target.ref.openId}` },
          },
          "http://fixture",
        ),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            press: "http-inputs",
            kind: "apply",
            label: "Fan slot and flow",
            expectedRevision: 0,
            patches: [
              {
                path: ["parameters", "fanFlow"],
                value: { edit: { value: "PE_M_Fan_AirFlowMax" } },
              },
              {
                path: ["equipmentFlows", String(muas.unitId)],
                value: { edit: { value: { cfm: 900 } } },
              },
            ],
          }),
        },
      ),
    ),
  );
  expect(edit.status, JSON.stringify(await edit.json())).toBe(200);
  const sheetRequest = {
    target: f.target.ref,
    mode: "fan",
    unitId: muas.unitId,
    portIndex: muas.portIndex,
  };
  const next = await f.api.fetch(
    new Request("http://fixture/pe/ducts/sheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sheetRequest),
    }),
  );
  const latest = await next.json();
  expect(next.status, JSON.stringify(latest)).toBe(200);
  const inputs = await f.api.fetch(
    new Request("http://fixture/pe/ducts/sheet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...sheetRequest, basis: latest.basis, detail: { kind: "inputs" } }),
    }),
  );
  const detail = await inputs.json();
  expect(inputs.status, JSON.stringify(detail)).toBe(200);
  expect(detail.inputs.units[String(muas.unitId)].cfm.value).toBe(900);
  expect(Object.keys(detail.inputs.components).length).toBeGreaterThan(0);
  await vi.waitFor(() =>
    expect(frames).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "snapshot",
          value: expect.objectContaining({ version: expect.any(String) }),
        }),
      ]),
    ),
  );
  release();
});

test.each(["human", "pea"] as const)("D03/C07: %s plan shares admitted inputs, preserves Work and commits only its scope", async (actor) => {
  const f = await fixture();
  const work = await stage(f);
  const caller = actor === "human" ? human : pea("plan-inputs");
  const fans = (await f.saved.view({ ...f.key, route: "fans" }, "fans"))!;
  const held = await settle(Deferred.make<void>());
  closes.push(() => settle(Deferred.succeed(held, undefined).pipe(Effect.asVoid)));
  f.readPause.key = "ducts.snapshot.walk";
  f.readPause.wait = Deferred.await(held);
  const before = [...f.native];
  await command(f, "preview", "ducts.plan-losses", work, caller);
  await vi.waitFor(() => expect(f.dispatched.filter((row) => row.key === "ducts.snapshot.walk")).toHaveLength(1));
  const pending = f.dispatched.find((row) => row.key === "ducts.snapshot.walk")!;
  const scope = { bridgeSessionId: f.target.ref.session, openDocumentId: f.target.ref.openId };
  const descriptor = await settle(f.rootReads.native!.resolve({ key: pending.key, input: pending.input, scope }).pipe(
    Effect.provideService(RequestIdentity, admittedRequestIdentity(caller, scope)),
  ));
  expect(descriptor).toMatchObject({
    operationKey: pending.key,
    normalizedInput: canonicalRouteInput(pending.input),
    processIncarnation: { pid: 42, startedAt: 1000 },
    openDocumentLifetime: { openId: f.target.ref.openId },
  });
  const sibling = f.request(new Request("http://fixture/call", {
    method: "POST",
    headers: { "content-type": "application/json", [HOST_RPC_BRIDGE_SESSION_HEADER]: scope.bridgeSessionId, [HOST_RPC_DOCUMENT_HEADER]: scope.openDocumentId },
    body: JSON.stringify({ key: pending.key, request: pending.input }),
  }), human);
  await vi.waitFor(async () => expect(await settle(f.rootReads.shared!.retained)).toMatchObject({ entries: 1, joiners: 2 }));
  await settle(Deferred.succeed(held, undefined));
  const shared = await sibling;
  expect(shared.status, await shared.clone().text()).toBe(200);
  expect(shared.headers.get("x-pe-native-request-id")).toBe(pending.requestId);
  expect(f.dispatched.filter((row) => row.key === pending.key)).toHaveLength(1);
  const preview = await f.journal.wait("preview");
  if (preview.state !== "succeeded") throw Error(JSON.stringify(preview));
  expect(preview.caller).toEqual(caller);
  expect(f.nativeCallers.length).toBeGreaterThanOrEqual(3);
  for (const identity of f.nativeCallers) {
    expect(identity.caller).toEqual(caller);
    expect(identity.scope).toEqual(scope);
    expect(identity.ownership.causalParent).toBe("preview");
    expect(identity.ownership.owner).toBe(identity.requestId);
  }
  expect(new Set(f.nativeCallers.map((identity) => identity.requestId)).size).toBe(f.nativeCallers.length);
  expect((await f.saved.view(f.key, "ducts"))?.handle).toEqual(work);
  expect((await f.saved.view({ ...f.key, route: "fans" }, "fans"))?.handle).toEqual(fans.handle);
  expect([...f.native]).toEqual(before);
  const words = presentLosses(preview.result, { readings: { ducts: { value: snapshot } } });
  expect(words.rows.join(" ")).toContain("250 cfm");
  expect(words.rows.join(" ")).toContain("PE_M_Grd_AirFlow");
  expect(words.rows.join(" ")).toContain("grille");
  await command(f, "commit", "ducts.apply-losses", work);
  const receipt = await f.journal.wait("commit");
  expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
  expect(f.native.get(4)).toBe(250);
  expect(f.native.get(999)).toBe(777);
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toHaveLength(1);
});

test("a changed SDK incarnation between plan input reads refuses without applying or retiring Work", async () => {
  const f = await fixture();
  const work = await stage(f);
  const held = await settle(Deferred.make<void>());
  closes.push(() => settle(Deferred.succeed(held, undefined).pipe(Effect.asVoid)));
  f.readPause.key = "ducts.snapshot.walk";
  f.readPause.wait = Deferred.await(held);
  await command(f, "scope-changed", "ducts.plan-losses", work);
  await vi.waitFor(() => expect(f.dispatched.filter((row) => row.key === "ducts.snapshot.walk")).toHaveLength(1));
  f.sdkInput.read = async (args = []) => (await sdkSessions(args)).replaceAll("1970-01-01T00:00:01.0000000Z", "1970-01-01T00:00:02.0000000Z");
  await settle(Deferred.succeed(held, undefined));
  const result = await f.journal.wait("scope-changed");
  expect(result, JSON.stringify(result)).toMatchObject({ state: "failed", notDispatched: true });
  expect(JSON.stringify(result)).toMatch(/incarnation|process|attachment/i);
  expect(f.dispatched.filter((row) => row.key === "ducts.tables" || row.key === "ducts.apply")).toEqual([]);
  expect((await f.saved.view(f.key, "ducts"))?.handle).toEqual(work);
  expect(f.native.get(4)).toBe(200);
});

test.each(["reject", "deadline"] as const)(
  "W11: real Pea %s controls the admitted sealed write",
  async (mode) => {
    const f = await fixture();
    const work = await stage(f);
    await command(f, "preview", "ducts.plan-losses", work);
    expect((await f.journal.wait("preview")).state).toBe("succeeded");
    const run = { thread: `fans-${mode}`, turn: "one" };
    f.runs.open(run);
    const caller: Caller = {
      kind: "pea",
      context: "fixture-minted",
      thread: run.thread,
      run,
      root: run,
    };
    await command(f, "pea-commit", "ducts.apply-losses", work, caller);
    await vi.waitFor(() =>
      expect(f.events.some((event) => event.kind === "permission_request")).toBe(true),
    );
    const ask = f.events.findLast((event) => event.kind === "permission_request")!;
    if (ask.kind !== "permission_request") throw Error("No consent request");
    expect(f.native.get(4)).toBe(200);
    if (mode === "reject") f.runs.decide(run.thread, ask.requestId, "stop_writes");
    await f.advance(60_000);
    const receipt = await f.journal.wait("pea-commit");
    if (mode === "reject") {
      expect(receipt.state).not.toBe("succeeded");
      expect(f.native.get(4)).toBe(200);
      expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
    } else {
      expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
      expect(receipt.consent).toMatchObject({ decision: { by: "deadline" } });
      expect(f.native.get(4)).toBe(250);
    }
    expect(f.native.get(999)).toBe(777);
  },
);


test("a Plan the native Read refuses settles refused, dispatched and without model writes", async () => {
  const f = await fixture();
  const work = await stage(f);
  f.planRefusal.reason = "Shared type 'Grille 24x24' is used outside this scope";
  await command(f, "refused-plan", "ducts.plan-losses", work);
  const receipt = await f.journal.wait("refused-plan");
  expect(receipt, JSON.stringify(receipt)).toMatchObject({
    state: "failed",
    refusal: { kind: "domain", code: "ducts.plan-refused" },
    outcome: { state: "refused", reason: expect.stringContaining("Shared type") },
    steps: [{ kind: "native", key: "ducts.apply.plan", effect: "Read", state: "succeeded", dispatchedAt: expect.any(String) }],
  });
  expect(receipt).not.toHaveProperty("notDispatched");
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
  expect(f.native.get(4)).toBe(200);
  expect((await f.saved.view(f.key, "ducts"))?.revision).toBe(work.revision);
});

test("a stale Fans revision refuses sealed apply before native dispatch", async () => {
  const f = await fixture();
  const work = await stage(f);
  await command(f, "preview-two", "ducts.plan-losses", work);
  expect(await f.journal.wait("preview-two")).toMatchObject({ state: "succeeded", result: { seal: { work: {
    consumed: expect.arrayContaining(["ducts", "fans"].map((route) => expect.objectContaining({
      kind: "work", probe: expect.objectContaining({ handle: expect.objectContaining({ key: expect.objectContaining({ route }) }) }),
    }))),
  } } } });
  const fansKey = { ...f.key, route: "fans" };
  const fans = await f.saved.view(fansKey, "fans");
  if (!fans) throw Error("Fans Work missing");
  const changed = await f.saved.apply(fansKey, "fans", "human", [
    { path: ["flows", "4", "edit"], value: { value: { cfm: 300 } } },
  ], fans.revision);
  expect(changed.ok).toBe(true);
  await f.post("/actions", { id: "stale-fans", key: "ducts.apply-losses", target: f.target,
    input: { work, readWorks: { fans: { key: fansKey, revision: fans.revision } } },
  });
  const receipt = await f.journal.wait("stale-fans");
  expect(receipt).toMatchObject({ state: "failed", notDispatched: true, refusal: { kind: "stale_revision" } });
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
  expect(f.native.get(4)).toBe(200);
  await command(f, "changed-fans", "ducts.apply-losses", work);
  const changedSeal = await f.journal.wait("changed-fans");
  expect(changedSeal).toMatchObject({ state: "failed", notDispatched: true,
    refusal: { kind: "domain", code: "preview.stale" } });
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
});

test("H1: a canonical Fans handle beside an Address key carrying case and Save As from is the same document", async () => {
  const f = await nativeFixture("test", undefined, address("C:/model.rvt"));
  closes.push(() => f.close());
  const work = await stage(f);
  expect(work.key).toMatchObject({ binding: "address", from: expect.anything() });
  const fans = (await f.saved.view({ ...f.key, route: "fans" }, "fans"))!.handle;
  const plan = async (id: string, handle: typeof fans) => {
    await f.post("/actions", { id, key: "ducts.plan-losses", target: f.target, input: { work, readWorks: { fans: handle } } });
    return f.journal.wait(id);
  };
  const same = await plan("same", fans);
  expect(same, JSON.stringify(same)).toMatchObject({ state: "succeeded" });
  const foreign = await plan("foreign", { ...fans, key: { binding: "address", route: "fans", target: address("C:/other.rvt") } });
  expect(JSON.stringify(foreign)).toContain("Fans Work belongs to another document");
});
