import { afterEach, expect, test, vi } from "vite-plus/test";
import { address, type Caller } from "@pe/agent-contracts";
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

test("D03/C07: admitted losses preview is read-only, names sealed rows and commits only its scope", async () => {
  const f = await fixture();
  const work = await stage(f);
  const before = [...f.native];
  await command(f, "preview", "ducts.plan-losses", work);
  const preview = await f.journal.wait("preview");
  if (preview.state !== "succeeded") throw Error(JSON.stringify(preview));
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
