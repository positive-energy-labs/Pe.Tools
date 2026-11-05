import {
  DUCTS_BODY_VERSION_HEADER,
  ductsRosterResponseSchema,
  ductsSheetOverviewSchema,
  ductsSheetResponseSchema,
} from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Effect } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { detachedBridge } from "./effect-test.ts";
import { DuctsReadings } from "../src/ducts-readings.ts";
import { createPeRoutes } from "../src/pe-routes.ts";

const retained =
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-health.json";

test.skipIf(!existsSync(retained))(
  "MUAS-1 sheet route is bounded and detail is cached, subject-bound and invalidated",
  async () => {
    const raw = JSON.parse(readFileSync(retained, "utf8").replace(/^\uFEFF/, ""));
    const snapshot = (raw.result ?? raw) as DuctSnapshot;
    const target = { session: "retained-chadds", openId: "chadds-open" };
    const owner = new DuctsReadings();
    const requests: unknown[] = [];
    const bridge = detachedBridge({
      invoke: (key: string, request: unknown) =>
        Effect.sync(() => {
          expect(["ducts.snapshot.roster", "ducts.snapshot.walk", "ducts.tables"]).toContain(key);
          requests.push(request);
          return {
            value: key.startsWith("ducts.snapshot.")
              ? snapshot
              : { tables: {}, missing: [], unsupported: [] },
            target: { session: target.session, document: "Chadds", documentRef: target },
          };
        }),
    });
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
              // effect-edge: island, phase 5
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
    expect(requests).toContainEqual({
      selector: { kind: "from", unitId: 14577391, autoJoinGapIn: 3, candidateBoxIn: 36 },
    });
    const reads = requests.length;
    const detail = await post("sheet", {
      ...request,
      basis: overview.basis,
      detail: overview.next.elements,
    });
    expect(detail.status).toBe(200);
    const elements = ductsSheetResponseSchema.parse(await detail.json());
    expect(elements.kind === "elements" && elements.walkedElementIds).toContain(14577391);
    // Context only (kaitpw 2026-10-30, "yes show"): one `from` read per unit MUAS-1 stops at, and
    // RV-15's and RV-7's other ports come back as stubs, none of it walked (so none of it priced).
    expect(requests).toContainEqual({
      selector: {
        kind: "from",
        unitId: 6105264,
        maxHops: 12,
        autoJoinGapIn: 3,
        candidateBoxIn: 36,
      },
    });
    if (elements.kind === "elements") {
      expect(elements.beyond.map((b) => [b.unitId, b.mark])).toEqual(
        expect.arrayContaining([
          [6105264, "RV-15"],
          [6953852, "RV-7"],
        ]),
      );
      const walked = new Set(elements.walkedElementIds);
      const beyond = elements.beyond.flatMap((b) => b.elementIds);
      expect(beyond.length).toBeGreaterThan(0);
      expect(beyond.filter((id) => walked.has(id))).toEqual([]);
    }
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
    const census = ductsSheetResponseSchema.parse(await inputs.json());
    expect(census.kind).toBe("inputs");
    // Every table a person may pick is requested, so each option prices and is named by its title
    // (an option the rules only list, like CD3-9, was never served before 2026-10-30).
    const tableIds = requests.flatMap((r) => (r as { ids?: string[] }).ids ?? []);
    expect(tableIds).toEqual(expect.arrayContaining(["CD3-2", "CD3-9", "CD3-10", "SD5-10"]));
    expect(census.kind === "inputs" && census.tableTitles).toEqual({});
    // UI5: the census is this fan's. The whole-document acquisition resolves every unit on Chadds;
    // the detail returns only the elements the sheet walked, its fan and its blockers' elements, so
    // the page's element snapshot names every row (MUAS-1 listed UH-3 7939081 "unnamed element").
    if (census.kind === "inputs" && elements.kind === "elements") {
      const reach = new Set([
        ...elements.walkedElementIds,
        fan.unitId,
        ...census.blockers.flatMap((b) =>
          [b.elementId, b.closer.candidate?.toElementId, b.proposal?.to.elementId].filter(
            (id): id is number => id != null,
          ),
        ),
      ]);
      const keys = [
        ...Object.keys(census.inputs.units),
        ...Object.keys(census.inputs.terminals),
        ...Object.keys(census.inputs.components),
      ].map(Number);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.filter((id) => !reach.has(id))).toEqual([]);
      const documentUnits = snapshot.nodes.filter((n) => n.kind === "equipment").length;
      expect(Object.keys(census.inputs.units).length).toBeLessThan(documentUnits);
    }
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
