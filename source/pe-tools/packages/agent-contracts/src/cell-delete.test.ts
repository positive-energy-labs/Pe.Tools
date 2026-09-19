/**
 * O-1, revised by rulings 2026-09-18 16:00 #3: one cell factory; an empty value is a value on
 * every route; deleting is opt-in and kept only where a shipped consumer stages it (settings
 * cells: `/family` and the pods reviewer). Elsewhere a delete rung is refused by the schema.
 */
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";
import { familiesRouteState, familyCellKey, type FamilyCellState } from "./families.ts";
import { familyDraftRouteState } from "./family.ts";
import { scheduleGridRouteState } from "./schedule-grid-data.ts";
import { settingsRouteState } from "./settings.ts";
import { transitionPatches, trichotomyCellSchema, type Rung } from "./trichotomy.ts";

const familyKey = familyCellKey({ familyName: "F", typeName: "T", parameter: "P" });
type Route = [string, RouteStateSpec<z.ZodType>, string, string, Rung];
const routes: Route[] = [
  ["families", familiesRouteState as never, "cells", familyKey, { value: { value: "" } }],
  ["schedules", scheduleGridRouteState as never, "cells", "1::2", { value: "" }],
  ["pods", settingsRouteState as never, "fields", "/a/b", { value: "" }],
  ["family", familyDraftRouteState as never, "cells", "/a/b", { value: "" }],
];
const stage = ([, spec, container, cell]: Route, rung: Rung) =>
  applyPatches(
    spec,
    { version: 1, revision: 0, doc: spec.schema.parse({}) } as RouteEnvelope<unknown>,
    "human",
    transitionPatches([container], cell, {}, { kind: "stage", rung }),
    0,
  );

describe("an empty value is a value", () => {
  for (const route of routes)
    it(`${route[0]}: stages and parses`, () => {
      const landed = stage(route, route[4]);
      expect(landed).toMatchObject({ ok: true });
      const doc = (landed as { envelope: { doc: Record<string, Record<string, unknown>> } })
        .envelope.doc;
      expect(doc[route[2]]![route[3]]).toMatchObject({ staged: route[4] });
    });
});

describe("a delete stages only where a shipped consumer stages one", () => {
  for (const route of routes) {
    const deletable = route[0] === "pods" || route[0] === "family";
    it(`${route[0]}: ${deletable ? "stages and round-trips" : "is refused by the schema"}`, () => {
      const landed = stage(route, { delete: true });
      expect(landed).toMatchObject({ ok: deletable });
      if (deletable) {
        const doc = (landed as { envelope: { doc: Record<string, Record<string, unknown>> } })
          .envelope.doc;
        expect(doc[route[2]]![route[3]]).toMatchObject({ staged: { delete: true } });
        expect(route[1].schema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
      }
    });
  }

  it("a delete rung on a no-delete route does not type-check", () => {
    // @ts-expect-error: Families cells have no delete rung.
    const cell: FamilyCellState = { staged: { delete: true } };
    expect(familiesRouteState.schema.safeParse({ cells: { [familyKey]: cell } }).success).toBe(
      false,
    );
  });
});

describe("one rung, one write", () => {
  const deletable = trichotomyCellSchema(z.unknown(), { deletable: true });
  const plain = trichotomyCellSchema(z.string());
  it.each([
    ["deletable", { staged: { delete: true } }, true],
    ["deletable", { proposal: { delete: true } }, true],
    ["deletable", { staged: { value: "x", delete: true } }, false],
    ["deletable", { staged: {} }, false],
    ["plain", { staged: { value: "" } }, true],
    ["plain", { staged: { delete: true } }, false],
    ["plain", { proposal: { value: "x", delete: true } }, false],
    ["plain", { proposal: { note: "only a note" } }, false],
  ] as const)("%s cell: %j parses: %s", (kind, input, ok) => {
    const schema = kind === "deletable" ? deletable : plain;
    expect(schema.safeParse(input).success).toBe(ok);
  });
});
