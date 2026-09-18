/**
 * O-2: until a route's cells cutover, Pea writes nothing a person would commit. Takeoffs,
 * Instances and Parameter Links hold only to-be-committed values, so Pea's mask there is empty.
 */
import { describe, expect, it } from "vite-plus/test";
import { scheduleGridRouteState } from "./schedule-grid-data.ts";
import { transitionPatches } from "./trichotomy.ts";
import type { z } from "zod";
import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";
import { instancesRouteState } from "./instances.ts";
import { parameterLinksRouteState } from "./parameter-links.ts";
import { takeoffsRouteState } from "./takeoffs.ts";

const cases: [RouteStateSpec<z.ZodType>, (string | number)[][]][] = [
  [
    takeoffsRouteState as never,
    [
      ["staged", "room-1"],
      ["adoptPatches", "c-1"],
      ["decisions", "room-1::flag"],
      ["reviewFlags", "room-1"],
    ],
  ],
  [instancesRouteState as never, [["staged"]]],
  [parameterLinksRouteState as never, [["draft"]]],
];

describe("Pea cannot write a to-be-committed value before its route's cutover", () => {
  for (const [spec, paths] of cases)
    it(`${spec.route}: every Pea write is refused, and the mask is empty`, () => {
      expect(spec.agentWriteMask).toEqual([]);
      const envelope: RouteEnvelope<unknown> = {
        version: 1,
        revision: 0,
        doc: spec.schema.parse({}),
      };
      for (const path of paths)
        expect(applyPatches(spec, envelope, "agent", [{ path }], 0)).toMatchObject({
          ok: false,
          kind: "refused",
        });
    });
});

it("schedules: Pea proposes a grid cell through the shared contract and cannot stage it", () => {
  const envelope: RouteEnvelope<unknown> = {
    version: 1,
    revision: 0,
    doc: scheduleGridRouteState.schema.parse({}),
  };
  const spec = scheduleGridRouteState as unknown as RouteStateSpec<z.ZodType>;
  const propose = transitionPatches(
    ["cells"],
    "1::2",
    {},
    { kind: "propose", rung: { value: "180 VA" } },
  );
  expect(applyPatches(spec, envelope, "agent", propose, 0)).toMatchObject({ ok: true });
  const stage = transitionPatches(
    ["cells"],
    "1::2",
    {},
    { kind: "stage", rung: { value: "180 VA" } },
  );
  expect(applyPatches(spec, envelope, "agent", stage, 0)).toMatchObject({
    ok: false,
    kind: "refused",
  });
});
