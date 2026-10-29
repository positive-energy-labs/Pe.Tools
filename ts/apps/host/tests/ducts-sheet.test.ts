import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RouteWorkspace } from "@pe/runtime";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { existsSync, readFileSync } from "node:fs";
import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import {
  DUCTS_BODY_VERSION_HEADER,
  bindWork,
  ductsRouteState,
  addressSchema,
  ductsRosterResponseSchema,
  ductsSheetOverviewSchema,
  ductsSheetResponseSchema,
} from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { DuctsSheetSources } from "../src/ducts-sheet.ts";
import { createPeRoutes } from "../src/pe-routes.ts";
import { DuctsReadings } from "../src/ducts-readings.ts";
import type { RevitBridge } from "../src/bridge.ts";

const retained =
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-raw.json";

test.skipIf(!existsSync(retained))(
  "MUAS-1 sheet route is bounded and detail is cached, subject-bound and invalidated",
  async () => {
    const raw = JSON.parse(readFileSync(retained, "utf8").replace(/^\uFEFF/, ""));
    const snapshot = (raw.result ?? raw) as DuctSnapshot;
    const target = { session: "retained-chadds", openId: "chadds-open" };
    const owner = new DuctsReadings();
    const requests: unknown[] = [];
    const bridge = {
      invoke: (key: string, request: unknown) =>
        Effect.sync(() => {
          expect(["ducts.snapshot", "ducts.tables"]).toContain(key);
          requests.push(request);
          return {
            value:
              key === "ducts.snapshot" ? snapshot : { tables: {}, missing: [], unsupported: [] },
            target: { session: target.session, document: "Chadds", documentRef: target },
          };
        }),
    } as unknown as RevitBridge["Service"];
    const routes = createPeRoutes({
      registrations: [],
      heads: { observe: () => () => {} },
      store: {
        getState: async () => null,
        setState: async () => {
          throw Error("No Work writes expected");
        },
      },
      ductsSheets: {
        call: async (key, request, target, version) => {
          const reading =
            "selector" in request
              ? { kind: "ducts-snapshot" as const, target, ...request }
              : { kind: "ducts-tables" as const, session: target.session, ...request };
          const body = await owner.read(
            reading,
            async () => ({
              ...(await Effect.runPromise(
                bridge.invoke(key, request, target.session, target.openId),
              )),
              nativeRequestId: `snapshot-${requests.length}`,
            }),
            { version },
          );
          return new Response(body.json, {
            headers: { [DUCTS_BODY_VERSION_HEADER]: body.version },
          });
        },
      },
    });
    const post = (route: "sheet" | "roster", body: unknown) =>
      routes.fetch(
        new Request(`http://host/pe/ducts/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const cold = ductsRosterResponseSchema.parse(await (await post("roster", { target })).json());
    const fan = cold.rows.find((row) => row.unitId === 14577391)!;
    expect(fan).toMatchObject({ mark: "MUAS-1", portIndex: 2, confirmed: false });
    expect(fan).not.toHaveProperty("blockerCount");
    expect(fan).not.toHaveProperty("requiredEspInWg");
    const request = { target, mode: "fan", unitId: fan.unitId, portIndex: fan.portIndex };
    const response = await post("sheet", request);
    const json = await response.text();
    expect(response.status, json).toBe(200);
    const overview = ductsSheetOverviewSchema.parse(JSON.parse(json));
    const bytes = Buffer.byteLength(json, "utf8");
    expect(bytes).toBeLessThan(10_000);
    expect(overview.fan).toMatchObject({ unitId: 14577391, portIndex: 2 });
    expect(overview.paths.supply.paths.length).toBeLessThanOrEqual(5);
    expect(overview.paths.return.paths.length).toBeLessThanOrEqual(5);
    expect(overview.blockers.length).toBeGreaterThan(0);
    expect(overview.totals?.requiredEspInWg).toBeNull();
    expect(requests).toContainEqual({ selector: { kind: "from", unitId: 14577391 } });
    const reads = requests.length;
    const detail = await post("sheet", {
      ...request,
      basis: overview.basis,
      detail: overview.next.elements,
    });
    expect(detail.status).toBe(200);
    const elements = ductsSheetResponseSchema.parse(await detail.json());
    expect(elements.kind === "elements" && elements.walkedElementIds).toContain(14577391);
    const legs = await post("sheet", {
      ...request,
      basis: overview.basis,
      detail: overview.next.legs[0],
    });
    expect(legs.status).toBe(200);
    expect(ductsSheetResponseSchema.parse(await legs.json()).kind).toBe("legs");
    const inputs = await post("sheet", {
      ...request,
      basis: overview.basis,
      detail: overview.next.inputs,
    });
    expect(inputs.status).toBe(200);
    expect(ductsSheetResponseSchema.parse(await inputs.json()).kind).toBe("inputs");
    const warm = ductsRosterResponseSchema.parse(await (await post("roster", { target })).json());
    expect(
      warm.rows.find((row) => row.unitId === fan.unitId && row.portIndex === fan.portIndex),
    ).toMatchObject({
      blockerCount: overview.blockers.length,
      requiredEspInWg: null,
      complete: false,
    });
    expect(requests).toHaveLength(reads);
    for (const payload of [
      { ...request, basis: "stale", detail: overview.next.elements },
      { ...request, detail: overview.next.elements },
      { ...request, unitId: 1, basis: overview.basis, detail: overview.next.elements },
    ])
      expect((await post("sheet", payload)).status).toBe(409);
    const end = overview.paths.supply.paths[0]!.end.elementId;
    const chainRequest = {
      target,
      mode: "chain",
      start: { elementId: fan.unitId, connector: fan.portIndex },
      end: { elementId: end },
      direction: "supply",
    };
    const chainResponse = await post("sheet", chainRequest);
    expect(chainResponse.status).toBe(200);
    const chain = ductsSheetOverviewSchema.parse(await chainResponse.json());
    expect(chain).toMatchObject({ mode: "chain", fan: null, totals: null });
    expect(
      (
        await post("sheet", {
          ...chainRequest,
          basis: overview.basis,
          detail: overview.next.elements,
        })
      ).status,
    ).toBe(409);
    owner.changed({
      sessionId: target.session,
      kind: "event",
      eventName: "document-changed",
      payloadJson: JSON.stringify({ changedOpenIds: [target.openId] }),
    });
    expect(
      (await post("sheet", { ...request, basis: overview.basis, detail: overview.next.elements }))
        .status,
    ).toBe(409);
    // The chain names one start port, so it is a different raw read from the fan sheet's every-port read.
    expect(requests).toHaveLength(reads + 1);
    process.stdout.write(`MUAS-1 overview: ${bytes} UTF-8 bytes\n${JSON.stringify(overview)}\n`);
  },
  // Parses the 14 MB retained snapshot and surveys every roster fan once (assumedFanFlows): the
  // first MUAS-1 build measured 10.1 s before R-FACE and 11.0 s after (2026-10-28); the route
  // test took 16.6-17.3 s against vitest's 15 s default.
  60_000,
);

test("sheet inputs survive host recreation in document Work; one project cell governs all fans and defaults come from route settings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ducts-sheet-inputs-"));
  try {
    const target = { session: "session", openId: "doc-a" };
    const address = addressSchema.parse("C:\\models\\sheet-inputs.rvt");
    const connector = (
      index: number,
      direction: string,
      classification: string,
      toId: number,
      toConnector: number,
    ) => ({
      index,
      kind: "end",
      direction,
      classification,
      shape: "round",
      diameterIn: 8,
      point: [0, 0, 0],
      connectedTo: { elementId: toId, connector: toConnector },
      flowCfm: 200,
    });
    const nodes = [100, 200].flatMap((id) => [
      {
        id,
        kind: "equipment",
        family: "Air Handler",
        facts: [{ key: "mark", text: `F-${id}` }],
        connectors: [
          connector(0, "out", "SupplyAir", id + 1, 0),
          connector(1, "in", "ReturnAir", id + 2, 0),
        ],
      },
      ...[1, 2].map((offset) => ({
        id: id + offset,
        kind: "terminal",
        family: "Grille",
        flowParameter: "named",
        facts: [{ key: "flow", value: 100 }],
        connectors: [connector(0, "in", offset === 1 ? "SupplyAir" : "ReturnAir", id, offset - 1)],
      })),
    ]);
    const snapshot = {
      document: { title: "fixture", readAt: "fixed" },
      nodes,
      segments: [],
      slots: { terminalFlow: "named" },
    } as unknown as DuctSnapshot;
    const tableIds: string[][] = [];
    const source: DuctsSheetSources = {
      call: async (key, request) => {
        if ("ids" in request) tableIds.push(request.ids);
        return Response.json(key === "ducts.snapshot" ? snapshot : { tables: {} }, {
          headers: { [DUCTS_BODY_VERSION_HEADER]: key },
        });
      },
    };
    const registrations = [{ spec: ductsRouteState }];
    const store = fileRouteDocumentStore(dir);
    const workspace = new RouteWorkspace({ store, registrations });
    const scope = bindWork("ducts", address, undefined, target);
    expect(
      await workspace.apply(
        scope,
        "ducts",
        "human",
        [
          {
            path: ["sheetDefaults", "edit"],
            value: { value: { terminalDropInWg: 0.06, splitPolicy: "proportional" } },
          },
          { path: ["parameters", "terminalFlow", "edit"], value: { value: "revit:Flow" } },
        ],
        0,
      ),
    ).toMatchObject({ ok: true });
    const make = (workspace?: RouteWorkspace) =>
      createPeRoutes({
        registrations,
        store: fileRouteDocumentStore(dir),
        ...(workspace ? { workspace } : {}),
        heads: { observe: () => () => {} },
        ductsSheets: source,
        navigation: { documents: async () => [{ ...target, address }], threads: async () => [] },
      });
    let routes = make(workspace);
    const post = async (route: "sheet" | "roster", body: unknown) =>
      routes.fetch(
        new Request(`http://host/pe/ducts/${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const request = { target, mode: "fan", unitId: 100, portIndex: 0 };
    const settings = ductsSheetOverviewSchema.parse(await (await post("sheet", request)).json());
    expect(settings.fan!.flowCfm).toBe(200);
    expect(settings.totals!.requiredEspInWg).toBeCloseTo(0.12);
    const firstInputs = ductsSheetResponseSchema.parse(
      await (
        await post("sheet", { ...request, basis: settings.basis, detail: { kind: "inputs" } })
      ).json(),
    );
    expect(firstInputs.kind === "inputs" && firstInputs.inputs).toContainEqual({
      name: "split policy",
      value: "proportional",
      source: "route settings",
    });
    const inputs = {
      slot: "named",
      splitPolicy: "even",
      endCfm: { 101: 70 },
      drops: { 102: 0.09 },
      rulings: [{ pair: ["11:0", "12:1"], verdict: "reject" }],
    };
    const written = ductsSheetOverviewSchema.parse(
      await (await post("sheet", { ...request, inputs })).json(),
    );
    expect(written.fan!.flowCfm).toBe(70);
    expect(written.totals!.requiredEspInWg).toBeCloseTo(0.15);
    expect(
      (await post("sheet", { ...request, basis: settings.basis, detail: { kind: "inputs" } }))
        .status,
    ).toBe(409);
    routes = make(); // New workspace + real disk store, same document address.
    const reloaded = ductsSheetOverviewSchema.parse(await (await post("sheet", request)).json());
    expect(reloaded.fan!.flowCfm).toBe(70);
    expect(reloaded.totals!.requiredEspInWg).toBeCloseTo(0.15);
    const provenance = ductsSheetResponseSchema.parse(
      await (
        await post("sheet", { ...request, basis: reloaded.basis, detail: { kind: "inputs" } })
      ).json(),
    );
    expect(provenance.kind === "inputs" && provenance.inputs).toContainEqual({
      name: "airflow slot",
      value: "named",
      source: "Work edit",
    });
    const other = ductsSheetOverviewSchema.parse(
      await (await post("sheet", { ...request, unitId: 200 })).json(),
    );
    expect(other.fan!.flowCfm).toBe(100); // Project inputs (R2): fan 100's end cfm is keyed by its own terminal.
    const roster = ductsRosterResponseSchema.parse(await (await post("roster", { target })).json());
    expect(roster.activeSlot).toBe("named");
    expect(roster.slots).toEqual(
      expect.arrayContaining([
        { slot: "named", covered: 4, total: 4 },
        { slot: "revit:Flow", covered: 4, total: 4 },
      ]),
    );
    const changed = ductsSheetOverviewSchema.parse(
      await (
        await post("sheet", { ...request, unitId: 200, inputs: { slot: "revit:Flow" } })
      ).json(),
    );
    expect(changed.fan!.flowCfm).toBe(200);
    expect(
      (await post("sheet", { ...request, basis: reloaded.basis, detail: { kind: "inputs" } }))
        .status,
    ).toBe(409);
    const override = ductsSheetOverviewSchema.parse(
      await (
        await post("sheet", { ...request, inputs: { endCfm: { 101: 90 }, drops: { 101: 0.02 } } })
      ).json(),
    );
    expect(override.fan!.flowCfm).toBe(90);
    expect(override.totals!.requiredEspInWg).toBeCloseTo(0.11); // Keeps saved drop on 102.
    const noInlet = await post("sheet", { ...request, inputs: { inletPortIndex: 1 } });
    expect(noInlet.status).toBe(400);
    for (const ids of tableIds)
      expect(ids).toEqual(expect.arrayContaining(["CR3-1", "CD3-3", "SD5-9"]));
    const raw = await new RouteWorkspace({
      registrations,
      store: fileRouteDocumentStore(dir),
    }).readRaw(scope, "ducts");
    expect(raw!.doc).toMatchObject({
      sheetInputs: {
        project: {
          edit: {
            value: {
              slot: "revit:Flow",
              splitPolicy: "even",
              rulings: inputs.rulings,
              endCfm: { 101: 90 },
              drops: { 101: 0.02, 102: 0.09 },
            },
          },
        },
      },
    });
    expect(raw!.doc).not.toHaveProperty(["sheetInputs", "fan:100:0"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("proposal accept/reject is basis-bound, persists in document Work, and replay continues the known walk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sheet-proposal-"));
  try {
    const target = { session: "proposal-session", openId: "doc-a" };
    const address = addressSchema.parse("C:\\models\\proposal.rvt");
    const connector = (
      index: number,
      point: number[],
      facing: number[],
      classification: string,
      connectedTo: { elementId: number; connector: number } | null,
    ) => ({
      index,
      point,
      facing,
      classification,
      connectedTo,
      shape: "round",
      diameterIn: 8,
      kind: "end",
      direction: classification === "SupplyAir" ? "out" : "in",
    });
    const snapshot = {
      document: { title: "proposal", readAt: "fixed" },
      slots: { terminalFlow: "named" },
      segments: [],
      nodes: [
        {
          id: 100,
          kind: "equipment",
          family: "Air Handler",
          facts: [{ key: "mark", text: "F-100" }],
          connectors: [
            connector(0, [0, 0, 0], [1, 0, 0], "SupplyAir", null),
            connector(1, [0, 0, 0], [-1, 0, 0], "ReturnAir", { elementId: 102, connector: 0 }),
          ],
        },
        {
          id: 101,
          kind: "terminal",
          facts: [{ key: "flow", value: 100 }],
          connectors: [connector(0, [1, 0, 0], [-1, 0, 0], "SupplyAir", null)],
        },
        {
          id: 102,
          kind: "terminal",
          facts: [{ key: "flow", value: 100 }],
          connectors: [
            connector(0, [0, 0, 0], [1, 0, 0], "ReturnAir", { elementId: 100, connector: 1 }),
          ],
        },
      ],
    } as unknown as DuctSnapshot;
    const registrations = [{ spec: ductsRouteState }];
    const make = () =>
      createPeRoutes({
        registrations,
        store: fileRouteDocumentStore(dir),
        heads: { observe: () => () => {} },
        navigation: { documents: async () => [{ ...target, address }], threads: async () => [] },
        ductsSheets: {
          call: async (key) =>
            Response.json(key === "ducts.snapshot" ? snapshot : { tables: {} }, {
              headers: { [DUCTS_BODY_VERSION_HEADER]: key },
            }),
        },
      });
    let routes = make();
    const request = { target, mode: "fan", unitId: 100, portIndex: 0 };
    const post = (body: unknown) =>
      routes.fetch(
        new Request("http://host/pe/ducts/sheet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const first = ductsSheetOverviewSchema.parse(await (await post(request)).json());
    const proposal = first.blockers.find((b) => b.proposal)!.proposal!;
    expect(first.totals!.requiredEspInWg).toBeNull();
    expect(first.totals!.requiredEspAssumedInWg, JSON.stringify(first)).not.toBeNull();
    const choice = { pair: proposal.pair, verdict: "reject" };
    expect((await post({ ...request, proposal: choice })).status).toBe(409);
    expect(
      (
        await post({
          ...request,
          basis: first.basis,
          proposal: { ...choice, pair: ["100:0", "999:0"] },
        })
      ).status,
    ).toBe(409);
    const rejected = ductsSheetOverviewSchema.parse(
      await (await post({ ...request, basis: first.basis, proposal: choice })).json(),
    );
    expect(rejected.basis).not.toBe(first.basis);
    expect(rejected.blockers.every((b) => !b.proposal)).toBe(true);
    expect(rejected.totals!.requiredEspAssumedInWg).toBeNull();
    expect(
      (await post({ ...request, basis: first.basis, proposal: { ...choice, verdict: "accept" } }))
        .status,
    ).toBe(409);
    const reset = ductsSheetOverviewSchema.parse(
      await (await post({ ...request, inputs: { rulings: [] } })).json(),
    );
    const accepted = ductsSheetOverviewSchema.parse(
      await (
        await post({ ...request, basis: reset.basis, proposal: { ...choice, verdict: "accept" } })
      ).json(),
    );
    expect(accepted.totals!.requiredEspInWg).toBeGreaterThan(0.06);
    expect(accepted.blockers).toEqual([]);
    routes = make();
    const replayed = ductsSheetOverviewSchema.parse(await (await post(request)).json());
    expect(replayed.totals).toEqual(accepted.totals);
    const scope = bindWork("ducts", address, undefined, target);
    const raw = await new RouteWorkspace({
      registrations,
      store: fileRouteDocumentStore(dir),
    }).readRaw(scope, "ducts");
    expect(raw!.doc).toMatchObject({
      sheetInputs: {
        project: { edit: { value: { rulings: [{ pair: proposal.pair, verdict: "accept" }] } } },
      },
    });
    // R-CAP: an end ruling persists in the same project cell; the capped port is neither an end
    // nor a blocker, so the supply side has nothing left to price and ESP stays withheld.
    const endRulings = [{ end: { elementId: 100, connector: 0 }, verdict: "capped" }];
    const capped = ductsSheetOverviewSchema.parse(
      await (await post({ ...request, inputs: { rulings: [], endRulings } })).json(),
    );
    expect(capped.basis).not.toBe(accepted.basis);
    expect(capped.blockers.some((b) => b.elementId === 100)).toBe(false);
    expect(capped.paths.supply.paths).toEqual([]);
    expect(capped.totals!.requiredEspInWg).toBeNull();
    const cappedInputs = ductsSheetResponseSchema.parse(
      await (await post({ ...request, basis: capped.basis, detail: { kind: "inputs" } })).json(),
    );
    expect(cappedInputs.kind === "inputs" && cappedInputs.inputs).toContainEqual({
      name: "open end 100:0 ruled capped",
      value: null,
      source: "end ruling",
    });
    expect(cappedInputs.kind === "inputs" && cappedInputs.edits.endRulings).toEqual(endRulings);
    const rawCapped = await new RouteWorkspace({
      registrations,
      store: fileRouteDocumentStore(dir),
    }).readRaw(scope, "ducts");
    expect(rawCapped!.doc).toMatchObject({
      sheetInputs: { project: { edit: { value: { rulings: [], endRulings } } } },
    });
    expect(snapshot.nodes[0]!.connectors[0]!.connectedTo).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
