import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { draftCellSchema, availableTransitions } from "./draft.ts";
import { applyPatches, type RouteEnvelope } from "./route-doc.ts";
import type { RouteStateSpec } from "./route-state.ts";

const schema = z.object({
  cells: z.record(z.string(), draftCellSchema(z.number())).default({}),
  basis: z.unknown().optional(),
});
const spec: RouteStateSpec<typeof schema> = {
  route: "shared",
  title: "Shared",
  description: "Shared edits",
  schema,
  commands: {},
};
const envelope: RouteEnvelope<z.infer<typeof schema>> = {
  version: 1,
  revision: 13,
  doc: { cells: { width: { edit: { value: 200, by: "human", base: 12 } } } },
};

test("either author knowingly replaces the current edit; provenance cannot be forged", () => {
  for (const actor of ["agent", "human"] as const) {
    const result = applyPatches(
      spec,
      envelope,
      actor,
      [
        {
          path: ["cells", "width", "edit"],
          value: { value: 250, by: "unknown", at: "forged", base: 0 },
        },
      ],
      13,
    );
    expect(result).toMatchObject({
      ok: true,
      envelope: {
        revision: 14,
        doc: {
          cells: {
            width: { edit: { value: 250, by: actor === "agent" ? "pea" : "human", base: 13 } },
          },
        },
      },
    });
    if (result.ok) expect(result.envelope.doc.cells.width?.edit?.at).not.toBe("forged");
    expect(
      applyPatches(
        spec,
        envelope,
        actor,
        [{ path: ["cells", "width", "edit"], value: { value: 250 } }],
        12,
      ),
    ).toMatchObject({ ok: false, code: "stale_revision" });
    expect(
      availableTransitions(envelope.doc.cells.width!, actor === "agent" ? "pea" : "human", {
        lock: null,
      }),
    ).toContain("set");
  }
});

test("both writers retain schema and host-observation boundaries", () => {
  for (const actor of ["agent", "human"] as const) {
    expect(
      applyPatches(
        spec,
        envelope,
        actor,
        [{ path: ["cells", "width", "edit"], value: { value: "bad" } }],
        13,
      ),
    ).toMatchObject({ ok: false });
    expect(
      applyPatches(spec, envelope, actor, [{ path: ["basis"], value: { forged: true } }], 13),
    ).toMatchObject({ ok: false });
  }
});

test("cell keys that look like slots or evidence do not bypass host attribution", () => {
  for (const key of ["edit", "suggestion", "value", "source", "evidence"]) {
    const result = applyPatches(
      spec,
      envelope,
      "agent",
      [{ path: ["cells", key], value: { edit: { value: 7, by: "human", base: 0 } } }],
      13,
    );
    expect(result).toMatchObject({
      ok: true,
      envelope: { doc: { cells: { [key]: { edit: { by: "pea", base: 13, value: 7 } } } } },
    });
  }
});

test("generic patches cannot forge or erase any host observation for either author", () => {
  const fields = ["basis", "reading", "snapshot", "takenAt", "readback", "consent"];
  const observedSchema = schema.extend(
    Object.fromEntries(fields.map((field) => [field, z.unknown().optional()])),
  );
  for (const actor of ["agent", "human"] as const)
    for (const field of fields)
      for (const patch of [
        { path: [field], value: { verified: true } },
        { path: [field, "verified"], value: true },
        { path: [field] },
      ])
        expect(
          applyPatches({ ...spec, schema: observedSchema }, envelope, actor, [patch], 13),
        ).toMatchObject({
          ok: false,
          error: "Host observations cannot be changed by an edit",
        });
});
