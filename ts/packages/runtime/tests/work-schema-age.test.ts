import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { OLDER_WORK, UNREADABLE_WORK, workKey, type WorkKey } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";

const key: WorkKey = { binding: "host", route: "age", target: null };
function fixture(saved: unknown) {
  const rows = new Map<string, unknown>([["age", saved]]);
  const setState = vi.fn(async ({ route, value }) => {
    rows.set(route, structuredClone(value));
  });
  const workspace = new RouteWorkspace({
    registrations: [
      {
        spec: {
          route: "age",
          title: "Age",
          description: "Age",
          schemaVersion: 2,
          schema: z.object({ note: z.string().default("") }),
        },
      },
    ],
    store: { getState: async ({ route }) => structuredClone(rows.get(route)), setState },
  });
  return { rows, setState, workspace };
}

test.each([undefined, 2, 3, "1", 0])(
  "unreadable schema %s cannot write or reset for either author",
  async (schemaVersion) => {
    const saved = { version: 1, revision: 4, schemaVersion, doc: { future: "keep me" } };
    const { workspace, setState, rows } = fixture(saved);
    await expect(workspace.read(key, "age")).rejects.toThrow(UNREADABLE_WORK);
    for (const by of ["human", "pea"] as const) {
      expect(await workspace.startFresh(key, "age", by)).toMatchObject({ ok: false });
      expect(
        await workspace.apply(key, "age", by, [{ path: ["note"], value: "lost" }], 4),
      ).toMatchObject({ ok: false });
      expect(
        await workspace.publish(key, "age", [{ path: ["note"], value: "lost" }], 4),
      ).toMatchObject({ ok: false });
    }
    expect(setState).not.toHaveBeenCalled();
    expect(rows.get("age")).toEqual(saved);
  },
);

test("an unmarked compatible Work reads without rewriting and acquires the current marker on an authored write", async () => {
  const saved = { version: 1, revision: 4, doc: { note: "keep" } };
  const { workspace, setState, rows } = fixture(saved);
  expect(await workspace.read(key, "age")).toMatchObject({ doc: saved.doc, revision: 4 });
  expect(setState).not.toHaveBeenCalled();
  expect(await workspace.startFresh(key, "age", "human")).toMatchObject({ ok: false });
  expect(
    await workspace.apply(key, "age", "human", [{ path: ["note"], value: "edited" }], 4),
  ).toMatchObject({ ok: true });
  expect(rows.get("age")).toMatchObject({ schemaVersion: 2, revision: 5, doc: { note: "edited" } });
});

test("a proven older unreadable Work recovers with exact aside bytes and a newer revision", async () => {
  const saved = { version: 1, schemaVersion: 1, revision: 4, doc: { old: "keep" } };
  const { workspace, rows } = fixture(saved);
  await expect(workspace.read(key, "age")).rejects.toThrow(OLDER_WORK);
  expect(await workspace.startFresh(key, "age", "human")).toMatchObject({ ok: true, revision: 5 });
  expect(rows.get("age:aside:1")).toEqual(saved);
  expect(rows.get("age")).toEqual({ version: 1, schemaVersion: 2, revision: 5, doc: { note: "" } });
});

test("recovery rechecks schema age inside the serialized operation", async () => {
  const { workspace, rows, setState } = fixture({
    version: 1,
    schemaVersion: 1,
    revision: 4,
    doc: { old: true },
  });
  await expect(workspace.read(key, "age")).rejects.toThrow(OLDER_WORK);
  const newer = { version: 1, schemaVersion: 3, revision: 5, doc: { future: true } };
  rows.set("age", newer);
  expect(await workspace.startFresh(key, "age", "human")).toMatchObject({ ok: false });
  expect(setState).not.toHaveBeenCalled();
  expect(rows.get("age")).toEqual(newer);
  expect(workKey(key)).toBe("age/target:");
});
