import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { bindWork, draftCellSchema, type RouteStateSpec } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";

test("connected workspace shares edits, stamps either writer and preserves a revision fence", async () => {
  const schema = z.object({
    cells: z.record(z.string(), draftCellSchema(z.number())).default({}),
    basis: z.unknown().optional(),
  });
  const spec: RouteStateSpec<typeof schema> = {
    route: "shared",
    title: "Shared",
    description: "Shared",
    schema,
  };
  const rows = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations: [{ spec }],
    store: {
      getState: async ({ targetKey }) => rows.get(targetKey),
      setState: async ({ targetKey, value }) => {
        rows.set(targetKey, value);
      },
    },
  });
  const key = bindWork("shared", null);
  expect(
    await workspace.apply(
      key,
      "shared",
      "human",
      [{ path: ["cells", "width", "edit"], value: { value: 200 } }],
      0,
    ),
  ).toMatchObject({ ok: true, revision: 1 });
  expect(
    await workspace.apply(
      key,
      "shared",
      "pea",
      [{ path: ["cells", "width", "edit"], value: { value: 250, by: "human", base: 0 } }],
      1,
    ),
  ).toMatchObject({ ok: true, revision: 2 });
  expect((await workspace.read(key, "shared"))?.doc).toMatchObject({
    cells: { width: { edit: { value: 250, by: "pea", base: 1 } } },
  });
  expect(
    await workspace.apply(
      key,
      "shared",
      "human",
      [{ path: ["cells", "width", "edit"], value: { value: 300 } }],
      1,
    ),
  ).toMatchObject({ ok: false, code: "stale_revision" });
  expect(
    await workspace.apply(key, "shared", "pea", [{ path: ["basis"], value: { forged: true } }], 2),
  ).toMatchObject({ ok: false });
  expect(
    await workspace.publish(
      key,
      "shared",
      [{ path: ["basis"], value: { capture: "verified" } }],
      2,
    ),
  ).toMatchObject({ ok: true });
});
