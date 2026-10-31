// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import {
  type RouteEnvelope,
  type RouteStatePatch,
  type RouteStateSpec,
  type WorkKey,
  type WorkWrite,
  type WorkWriteAck,
} from "@pe/agent-contracts";
import {
  RouteWorkspace,
  type RouteWorkspaceEvent,
} from "../../../../packages/runtime/src/route-workspace";
import { writeRouteWork, startFreshRouteWork } from "./host";
import { writeRefusal } from "./refusal";

const transport = vi.hoisted(() => ({ response: vi.fn() }));
vi.mock("#/host/pe-client", () => ({ peClient: transport }));

const change = z.object({
  value: z.string(),
  by: z.enum(["human", "pea"]).optional(),
  at: z.string().optional(),
  base: z.number().optional(),
});
const schema = z.object({
  settings: z.record(z.string(), z.json()).default({}),
  rows: z.array(z.string()).default([]),
  cells: z
    .record(z.string(), z.object({ edit: change.optional(), suggestion: change.optional() }))
    .default({}),
  excluded: z
    .record(z.string(), z.object({ reason: z.string(), by: z.enum(["human", "pea"]).optional() }))
    .default({}),
  derived: z.number().default(0),
});
type Doc = z.infer<typeof schema>;
const spec: RouteStateSpec<typeof schema> = {
  route: "journal-spike",
  title: "Journal spike",
  description: "S0b deterministic undo boundary",
  schema,
  schemaVersion: 2,
  reconcileEdit: (draft) => {
    const doc = draft as Doc;
    return { ...doc, derived: doc.rows?.length ?? 0 };
  },
};

// Capture enclosing subtrees, including reconcileEdit's effects and newly created parents.
// This is a test oracle, not a production journal. Replay still uses the real writer.
function inverse(before: Doc, after: Doc): RouteStatePatch[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (key) => JSON.stringify(Reflect.get(before, key)) !== JSON.stringify(Reflect.get(after, key)),
    )
    .map((key) =>
      Object.hasOwn(before, key)
        ? { path: [key], value: structuredClone(Reflect.get(before, key)) }
        : { path: [key] },
    );
}
const overlaps = (a: RouteStatePatch["path"], b: RouteStatePatch["path"]) =>
  a.slice(0, Math.min(a.length, b.length)).every((part, index) => part === b[index]);

test("S0b: real Work writes need exact inverses, verb-press identity and Pea path barriers", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T20:00:00.000Z"));
  const initial = (): Doc =>
    schema.parse({
      settings: { width: 10, remove: "old", height: 4 },
      rows: ["first", "second"],
      derived: 2,
      cells: {
        old: {
          edit: { value: "prior", by: "pea", at: "2026-10-28T00:00:00.000Z", base: 0 },
          suggestion: { value: "suggested", by: "pea", at: "2026-10-28T00:00:00.000Z", base: 0 },
        },
      },
      excluded: { old: { reason: "prior", by: "pea" } },
    });
  let stored: RouteEnvelope<Doc> = { version: 1, revision: 0, doc: initial() };
  const asides = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations: [{ spec }],
    store: {
      getState: async ({ route }) =>
        structuredClone(route === spec.route ? stored : (asides.get(route) ?? null)),
      setState: async ({ route, value }) => {
        if (route === spec.route) stored = structuredClone(value) as RouteEnvelope<Doc>;
        else asides.set(route, structuredClone(value));
      },
    },
  });
  const events: RouteWorkspaceEvent[] = [];
  const unsubscribe = workspace.subscribe((event) => {
    events.push(event);
  });
  const key: WorkKey = { binding: "host", route: spec.route, target: null };
  const writer = {
    apply: async (
      patches: RouteStatePatch[],
      expectedRevision: number,
      _ack?: unknown,
      context = { press: crypto.randomUUID() },
    ) =>
      writeRefusal(
        await writeRouteWork(key, {
          kind: "apply",
          patches,
          expectedRevision,
          press: context.press,
        }),
      ),
    restore: async (patches: RouteStatePatch[], expectedRevision: number) =>
      writeRefusal(
        await writeRouteWork(key, { kind: "restore", patches, expectedRevision, press: null }),
      ),
    startFresh: async () => writeRefusal(await startFreshRouteWork(key)),
  };
  type Packet = WorkWrite;
  const packets: Packet[] = [];
  let accepted: WorkWriteAck;
  transport.response.mockImplementation(async (operation: string, request: { body: Packet }) => {
    if (operation === "work.fresh") {
      const result = await workspace.startFresh(key, spec.route, "human");
      if (result.ok) accepted = result.write!;
      return { ok: true, status: 200, json: async () => result };
    }
    expect(operation).toBe("work.apply");
    packets.push(structuredClone(request.body));
    const result = await workspace.write(key, spec.route, "human", request.body);
    if (result.ok) accepted = result.write!;
    return { ok: true, status: 200, json: async () => result };
  });
  const write = async (patches: RouteStatePatch[], press: string) => {
    // One dispatch context survives both real write doors.
    const refusal = await Reflect.apply(writer.apply, writer, [
      patches,
      stored.revision,
      undefined,
      { press },
    ]);
    expect(refusal).toBeNull();
    return packets.at(-1)!;
  };
  try {
    const cases: { name: string; patches: RouteStatePatch[] }[] = [
      { name: "scalar replacement", patches: [{ path: ["settings", "width"], value: 20 }] },
      { name: "key insertion", patches: [{ path: ["settings", "new"], value: true }] },
      { name: "key deletion", patches: [{ path: ["settings", "remove"] }] },
      {
        name: "missing parent creation",
        patches: [{ path: ["settings", "nested", "cap"], value: 3 }],
      },
      { name: "null value", patches: [{ path: ["settings", "width"], value: null }] },
      {
        name: "array replacement and reconciliation",
        patches: [{ path: ["rows"], value: ["third"] }],
      },
      {
        name: "overlapping patches",
        patches: [
          { path: ["settings"], value: { width: 20 } },
          { path: ["settings", "width"], value: 30 },
        ],
      },
      {
        name: "new stamped cell",
        patches: [{ path: ["cells", "new", "edit"], value: { value: "new" } }],
      },
      {
        name: "existing stamped edit",
        patches: [{ path: ["cells", "old", "edit"], value: { value: "changed" } }],
      },
      { name: "stamped edit deletion", patches: [{ path: ["cells", "old", "edit"] }] },
      {
        name: "existing stamped suggestion",
        patches: [{ path: ["cells", "old", "suggestion"], value: { value: "changed" } }],
      },
      {
        name: "existing stamped exclusion",
        patches: [{ path: ["excluded", "old"], value: { reason: "changed" } }],
      },
      { name: "empty-path no-op", patches: [{ path: [], value: {} }] },
    ];
    for (const one of cases) {
      stored = { version: 1, revision: 0, doc: initial() };
      const before = structuredClone(stored.doc);
      await write(one.patches, one.name);
      const undo = accepted!.inverse;
      expect(await writer.restore(undo, stored.revision)).toBeNull();
      expect
        .soft(JSON.stringify(stored.doc), `${one.name}: inverse restores prior document bytes`)
        .toBe(JSON.stringify(before));
    }

    const beforeRejected = JSON.stringify(stored);
    expect(
      await writer.apply([{ path: ["rows", 0], value: "changed" }], stored.revision),
    ).toMatchObject({ code: "failed" });
    expect(
      JSON.stringify(stored),
      "numeric descent into arrays is refused, so it creates no undo step",
    ).toBe(beforeRejected);

    stored = { version: 1, revision: 0, doc: initial() };
    events.length = 0;
    packets.length = 0;
    type Step = {
      press: string | null | undefined;
      forward: RouteStatePatch[];
      inverse: RouteStatePatch[];
    };
    // Reference journal policy only. Production has no per-Work journal to exercise yet.
    const steps: Step[] = [];
    const recordHuman = async (patches: RouteStatePatch[], press: string) => {
      const before = structuredClone(stored.doc);
      const packet = await write(patches, press);
      expect
        .soft(packet, "press id must survive the kernel host door and work.apply body parsing")
        .toHaveProperty("press", press);
      const previous = steps.at(-1);
      // Reference policy groups only a press id, never elapsed time. Missing ids are ambiguous.
      if (previous && previous.press === packet.press) previous.forward.push(...packet.patches);
      else
        steps.push({
          press: packet.press,
          forward: packet.patches,
          inverse: inverse(before, stored.doc),
        });
    };
    const cap = (value: number): RouteStatePatch[] => [{ path: ["settings", "width"], value }];
    await recordHuman(cap(11), "cap-press-1");
    vi.setSystemTime(new Date(Date.now() + 10));
    await recordHuman(cap(12), "cap-press-2");
    expect
      .soft(steps, "two cap presses on one path, 10 ms apart, must be two steps")
      .toHaveLength(2);

    // Pea writes bypass the browser writer. Only the real workspace publication reaches it.
    expect(await workspace.apply(key, spec.route, "pea", cap(99), stored.revision)).toMatchObject({
      ok: true,
    });
    const pea = events.at(-1)!;
    expect(pea.by).toBe("pea");
    expect
      .soft(pea, "foreign accepted writes need paths for selective barriers")
      .toMatchObject({ press: null, patches: cap(99) });
    const barrier = (pea as RouteWorkspaceEvent & { patches?: RouteStatePatch[] }).patches ?? [];
    const count = steps.length;
    for (let index = steps.length - 1; index >= 0; index--)
      if (
        steps[index].inverse.some((undo) =>
          barrier.some((patch) => overlaps(undo.path, patch.path)),
        )
      )
        steps.splice(index, 1);
    expect.soft(steps.length, "Pea is never appended as an undo step").toBeLessThanOrEqual(count);
    expect
      .soft(steps, "Pea invalidates earlier human inverses that overlap its paths")
      .toHaveLength(0);
    const candidate = steps.at(-1);
    if (candidate) expect(await writer.restore(candidate.inverse, stored.revision)).toBeNull();
    expect
      .soft(stored.doc.settings.width, "Ctrl+Z must preserve Pea's width after its barrier")
      .toBe(99);

    // Recovery returns a host-issued inverse for the unreadable preimage kept in the aside. Only a
    // Work an OLDER schema wrote may be set aside (ADR 0026); unmarked or newer Work refuses.
    const unreadable = { legacy: true };
    stored = { version: 1, schemaVersion: 1, revision: 7, doc: unreadable as unknown as Doc };
    expect(await writer.startFresh()).toBeNull();
    expect(asides.get(`${spec.route}:aside:1`)).toEqual({
      version: 1,
      schemaVersion: 1,
      revision: 7,
      doc: unreadable,
    });
    const recoveryInverse = accepted!.inverse;
    expect
      .soft(
        await writer.restore(recoveryInverse, stored.revision),
        "startFresh has no schema-valid inverse through apply",
      )
      .toBeNull();
    expect
      .soft(JSON.stringify(stored.doc), "startFresh inverse restores unreadable document bytes")
      .toBe(JSON.stringify(unreadable));
  } finally {
    unsubscribe();
    transport.response.mockReset();
    vi.useRealTimers();
  }
});
