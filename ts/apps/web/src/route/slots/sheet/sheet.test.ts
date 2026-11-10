import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { commandCatalogAxes } from "@pe/agent-contracts/command-axes";
import { commands } from "@pe/agent-contracts/semantic-actions";
import type { CatalogAxes } from "../../../../../../packages/agent-contracts/src/catalog.ts";
import { BINDING_KINDS, SHEET_COMMANDS, local, parameter, sheetSlotDataSchema } from "@pe/agent-contracts/slots";
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

test("slice 7: the sheet slot draws a binding's StateCells, and a ModelWrite binds a plan whose effect is Read or TransactRead", () => {
  // The three closed kinds, and the data projection a Pod decodes (the hydronic Pod's `chosen` binding).
  expect(BINDING_KINDS).toEqual(["parameter", "store", "local"]);
  const slot = { bindings: { chosen: parameter("Diameter", z.number()), maxVelocity: local(z.number()) } };
  expect(
    sheetSlotDataSchema.parse({
      bindings: {
        chosen: { kind: "parameter", parameter: "Diameter", per: "subject" },
        maxVelocity: { kind: "local", per: "route" },
      },
    }).bindings.chosen.kind,
  ).toBe("parameter");

  // Two rows; `a` has a staged value that drifts from the model, `b` shows the model's own value.
  const [a, b] = [uid("a-0001"), uid("b-0002")];
  const cells = sheetCells(slot, {
    rows: [a, b],
    work: { chosen: { [a]: 25 }, maxVelocity: 1.5 },
    model: [
      { binding: "chosen", subject: a, value: 20, freshness: "fresh" },
      { binding: "chosen", subject: b, value: 32, freshness: "fresh" },
    ],
  });
  expect(cells.map((c) => [c.binding, c.subject ?? "route", c.value, c.model, c.drift, c.source])).toEqual([
    ["chosen", a, 25, 20, true, "work"],
    ["chosen", b, 32, 32, false, "model"],
    ["maxVelocity", "route", 1.5, null, false, "work"],
  ]);
  expect(cells.map((c) => c.kind)).toEqual(["parameter", "parameter", "local"]);

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
    designFriction: local(z.number()),
    roles: { kind: "store", store: "_PE_DuctLosses", schema: z.object({ role: z.string() }), per: "subject" } as const,
  } };
  const cells = sheetCells(slot, {
    rows: [a, b],
    work: { designFriction: { edit: { value: 0.1, by: "pea", at: "2026-11-10T00:00:00Z" } }, roles: { [a]: { edit: { value: { role: "fan" }, by: "human" } }, [b]: {} } },
    model: [{ binding: "roles", subject: b, value: { role: "passive" }, freshness: "fresh" }],
  });
  expect(cells.map((c) => [c.binding, c.value, c.source, c.pending?.by ?? null])).toEqual([
    ["designFriction", 0.1, "work", "pea"],
    ["roles", { role: "fan" }, "work", "person"],
    ["roles", { role: "passive" }, "model", null],
  ]);
  expect(cells[0]!.pending).toEqual({ by: "pea", value: 0.1, at: "2026-11-10T00:00:00Z" });
});
