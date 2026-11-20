import { elementSubject } from "@pe/ducts-domain/work-subject";
import { closedFan } from "../../../../products/fans/host/src/tests/closed-fan.fixture.ts";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { address, canonicalRouteInput, type Caller } from "@pe/agent-contracts";
import { Deferred, Effect } from "effect";
import { settle } from "../effect-test.ts";
import { human, pea } from "../callers.ts";
import { RequestIdentity, admittedRequestIdentity } from "@pe/host-internal/request-identity";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { sdkSessions } from "../native-receipt-fixture.ts";
import { nativeFixture } from "./fans-native.fixture.ts";

const terminalSubject = elementSubject(closedFan(100).nodes.find((node) => node.id === 3)!);
const scenario = (key: string, input: unknown) =>
  key === "ducts.snapshot.walk"
    ? closedFan(100, {
        requiredEsp: (input as { slots?: { requiredEsp?: string } }).slots?.requiredEsp,
      })
    : undefined;

const closes: (() => Promise<void>)[] = [];
// The kernel's Work fence (owner ruling 2026-11-20): Work staged on one document is spent on no other.
// `selected-open` is C:/model.rvt; this Work is keyed to the other open document's Address.
test.each(["fans", "duct-systems"] as const)(
  "%s Work staged on another document refuses its plan and its write, with nothing written",
  async (route) => {
    const f = await nativeFixture("test", scenario, address("C:/other.rvt"));
    closes.push(() => f.close());
    const fans = await stage(f);
    const work =
      route === "fans" ? fans : (await f.saved.view(f.key, "duct-systems"))!.handle;
    for (const key of ["sheet.plan", "sheet.apply"]) {
      await f.post("/actions", { id: key, key, target: f.target, input: { work } });
      expect(await f.journal.wait(key)).toMatchObject({
        state: "failed",
        notDispatched: true,
        refusal: { kind: "domain", code: "work.target" },
      });
    }
    expect(f.dispatched.filter((row) => row.key.startsWith("ducts.apply"))).toEqual([]);
  },
);
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
});
const fixture = async () => {
  const f = await nativeFixture("test", scenario);
  closes.push(() => f.close());
  return f;
};
async function stage(f: Awaited<ReturnType<typeof nativeFixture>>) {
  const staged = await f.saved.apply(
    { ...f.key, route: "fans" },
    "fans",
    "human",
    [{ path: ["writeIntent", "edit"], value: { value: { walk: { unitId: 100, portIndex: 0 } } } }],
    0,
  );
  if (!staged.ok) throw Error(JSON.stringify(staged));
  const ducts = await f.saved.apply(
    f.key,
    "duct-systems",
    "human",
    [{ path: ["writeIntent", "edit"], value: { value: { groups: ["group:g8718801"] } } }],
    0,
  );
  if (!ducts.ok) throw Error(JSON.stringify(ducts));
  return { key: { ...f.key, route: "fans" }, revision: staged.revision };
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

test("recorded Fans roster traverses the real public native admission", async () => {
  const f = await fixture();
  const response = await f.request(
    new Request("http://host/call", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HOST_RPC_BRIDGE_SESSION_HEADER]: f.target.ref.session,
        [HOST_RPC_DOCUMENT_HEADER]: f.target.ref.openId,
      },
      body: JSON.stringify({
        key: "ducts.snapshot.roster",
        request: { selector: { kind: "roster" } },
      }),
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  expect(f.dispatched.map((call) => call.key)).toEqual(["ducts.snapshot.roster"]);
});

test.each(["human", "pea"] as const)(
  "D03/C07: %s plan shares admitted inputs, preserves Work and submits its derived scope",
  async (actor) => {
    const f = await fixture();
    const work = await stage(f);
    // Every Pea command belongs to an open run (ADR 0038), a plan with no effects included.
    const run = { thread: "plan-inputs", turn: "plan-turn" };
    if (actor === "pea") f.runs.open(run);
    const caller = actor === "human" ? human : { ...pea("plan-inputs"), run, root: run };
    const fans = (await f.saved.view({ ...f.key, route: "fans" }, "fans"))!;
    const held = await settle(Deferred.make<void>());
    closes.push(() => settle(Deferred.succeed(held, undefined).pipe(Effect.asVoid)));
    f.readPause.key = "ducts.snapshot.walk";
    f.readPause.wait = Deferred.await(held);
    await command(f, "preview", "sheet.plan", work, caller);
    await vi.waitFor(() =>
      expect(f.dispatched.filter((row) => row.key === "ducts.snapshot.walk")).toHaveLength(1),
    );
    const pending = f.dispatched.find((row) => row.key === "ducts.snapshot.walk")!;
    const scope = { bridgeSessionId: f.target.ref.session, openDocumentId: f.target.ref.openId };
    const descriptor = await settle(
      f.rootReads
        .native!.resolve({ key: pending.key, input: pending.input, scope })
        .pipe(Effect.provideService(RequestIdentity, admittedRequestIdentity(caller, scope))),
    );
    expect(descriptor).toMatchObject({
      operationKey: pending.key,
      normalizedInput: canonicalRouteInput(pending.input),
      processIncarnation: { pid: 42, startedAt: 1000 },
      openDocumentLifetime: { openId: f.target.ref.openId },
    });
    const sibling = f.request(
      new Request("http://fixture/call", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HOST_RPC_BRIDGE_SESSION_HEADER]: scope.bridgeSessionId,
          [HOST_RPC_DOCUMENT_HEADER]: scope.openDocumentId,
        },
        body: JSON.stringify({ key: pending.key, request: pending.input }),
      }),
      human,
    );
    await vi.waitFor(async () =>
      expect(await settle(f.rootReads.shared!.retained)).toMatchObject({ entries: 1, joiners: 2 }),
    );
    await settle(Deferred.succeed(held, undefined));
    const shared = await sibling;
    expect(shared.status, await shared.clone().text()).toBe(200);
    expect(shared.headers.get("x-pe-native-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.dispatched.filter((row) => row.key === pending.key)).toHaveLength(1);
    const preview = await f.journal.wait("preview");
    if (preview.state !== "succeeded") throw Error(JSON.stringify(preview));
    expect(preview.caller).toMatchObject(
      caller.kind === "pea" ? { kind: "pea", thread: caller.thread } : { kind: "human" },
    );
    expect((await f.saved.view(work.key, "fans"))?.handle).toEqual(work);
    expect((await f.saved.view({ ...f.key, route: "fans" }, "fans"))?.handle).toEqual(fans.handle);
    // The human must review its own Plan before applying a Pea-derived scope.
    if (actor === "pea") {
      await command(f, "human-preview", "sheet.plan", work);
      expect((await f.journal.wait("human-preview")).state).toBe("succeeded");
    }
    await command(f, "commit", "sheet.apply", work);
    const receipt = await f.journal.wait("commit");
    expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
    expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toHaveLength(1);
  },
);

test("a changed SDK incarnation between plan input reads refuses without applying or retiring Work", async () => {
  const f = await fixture();
  const work = await stage(f);
  const held = await settle(Deferred.make<void>());
  closes.push(() => settle(Deferred.succeed(held, undefined).pipe(Effect.asVoid)));
  f.readPause.key = "ducts.snapshot.walk";
  f.readPause.wait = Deferred.await(held);
  await command(f, "scope-changed", "sheet.plan", work);
  await vi.waitFor(() =>
    expect(f.dispatched.filter((row) => row.key === "ducts.snapshot.walk")).toHaveLength(1),
  );
  f.sdkInput.read = async (args = []) =>
    (await sdkSessions(args)).replaceAll(
      "1970-01-01T00:00:01.0000000Z",
      "1970-01-01T00:00:02.0000000Z",
    );
  await settle(Deferred.succeed(held, undefined));
  const result = await f.journal.wait("scope-changed");
  expect(result, JSON.stringify(result)).toMatchObject({ state: "failed", notDispatched: true });
  expect(JSON.stringify(result)).toMatch(/incarnation|process|attachment/i);
  expect(
    f.dispatched.filter((row) => row.key === "ducts.tables" || row.key === "ducts.apply"),
  ).toEqual([]);
  expect((await f.saved.view(work.key, "fans"))?.handle).toEqual(work);
});

// ADR 0038: Pea's sealed write asks nobody. The run registry still ends it: a stopped run dispatches nothing.
test.each(["stopped", "open"] as const)(
  "W11: real Pea's admitted sealed write runs with no ask in an %s run",
  async (mode) => {
    const f = await fixture();
    const work = await stage(f);
    const run = { thread: `fans-${mode}`, turn: "one" };
    f.runs.open(run);
    const caller: Caller = {
      kind: "pea",
      context: "fixture-minted",
      thread: run.thread,
      run,
      root: run,
    };
    await command(f, "preview", "sheet.plan", work, caller);
    expect((await f.journal.wait("preview")).state).toBe("succeeded");
    if (mode === "stopped") {
      f.runs.close(run, "stopped");
      await expect(command(f, "pea-commit", "sheet.apply", work, caller)).rejects.toThrow(
        /run\.closed/,
      );
      expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
    } else {
      await command(f, "pea-commit", "sheet.apply", work, caller);
      const receipt = await f.journal.wait("pea-commit");
      expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
    }
  },
);

test("a refused native Plan retains its review without Apply authority or model writes", async () => {
  const f = await fixture();
  const work = await stage(f);
  f.select("fans-accessory-missing");
  await command(f, "refused-plan", "sheet.plan", work);
  const receipt = await f.journal.wait("refused-plan");
  expect(receipt, JSON.stringify(receipt)).toMatchObject({
    state: "succeeded",
    result: { planRefusal: expect.stringContaining("not in the document") },
    steps: [
      {
        kind: "native",
        key: "ducts.apply.plan",
        state: "succeeded",
        dispatchedAt: expect.any(String),
      },
    ],
  });
  // MAP slice 7: catalog effect is scope, never terminal testimony on a step.
  expect(receipt.steps[0]).not.toHaveProperty("effect");
  expect(receipt).not.toHaveProperty("notDispatched");
  if (receipt.state !== "succeeded") throw Error(JSON.stringify(receipt));
  expect(receipt.result).toHaveProperty("planRefusal");
  await command(f, "refused-plan-apply", "sheet.apply", work);
  expect(await f.journal.wait("refused-plan-apply")).toMatchObject({
    state: "failed",
    refusal: { code: "ducts.plan-refused" },
  });
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
  expect((await f.saved.view(work.key, "fans"))?.revision).toBe(work.revision);
});

test("a stale Fans revision refuses sealed apply before native dispatch", async () => {
  const f = await fixture();
  const work = await stage(f);
  await command(f, "preview-two", "sheet.plan", work);
  expect(await f.journal.wait("preview-two")).toMatchObject({
    state: "succeeded",
    result: {
      seal: {
        work: {
          consumed: expect.arrayContaining(
            ["duct-systems", "fans"].map((route) =>
              expect.objectContaining({
                kind: "work",
                probe: expect.objectContaining({
                  handle: expect.objectContaining({ key: expect.objectContaining({ route }) }),
                }),
              }),
            ),
          ),
        },
      },
    },
  });
  const fansKey = { ...f.key, route: "fans" };
  const fans = await f.saved.view(fansKey, "fans");
  if (!fans) throw Error("Fans Work missing");
  const changed = await f.saved.apply(
    fansKey,
    "fans",
    "human",
    [{ path: ["flows", terminalSubject, "edit"], value: { value: 300 } }],
    fans.revision,
  );
  expect(changed.ok).toBe(true);
  await f.post("/actions", {
    id: "stale-fans",
    key: "sheet.apply",
    target: f.target,
    input: { work, readWorks: { fans: { key: fansKey, revision: fans.revision } } },
  });
  const receipt = await f.journal.wait("stale-fans");
  expect(receipt).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { kind: "stale_revision" },
  });
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
  await command(f, "changed-fans", "sheet.apply", {
    key: fansKey,
    revision: changed.ok ? changed.revision : -1,
  });
  const changedSeal = await f.journal.wait("changed-fans");
  expect(changedSeal).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { kind: "domain", code: "preview.stale" },
  });
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
});

test("P-096: a stale duct-systems sibling refuses sealed write before native dispatch", async () => {
  const f = await fixture();
  const work = await stage(f);
  await command(f, "sibling-plan", "sheet.plan", work);
  expect(await f.journal.wait("sibling-plan")).toMatchObject({ state: "succeeded" });
  const sibling = (await f.saved.view(f.key, "duct-systems"))!;
  const changed = await f.saved.apply(
    f.key,
    "duct-systems",
    "human",
    [{ path: ["workingPhase", "edit"], value: { value: "Existing" } }],
    sibling.revision,
  );
  expect(changed).toMatchObject({ ok: true, revision: sibling.revision + 1 });
  await f.post("/actions", {
    id: "stale-sibling",
    key: "sheet.apply",
    target: f.target,
    input: { work, readWorks: { [sibling.handle.key.route]: sibling.handle } },
  });
  expect(await f.journal.wait("stale-sibling")).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { kind: "stale_revision" },
  });
  expect(f.dispatched.filter((row) => row.key === "ducts.apply")).toEqual([]);
});

test("H1: a canonical Fans handle beside an Address key carrying case and Save As from is the same document", async () => {
  const f = await nativeFixture("test", scenario, address("C:/model.rvt"));
  closes.push(() => f.close());
  const work = await stage(f);
  expect(work.key).toMatchObject({ binding: "address", from: expect.anything() });
  const fans = (await f.saved.view({ ...f.key, route: "fans" }, "fans"))!.handle;
  const plan = async (id: string, handle: typeof fans) => {
    await f.post("/actions", {
      id,
      key: "sheet.plan",
      target: f.target,
      input: { work, readWorks: { fans: handle } },
    });
    return f.journal.wait(id);
  };
  const same = await plan("same", fans);
  expect(same, JSON.stringify(same)).toMatchObject({ state: "succeeded" });
  const foreign = await plan("foreign", {
    ...fans,
    key: { binding: "address", route: "fans", target: address("C:/other.rvt") },
  });
  // The kernel's admission fences a sibling handle to the target before Ducts compares the two.
  expect(foreign).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { code: "work.target", message: "Work belongs to another document" },
  });
});
