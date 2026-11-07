import { afterEach, expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  readingFrameSchema,
  workKey,
  workWriteAckSchema,
  type Caller,
  type RouteStatePatch,
  type WorkKey,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import type { RouteWorkspaceEvent } from "@pe/runtime";
import { createPeRoutes } from "../src/pe-routes.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { human, pea } from "./callers.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
const schema = z.object({
  settings: z.object({ width: z.number().default(10), height: z.number().default(4) }).prefault({}),
  cells: z
    .record(
      z.string(),
      z.object({
        edit: z
          .object({
            value: z.string(),
            by: z.enum(["human", "pea"]).optional(),
            at: z.string().optional(),
            base: z.number().optional(),
          })
          .optional(),
      }),
    )
    .default({}),
  rows: z.array(z.string()).default([]),
  derived: z.number().default(0),
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "pe-work-restore-"));
  directories.push(directory);
  const store = fileRouteDocumentStore(directory);
  const scope: WorkKey = { binding: "host", route: "restore-proof", target: null };
  const spec = {
    route: scope.route,
    title: "Restore",
    description: "Work write proof",
    schemaVersion: 2,
    schema,
    reconcileEdit: (raw: unknown) => {
      const doc = raw as z.infer<typeof schema>;
      return { ...doc, derived: doc.rows.length };
    },
  };
  const app = createPeRoutes({
    store,
    registrations: [{ spec }],
    heads: { observe: () => () => {} },
  });
  const events: RouteWorkspaceEvent[] = [];
  app.workspace.subscribeUncaptured((event) => {
    if (event.ok) events.push(event);
  });
  const post = async (body: unknown, caller: Caller = human, operation = "apply") => {
    const response = await withInvocationContext({ caller }, () =>
      app.fetch(
        new Request(`http://host/pe/route-state/${scope.route}/${operation}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      ),
    );
    return response.json();
  };
  const apply = (patches: RouteStatePatch[], revision: number, caller: Caller = human) =>
    post({ patches, expectedRevision: revision, press: "press-1" }, caller);
  const restore = (write: WorkWriteAck, revision = write.revision) =>
    post({
      patches: write.inverse,
      expectedRevision: revision,
      press: null,
      kind: "restore",
      restoreOf: write.revision,
    });
  const stored = () => store.getState({ targetKey: workKey(scope), route: scope.route });
  return { app, store, scope, spec, post, apply, restore, stored, events };
}
const width = (value: number): RouteStatePatch[] => [{ path: ["settings", "width"], value }];

test("HTTP apply overwrites client by with the principal, and restore preserves the Pea preimage", async () => {
  const h = await fixture();
  const seeded = await h.apply(
    [{ path: ["cells", "a", "edit"], value: { value: "Pea", by: "human" } }],
    0,
    pea(),
  );
  expect(seeded.write).toMatchObject({
    kind: "apply",
    by: "pea",
    press: "press-1",
    base: 0,
    revision: 1,
  });
  const before = await h.stored();
  const edited = await h.post({
    patches: [
      {
        path: ["cells", "a", "edit"],
        value: { value: "Human", by: "pea", at: "forged", base: 99 },
      },
    ],
    expectedRevision: 1,
    press: "human-press",
    by: "pea",
  });
  expect(edited.doc.cells.a.edit).toMatchObject({ value: "Human", by: "human", base: 1 });
  expect(edited.doc.cells.a.edit.at).not.toBe("forged");
  expect(edited.write).toMatchObject({ by: "human", press: "human-press", base: 1, revision: 2 });
  const restored = await h.restore(edited.write);
  expect(restored.write).toMatchObject({
    kind: "restore",
    by: "human",
    press: null,
    base: 2,
    revision: 3,
  });
  expect(restored.doc.cells.a.edit.by).toBe("pea");
  expect(JSON.stringify(restored.doc)).toBe(JSON.stringify((before as { doc: unknown }).doc));
  const reopened = fileRouteDocumentStore(directories.at(-1)!);
  expect(
    await reopened.getState({ targetKey: workKey(h.scope), route: h.scope.route }),
  ).toMatchObject({ revision: 3, doc: restored.doc });
});

test("acknowledgements and publications include reconciliation and inverse footprints", async () => {
  const h = await fixture();
  const edited = await h.apply([{ path: ["rows"], value: ["a", "b"] }], 0);
  expect(edited.write.patches).toEqual([
    { path: ["rows"], value: ["a", "b"] },
    { path: ["derived"], value: 2 },
  ]);
  expect(edited.write.inverse).toEqual([
    { path: ["rows"], value: [] },
    { path: ["derived"], value: 0 },
  ]);
  expect(h.events.at(-1)).toMatchObject(edited.write);
  expect((await h.restore(edited.write)).doc).toEqual(h.spec.schema.parse({}));
  const published = await h.app.workspace.publish(h.scope, h.scope.route, width(22), 2);
  expect(published).toMatchObject({
    ok: true,
    write: { kind: "publish", press: null, patches: width(22) },
  });
  expect(h.events.at(-1)).toMatchObject({
    kind: "publish",
    press: null,
    patches: width(22),
    inverse: width(10),
  });
});

test("restore refuses forged inverses, another Work's inverse and stale revisions without writing", async () => {
  const h = await fixture();
  const edited = await h.apply(width(20), 0);
  const before = await h.stored();
  expect(
    await h.post({ patches: width(999), expectedRevision: 1, press: null, kind: "restore" }),
  ).toMatchObject({ ok: false });
  expect(await h.restore(edited.write, 0)).toMatchObject({ ok: false, code: "stale_revision" });
  const other: WorkKey = {
    binding: "workspace",
    route: h.scope.route,
    work: "other",
    target: null,
  };
  expect(
    await h.app.workspace.write(other, other.route, "human", {
      patches: edited.write.inverse,
      expectedRevision: 0,
      press: null,
      kind: "restore",
    }),
  ).toMatchObject({ ok: false });
  expect(await h.stored()).toEqual(before);
});

test("ordinary restore still validates the inverse against the current Work schema", async () => {
  const h = await fixture();
  const edited = await h.apply(width(20), 0);
  h.spec.schema = schema.refine((doc) => doc.settings.width >= 15);
  const before = await h.stored();
  expect(await h.restore(edited.write)).toMatchObject({
    ok: false,
    error: "the patched document is invalid",
  });
  expect(await h.stored()).toEqual(before);
});

test("startFresh returns the set-aside inverse and recovery restores the unparsed document", async () => {
  const h = await fixture();
  const original = {
    version: 1,
    schemaVersion: 1,
    revision: 7,
    doc: { legacy: true, old: [1, 2] },
  };
  await h.store.setState({ targetKey: workKey(h.scope), route: h.scope.route, value: original });
  const fresh = await h.post({}, human, "start-fresh");
  expect(fresh.write).toMatchObject({
    kind: "start-fresh",
    base: 7,
    revision: 8,
    press: null,
    undoable: true,
    aside: `${h.scope.route}:aside:1`,
    inverse: [{ path: [], value: original.doc }],
  });
  expect(await h.store.getState({ targetKey: workKey(h.scope), route: fresh.write.aside })).toEqual(
    original,
  );
  expect(await h.restore(fresh.write)).toMatchObject({
    ok: true,
    revision: 9,
    doc: original.doc,
    write: { kind: "restore", press: null },
  });
  expect(await h.stored()).toMatchObject({ ...original, revision: 9, history: expect.any(Array) });
});

test("startFresh refuses an unmarked malformed envelope and preserves its exact bytes", async () => {
  const h = await fixture();
  await h.store.setState({
    targetKey: workKey(h.scope),
    route: h.scope.route,
    value: "unreadable envelope",
  });
  expect(await h.post({}, human, "start-fresh")).toMatchObject({ ok: false });
  expect(await h.stored()).toBe("unreadable envelope");
});

test("the wire requires a press field and a human apply requires a nonempty dispatch identity", async () => {
  const h = await fixture();
  expect(await h.post({ patches: width(20), expectedRevision: 0 })).toMatchObject({ ok: false });
  expect(await h.post({ patches: width(20), expectedRevision: 0, press: null })).toMatchObject({
    ok: false,
  });
  expect(await h.stored()).toBeNull();
});

test("an agent's HTTP write reaches a resource-stream subscriber with its host stamps, and a resubscription replays the window", async () => {
  const h = await fixture();
  const open = async () => {
    const abort = new AbortController();
    const keys = encodeURIComponent(JSON.stringify([{ kind: "work-acks", work: h.scope }]));
    const response = await withInvocationContext({ caller: human }, () =>
      h.app.fetch(new Request(`http://host/pe/resources?keys=${keys}`, { signal: abort.signal })),
    );
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const next = async () => {
      const text = new TextDecoder().decode((await reader.read()).value);
      const frame = readingFrameSchema.parse(JSON.parse(text.slice("data: ".length).trim()));
      if (frame.kind !== "event") throw Error(`Expected an event frame, got ${frame.kind}`);
      return workWriteAckSchema.parse(frame.value);
    };
    return { next, close: () => abort.abort() };
  };
  const live = await open();
  await h.apply(width(20), 0, pea());
  const second = await h.apply(width(30), 1);
  const agent = await live.next();
  const person = await live.next();
  expect(agent).toMatchObject({
    kind: "apply",
    by: "pea",
    press: "press-1",
    base: 0,
    revision: 1,
    patches: [{ path: ["settings", "width"], value: 20 }],
    inverse: [{ path: ["settings", "width"], value: 10 }],
  });
  expect(person).toMatchObject({ by: "human", press: "press-1", base: 1, revision: 2 });
  expect(person).toEqual(second.write);
  live.close();

  const again = await open();
  expect([(await again.next()).revision, (await again.next()).revision]).toEqual([1, 2]);
  again.close();
});

test("Pea's undo pops its edit off the one journal: pre-edit Work, a restore revision, and redo", async () => {
  const h = await fixture();
  const history = (direction: "undo" | "redo", expectedRevision: number, caller: Caller = pea()) =>
    h.post({ direction, expectedRevision }, caller, "history");
  expect(await history("undo", 0)).toMatchObject({ ok: false });
  await h.apply(width(20), 0);
  const before = ((await h.stored()) as { doc: unknown }).doc;
  const edited = await h.apply(
    [{ path: ["cells", "8781191", "edit"], value: { value: "200" } }],
    1,
    pea(),
  );
  expect(edited.write).toMatchObject({ kind: "apply", by: "pea", revision: 2 });

  // The same write a person's Undo sends (route/work-journal): one restore revision, no null left.
  const undone = await history("undo", 2);
  expect(undone.write).toMatchObject({ kind: "restore", by: "pea", base: 2, revision: 3 });
  expect(undone.doc).toEqual(before);
  expect(JSON.stringify(undone.doc)).not.toContain("null");
  expect(undone.write.patches).toEqual(edited.write.inverse);

  const redone = await history("redo", 3);
  expect(redone.write).toMatchObject({ kind: "restore", by: "pea", revision: 4 });
  expect(redone.doc.cells["8781191"].edit).toMatchObject({ value: "200", by: "pea" });
  expect(await history("redo", 4)).toMatchObject({ ok: false });

  // A person's restore and Pea's history walk the same stack: the person's undo is Pea's redo.
  expect((await h.restore(redone.write)).doc).toEqual(before);
  expect((await history("redo", 5)).doc.cells["8781191"].edit.value).toBe("200");

  // Undo steps through earlier edits in order, whoever made them; a new edit ends the redo branch.
  expect((await history("undo", 6)).doc).toEqual(before);
  expect((await history("undo", 7)).doc).toEqual(h.spec.schema.parse({}));
  await h.apply(width(30), 8);
  expect(await history("redo", 9)).toMatchObject({ ok: false });
  expect(await history("undo", 3)).toMatchObject({ ok: false, code: "stale_revision" });
});


test("wrong cell edit shape returns a concrete wrapper example and remains unchanged", async () => {
  const h = await fixture();
  const result = await h.post({patches: [{path: ["cells", "a", "edit"], value: {value: 1050}}], expectedRevision: 0, press: "bad-cell"});
  expect(result).toMatchObject({ok: false});
  expect(result.hint).toContain('Cell edits wrap the typed value');
  expect(result.hint).toContain('{"value":{"cfm":1050}}');
});
