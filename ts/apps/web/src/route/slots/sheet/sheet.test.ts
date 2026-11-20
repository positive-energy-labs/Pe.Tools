import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { commandCatalogAxes } from "@pe/agent-contracts/command-axes";
import { commands } from "../../../../../../packages/mcps/src/pea/product-actions.generated.ts";
import type { CatalogAxes } from "../../../../../../packages/agent-contracts/src/catalog.ts";
import { SHEET_COMMANDS, local, parameter, setting, settingLayer, sheetSlotDataSchema } from "@pe/agent-contracts/slots";
import { subjectCode, uniqueIdSchema } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import { sheetCells } from "./index.ts";

/*
 * Slice 7's red falsifier (routes MAP row 7). The Pod half is the Pod author's own red tests on
 * crusade/author-pod, examples/pods/hydronic/routes/sizing/sizing.test.ts: "kernel gap:
 * parameter-binding (4)" and "kernel gap: pod-parameter-write (8)" (authors/pod/gaps.json); they
 * are referenced, not copied. Green means: one StateCell per binding per row, drawn from Work and
 * the model, and one plan/apply pair in the catalog that the linker rule admits.
 */
const uid = (text: string) => subjectCode({ keyKind: "UniqueId", key: uniqueIdSchema.parse(text) });

test("setting projection ignores non-setting bindings", () => {
  expect(settingLayer(local({ kind: "number" }, "route", { default: 3 }))).toBeNull();
});

test("setting bindings serve their fallback through the model and prefer a stated home", () => {
  const slot = { bindings: { gap: setting("ducts", ["gap"], { kind: "number" }, ["firm"], { default: 3 }) } };
  const cells = (read?: unknown) => sheetCells(slot, { rows: [], work: {}, read });
  expect(cells({})[0]).toMatchObject({ value: 3, model: 3, source: "default" });
  expect(cells({ settings: { ducts: [{ tier: "firm", home: "Firm", name: "Firm", json: { gap: 5 } }] } })[0]).toMatchObject({ value: 5, model: 5, source: "firm" });
  expect(cells()[0]).toMatchObject({ value: null, model: null });
});

test("slice 7: the sheet slot draws a binding's StateCells, and a ModelWrite binds a plan whose effect is Read or TransactRead", () => {
  // A Pod decodes the same home and domain grammar the browser declares.
  const slot = { bindings: { chosen: parameter("Diameter", { kind: "number" }, { model: (_read, row) => ({ value: row === a ? 20 : 32, freshness: "fresh" }) }), maxVelocity: local({ kind: "number" }) } };
  expect(
    sheetSlotDataSchema.parse({
      bindings: {
        chosen: { home: { at: "parameter", parameter: "Diameter" }, domain: { kind: "number" }, per: "subject" },
        maxVelocity: { home: { at: "local" }, domain: { kind: "number" }, per: "route" },
      },
    }).bindings.chosen!.home.at,
  ).toBe("parameter");

  // Two rows; `a` has a staged value that drifts from the model, `b` shows the model's own value.
  const [a, b] = [uid("a-0001"), uid("b-0002")];
  const cells = sheetCells(slot, {
    rows: [a, b],
    work: { chosen: { [a]: 25 }, maxVelocity: 1.5 },
    read: {},
  });
  expect(cells.map((c) => [c.binding, c.row ?? "route", c.value, c.model, c.drift, c.source])).toEqual([
    ["chosen", a, 25, 20, true, "work"],
    ["chosen", b, 32, 32, false, "model"],
    ["maxVelocity", "route", 1.5, null, false, "work"],
  ]);
  expect(cells.map((c) => c.home.at)).toEqual(["parameter", "parameter", "local"]);

  // One pair for every sheet, admitted by the existing linker rule (agent-contracts catalog.ts):
  // the apply is a ModelWrite whose plan is a Read or TransactRead.
  const axes = commandCatalogAxes as Record<string, CatalogAxes | undefined>;
  const declared = commands as Record<string, { writeBoundary?: { previewKey: string } } | undefined>;
  expect(axes[SHEET_COMMANDS.apply]?.effect).toBe("ModelWrite");
  expect(declared[SHEET_COMMANDS.apply]?.writeBoundary?.previewKey).toBe(SHEET_COMMANDS.plan);
  expect(["Read", "TransactRead"]).toContain(axes[SHEET_COMMANDS.plan]?.effect);
});

test("slice 7: a draft slot draws each Work cell's staged value with its author, and an empty draft draws the model", () => {
  // ADR 0030 rule 8: Fans Work holds `{ edit: { value, by, at } }` at every address; `{}` is a draft nobody staged.
  const [a, b] = [uid("a-0001"), uid("b-0002")];
  const slot = { draft: true as const, bindings: {
    localRate: local({ kind: "number" }),
    roles: { home: { at: "store", store: "_PE_DuctLosses" }, domain: { kind: "object", fields: { role: { kind: "enum", shape: z.string(), choices: [] } } }, per: "subject", model: (_read: unknown, row: string | undefined) => row === b ? { value: { role: "passive" }, freshness: "fresh" as const } : null } as const,
  } };
  const cells = sheetCells(slot, {
    rows: [a, b],
    work: { localRate: { edit: { value: 0.1, by: "pea", at: "2026-11-10T00:00:00Z" } }, roles: { [a]: { edit: { value: { role: "fan" }, by: "human" } }, [b]: {} } },
    read: {},
  });
  expect(cells.map((c) => [c.binding, c.value, c.source, c.pending?.by ?? null])).toEqual([
    ["localRate", 0.1, "work", "pea"],
    ["roles", { role: "fan" }, "work", "human"],
    ["roles", { role: "passive" }, "model", null],
  ]);
  expect(cells[0]!.pending).toEqual({ by: "pea", value: 0.1, at: "2026-11-10T00:00:00Z" });
});

test.each([
  { home: { at: "unknown" }, domain: { kind: "number" } },
  { home: { at: "local" }, domain: { kind: "unknown" } },
])("unknown grammar arms fail at the boundary", binding => {
  expect(sheetSlotDataSchema.safeParse({ bindings: { x: { ...binding, per: "route" } } }).success).toBe(false);
});
