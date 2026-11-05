import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { bindWork, draftCellSchema, type RouteStateSpec } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";

/** Real stored bytes from the retired two-lane shape, then the same rows read by today's schema. */
test("retired suggestion lane: promote, edit wins, drop logged, old undo restores a valid value", async () => {
  const rung = z.looseObject({ value: z.string() }).nullish();
  const oldSchema = z.object({
    cells: z.record(z.string(), z.object({ proposed: rung, edit: rung }).strict()).default({}),
  });
  const newSchema = z.object({
    cells: z.record(z.string(), draftCellSchema(z.string())).default({}),
  });
  const spec = <S extends z.ZodType>(schema: S): RouteStateSpec<S> => ({
    route: "lane",
    title: "Lane",
    description: "Lane",
    schema,
  });
  const rows = new Map<string, unknown>();
  const store = {
    getState: async ({ targetKey }: { targetKey: string }) => structuredClone(rows.get(targetKey)),
    setState: async ({ targetKey, value }: { targetKey: string; value: unknown }) => {
      rows.set(targetKey, structuredClone(value));
    },
  };
  const key = bindWork("lane", null);
  const old = new RouteWorkspace({ registrations: [{ spec: spec(oldSchema) }], store });
  const write = (by: "pea" | "human", path: string[], value: string, at: number) =>
    old.write(key, "lane", by, {
      kind: "apply",
      press: `p${at}`,
      expectedRevision: at,
      // The retired host stamped suggestions too; today's stamps `edit` alone, so the bytes carry it.
      patches: [{ path, value: { value, ...(path.at(-1) === "proposed" ? { by } : {}) } }],
    });
  // r1: Pea suggests p=a, nobody takes it. r2: Pea suggests q=s. r3: the person edits q=h.
  expect(await write("pea", ["cells", "p", "proposed"], "a", 0)).toMatchObject({ ok: true });
  expect(await write("pea", ["cells", "q", "proposed"], "s", 1)).toMatchObject({ ok: true });
  expect(await write("human", ["cells", "q", "edit"], "h", 2)).toMatchObject({ ok: true });
  // Written under a stand-in name because today's workspace retires the lane on every read; the
  // rename gives exactly the bytes the retired host stored (doc, after, patches and inverse).
  for (const [row, value] of rows)
    rows.set(row, JSON.parse(JSON.stringify(value).replaceAll('"proposed"', '"suggestion"')));
  expect(JSON.stringify([...rows.values()])).toContain('"suggestion"');

  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const current = new RouteWorkspace({ registrations: [{ spec: spec(newSchema) }], store });
  const read = await current.read(key, "lane");
  expect(read?.revision).toBe(3);
  // Suggestion-only promotes with its author; edit wins over a differing suggestion.
  expect(read?.doc).toEqual({
    cells: {
      p: { edit: expect.objectContaining({ value: "a", by: "pea" }) },
      q: { edit: expect.objectContaining({ value: "h", by: "human" }) },
    },
  });
  expect(warn.mock.calls[0]![1]).toEqual([
    {
      path: ["doc", "cells", "q"],
      suggestion: expect.objectContaining({ value: "s" }),
      edit: expect.objectContaining({ value: "h" }),
    },
  ]);
  // A read never writes: the retired bytes survive until the next accepted write.
  expect(JSON.stringify([...rows.values()])).toContain('"suggestion"');

  // Undo of the pre-retirement person edit restores Pea's promoted value, valid under today's schema.
  expect(await current.step(key, "lane", "human", "undo", 3)).toMatchObject({ ok: true, revision: 4 });
  const undone = await current.read(key, "lane");
  expect(newSchema.parse(undone?.doc)).toEqual(undone?.doc);
  expect(undone?.doc).toEqual({
    cells: {
      p: { edit: expect.objectContaining({ value: "a", by: "pea" }) },
      q: { edit: expect.objectContaining({ value: "s", by: "pea" }) },
    },
  });
  // The undo was a write: doc and history persisted collapsed, so a fresh load logs nothing.
  expect(JSON.stringify([...rows.values()])).not.toContain('"suggestion"');
  warn.mockClear();
  await new RouteWorkspace({ registrations: [{ spec: spec(newSchema) }], store }).read(key, "lane");
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
