import { peRead, buildCapabilities } from "@pe/mcps";
import { withInvocationContext } from "@pe/runtime/context";
import { HttpRouter } from "effect/unstable/http";
import { Context } from "effect";
import { instancesReadingsRoute } from "../src/session-route.ts";
import * as machineOwner from "../src/machine.ts";
import { expect, test, vi } from "vite-plus/test";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
import { holdingsReadingSchema, discoveryMachine } from "@pe/agent-contracts";
import { readHoldings } from "../src/holdings-reading.ts";

function fixture(count = 7) {
  const machine = machineFixture([{ session: "s1", documents: null }]);
  const session = machine.revit.sessions![0]!;
  Object.assign(session, {
    documents: [{ openId: "o1" }],
    holdingsLeg: { ...machine.legs.sessions },
    holdings: [
      {
        openId: "o1",
        title: "Fixture",
        holdings: {
          elements: Array.from({ length: count }, (_, id) => ({
            id,
            category: "fixture",
            name: "HELD_SENTINEL",
            changedSinceSync: null,
            requesters: [],
          })),
          empty: false,
          savedNotSynced: null,
          unsaved: false,
          worksets: [],
          workshared: true,
        },
      },
    ],
  });
  const request = holdingsReadingSchema.parse({
    kind: "sdk",
    read: "holdings",
    session: { pid: 1 },
    processStartUtc: "2026-10-12T12:00:00.000Z",
    openId: "o1",
    limit: 3,
  });
  return { machine, session, request };
}
test("exact holdings pages cover every element once, survive observation ticks and reject changed content or targets", () => {
  const f = fixture();
  const ids: number[] = [];
  let cursor: string | undefined;
  do {
    const page = readHoldings(f.machine, { ...f.request, cursor });
    expect(page.state).toBe("ok");
    if (page.state !== "ok") throw Error(page.detail);
    ids.push(...page.rows.map((r) => (typeof r === "string" ? -1 : r.id)));
    cursor = page.nextCursor ?? undefined;
    Object.assign(f.session.holdingsLeg, { observedAtUtc: "2026-10-12T12:01:00.000Z" });
  } while (cursor);
  expect(ids).toEqual([0, 1, 2, 3, 4, 5, 6]);
  const first = readHoldings(f.machine, f.request);
  if (first.state !== "ok") throw Error(first.detail);
  Object.assign(f.session.holdings![0]!.holdings.elements[0]!, { name: "changed" });
  expect(readHoldings(f.machine, { ...f.request, cursor: first.nextCursor! })).toMatchObject({
    code: "holdings.stale-cursor",
  });
  for (const request of [
    { ...f.request, session: { pid: 2 } },
    { ...f.request, openId: "wrong" },
    { ...f.request, processStartUtc: "2026-10-12T13:00:00.000Z" },
  ])
    expect(readHoldings(f.machine, request).state).toBe("refused");
  Object.assign(f.session, { holdings: null });
  expect(readHoldings(f.machine, f.request)).toMatchObject({ code: "holdings.unavailable" });
});
test("large canonical holdings remain inspectable without entering discovery", () => {
  const f = fixture(53139);
  const projected = discoveryMachine(f.machine);
  expect(JSON.stringify(projected).includes("HELD_SENTINEL")).toBe(false);
  expect(JSON.stringify(projected).length).toBeLessThan(65536);
  const page = readHoldings(f.machine, { ...f.request, limit: 100 });
  expect(page).toMatchObject({ state: "ok", elementCount: 53139 });
  if (page.state === "ok") {
    expect(page.rows).toHaveLength(100);
    expect(page.nextCursor).toBeTruthy();
  }
  Object.assign(f.session.holdingsLeg, { error: "observation failed" });
  expect(readHoldings(f.machine, f.request)).toMatchObject({ code: "holdings.unavailable" });
  expect(discoveryMachine(f.machine).revit.sessions![0]!.holdingsLeg.error).toBe(
    "observation failed",
  );
});

test("existing Instances HTTP reading pages exact holdings and refuses a wrong document", async () => {
  const f = fixture();
  const spy = vi.spyOn(machineOwner, "currentMachine").mockReturnValue(f.machine);
  const web = HttpRouter.toWebHandler(instancesReadingsRoute, { disableLogger: true });
  const request = async (changes: Record<string, string> = {}) => {
    const query = new URLSearchParams({
      read: "holdings",
      session: JSON.stringify({ pid: 1 }),
      processStartUtc: f.request.processStartUtc,
      openId: "o1",
      limit: "3",
      section: "elements",
      ...changes,
    });
    const response = await web.handler(
      new Request(`http://fixture/instances/readings?${query}`),
      Context.empty() as never,
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  try {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).pathname === "/pe/capabilities")
        return Response.json({
          at: f.machine.observedAtUtc,
          machine: discoveryMachine(f.machine),
          sources: {},
          diagnostics: [],
          capabilities: buildCapabilities({ ops: [], routes: [], packages: [], skills: [] }),
        });
      return web.handler(req, Context.empty() as never);
    });
    const { kind: _kind, ...detailInput } = f.request;
    const viaPea = await withInvocationContext({ hostBaseUrl: "http://127.0.0.1:5180" }, () =>
      peRead.execute(peRead.inputSchema.parse({ key: "op:instances.read", input: detailInput }), {
        agent: { toolCallId: "holdings-read" },
      }),
    );
    expect(viaPea).toMatchObject({ ok: true, result: { state: "ok", total: 7, offset: 0 } });
    const first = await request();
    expect(first).toMatchObject({ state: "ok", total: 7, offset: 0 });
    const second = await request({ cursor: first.nextCursor });
    expect(second).toMatchObject({ state: "ok", offset: 3 });
    expect(second.rows.map((row: { id: number }) => row.id)).toEqual([3, 4, 5]);
    expect(await request({ openId: "wrong" })).toMatchObject({
      state: "refused",
      code: "holdings.document-missing",
    });
    expect(await request({ section: "worksets" })).toMatchObject({
      state: "ok",
      section: "worksets",
      rows: [],
      total: 0,
    });
  } finally {
    spy.mockRestore();
    vi.unstubAllGlobals();
    await web.dispose();
  }
});
