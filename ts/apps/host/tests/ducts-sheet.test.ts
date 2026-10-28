import { existsSync, readFileSync } from "node:fs";
import { Effect } from "effect";
import { expect, test } from "vite-plus/test";
import {
  DUCTS_BODY_VERSION_HEADER,
  ductsRosterResponseSchema,
  ductsSheetOverviewSchema,
  ductsSheetResponseSchema,
} from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
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
);
