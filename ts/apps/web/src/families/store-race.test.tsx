// @vitest-environment jsdom
/**
 * The store/write boundary under races. A fake Work server applies each write with the queue's
 * worst honest revision: the caller's explicit one, else the newest it holds (what `useRoute`
 * carries once an external write has been observed). The hook sees Work only when we rerender.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  applyPatches,
  familiesRouteState,
  familyCellKey,
  type FamiliesRouteDocument,
  type FamilyCellState,
  type RouteEnvelope,
  type RouteStatePatch,
} from "@pe/agent-contracts";

const server = vi.hoisted(() => ({
  envelope: null as unknown as RouteEnvelope<FamiliesRouteDocument>,
  shown: null as unknown as RouteEnvelope<FamiliesRouteDocument>,
  refuseNext: false,
  /** The queue's own chain, base → result, as `useRoute` keeps it (proven in schedules/seams). */
  own: new Map<number, number>(),
}));

vi.mock("#/route", async (original) => ({
  ...((await original()) as object),
  useRoute: () => ({
    page: [
      { selection: [], draft: { placement: "AllLoaded", categories: [], families: [] } },
      () => {},
    ],
    resolution: { kind: "unresolved" },
    readings: { receipts: { state: "absent" } },
    demo: false,
    busy: null,
    failure: null,
    work: {
      key: { binding: "host" as const, route: "families", target: null },
      doc: server.shown.doc,
      revision: server.shown.revision,
      write: async (patches: RouteStatePatch[], expectedRevision?: number | null) => {
        if (expectedRevision === null) return { code: "not-ready", message: "not read" };
        let bound = expectedRevision;
        if (bound !== undefined) while (server.own.has(bound)) bound = server.own.get(bound)!;
        if (server.refuseNext) {
          server.refuseNext = false;
          return { kind: "refused", message: "refused" };
        }
        const landed = applyPatches(
          familiesRouteState,
          server.envelope,
          "human",
          patches,
          bound ?? server.envelope.revision,
        );
        if (!landed.ok) return { code: "stale-revision", message: landed.error };
        server.own.set(landed.envelope.revision - 1, landed.envelope.revision);
        server.envelope = landed.envelope;
        return null;
      },
    },
  }),
}));
vi.mock("#/route/pods", async (original) => ({
  ...((await original()) as object),
  usePodList: () => [{ state: "absent" }, () => {}],
}));
vi.mock("#/readings", async (original) => ({
  ...((await original()) as object),
  useHostCall: () => ({ isPending: false }),
  useReading: () => ({ state: "absent" }),
  previousOf: () => undefined,
}));

import { reviewTransitions, runFanOut } from "#/components/lang/band";

import { useFamiliesStore } from "./store";

const x = { familyName: "F", typeName: "T", parameter: "X" };
const y = { familyName: "F", typeName: "T", parameter: "Y" };
const z = { familyName: "G", typeName: "T", parameter: "Z" };
const human = (value: string) => ({ value, storageType: "String" as const });
const pea = (value: string): FamilyCellState["proposal"] => ({
  value: { value, storageType: "String" },
});
const cell = (address: typeof x) => server.envelope.doc.cells[familyCellKey(address)];

function start(cells: Record<string, FamilyCellState> = {}) {
  server.envelope = {
    version: 1,
    revision: 1,
    doc: familiesRouteState.schema.parse({
      cells,
    }) as FamiliesRouteDocument,
  };
  server.shown = server.envelope;
  server.refuseNext = false;
  server.own.clear();
  const hook = renderHook(() => useFamiliesStore());
  /** Show the hook whatever Work the server now holds. */
  const observe = () => {
    server.shown = server.envelope;
    hook.rerender();
  };
  return { hook, observe, actions: () => verbs(hook.result.current) };
}

/**
 * The store's verbs as the matrix and the band press them: one address is the cell's own
 * transition, many is one `runFanOut`; every outcome is `{ refused? }` over the covered keys.
 */
function verbs(store: ReturnType<typeof useFamiliesStore>) {
  const cellVerb = async (kind: "accept" | "deny" | "unstage", addresses: (typeof x)[]) => {
    const keys = addresses.map(familyCellKey);
    if (keys.length === 1) {
      const own = reviewTransitions(store.wire, keys[0]!, store.cells[keys[0]!] ?? {}).find(
        (t) => t.kind === kind,
      );
      const refusal = own ? await own.run() : null;
      return { skipped: [], refused: refusal ? { ...refusal, addresses: keys } : undefined };
    }
    const out = await runFanOut(store.wire, store.cells, keys, kind);
    return {
      skipped: out.skipped,
      refused: out.refusal ? { ...out.refusal, addresses: out.covered } : undefined,
    };
  };
  return {
    propose: async (...args: Parameters<typeof store.actions.propose>) => ({
      refused: (await store.actions.propose(...args)) ?? undefined,
    }),
    accept: (addresses: (typeof x)[]) => cellVerb("accept", addresses),
    deny: (addresses: (typeof x)[]) => cellVerb("deny", addresses),
    unstage: (addresses: (typeof x)[]) => cellVerb("unstage", addresses),
  };
}

/** Another writer (Pea, another tab) lands directly on the server. */
const external = (patches: RouteStatePatch[]) => {
  const landed = applyPatches(
    familiesRouteState,
    server.envelope,
    "agent",
    patches,
    server.envelope.revision,
  );
  if (!landed.ok) throw Error(landed.error);
  server.envelope = landed.envelope;
};

afterEach(cleanup);

test("an external write racing a local write survives the next local write", async () => {
  const { observe, actions } = start();
  await act(() => actions().propose(x, human("A"), "base"));
  external([{ path: ["cells", familyCellKey(y), "proposal"], value: pea("B") }]);
  observe(); // Work now shows A and B together.
  await act(() => actions().propose(z, human("C"), "base"));
  expect(cell(y)?.proposal?.value.value).toBe("B");
  expect(cell(x)?.staged?.value.value).toBe("A");
  expect(cell(z)?.staged?.value.value).toBe("C");
});

test("a refused local write neither returns later nor erases an external write", async () => {
  const { observe, actions } = start();
  server.refuseNext = true;
  await act(() => actions().propose(x, human("A"), "base"));
  external([{ path: ["cells", familyCellKey(y), "proposal"], value: pea("B") }]);
  observe();
  await act(() => actions().propose(z, human("C"), "base"));
  expect(cell(y)?.proposal?.value.value).toBe("B");
  expect(cell(x)).toBeUndefined();
  expect(cell(z)?.staged?.value.value).toBe("C");
});

test("rapid successive local writes all land without an observation between them", async () => {
  const { actions } = start({ [familyCellKey(z)]: { proposal: pea("P"), staged: null } });
  await act(async () => {
    const all = actions();
    await Promise.all([
      all.propose(x, human("A"), "base"),
      all.propose(y, human("B"), "base"),
      all.deny([z]),
    ]);
  });
  expect(cell(x)?.staged?.value.value).toBe("A");
  expect(cell(y)?.staged?.value.value).toBe("B");
  expect(cell(z)?.proposal ?? null).toBeNull();
});

test("a counter-proposal arriving while a value is staged stands beside it", async () => {
  const { observe, actions } = start();
  await act(() => actions().propose(x, human("V"), "base"));
  external([{ path: ["cells", familyCellKey(x), "proposal"], value: pea("Q") }]);
  observe();
  await act(() => actions().propose(y, human("W"), "base"));
  expect(cell(x)?.staged?.value.value).toBe("V");
  expect(cell(x)?.proposal?.value.value).toBe("Q");
});

test("accept stages the proposal the person saw, never a newer unseen one", async () => {
  const { actions } = start({ [familyCellKey(x)]: { proposal: pea("SEEN"), staged: null } });
  // Pea revises the proposal; the person has not seen it yet.
  external([{ path: ["cells", familyCellKey(x), "proposal"], value: pea("UNSEEN") }]);
  await act(() => actions().accept([x]));
  expect(cell(x)?.proposal?.value.value).toBe("UNSEEN");
  expect(cell(x)?.staged?.value.value).not.toBe("UNSEEN");
});

test("each verb touches one rung: accept, counter, deny and unstage keep the other", async () => {
  const { observe, actions } = start({ [familyCellKey(x)]: { proposal: pea("P"), staged: null } });
  await act(() => actions().accept([x]));
  expect(cell(x)).toMatchObject({
    proposal: { value: { value: "P", storageType: "String" } },
    staged: { value: { value: "P", storageType: "String" } },
  });
  await act(() => actions().propose(x, human("H"), "base"));
  expect(cell(x)).toMatchObject({
    proposal: { value: { value: "P", storageType: "String" } },
    staged: { value: { value: "H", storageType: "String" } },
  });
  await act(() => actions().deny([x]));
  expect(cell(x)).toMatchObject({
    proposal: null,
    staged: { value: { value: "H", storageType: "String" } },
  });
  external([{ path: ["cells", familyCellKey(x), "proposal"], value: pea("R") }]);
  observe();
  await act(() => actions().unstage([x]));
  expect(cell(x)).toMatchObject({
    proposal: { value: { value: "R", storageType: "String" } },
    staged: null,
  });
  await act(() => actions().propose(y, human("base"), "base"));
  expect(cell(y)?.staged ?? null).toBeNull();
});

test("deny clears only the proposal the person saw, never a newer unseen one", async () => {
  const { actions } = start({ [familyCellKey(x)]: { proposal: pea("SEEN"), staged: null } });
  external([{ path: ["cells", familyCellKey(x), "proposal"], value: pea("UNSEEN") }]);
  await act(() => actions().deny([x]));
  expect(cell(x)?.proposal?.value.value).toBe("UNSEEN");
});

test("without a rendered revision, accept and deny refuse instead of writing unbound", async () => {
  const { hook, actions } = start({ [familyCellKey(x)]: { proposal: pea("P"), staged: null } });
  server.shown = { ...server.envelope, revision: null as never };
  hook.rerender();
  const before = server.envelope;
  let refusals!: unknown[];
  await act(async () => {
    refusals = [(await actions().accept([x])).refused, (await actions().deny([x])).refused];
  });
  expect(refusals).toEqual([
    expect.objectContaining({ code: "not-ready", addresses: [familyCellKey(x)] }),
    expect.objectContaining({ code: "not-ready", addresses: [familyCellKey(x)] }),
  ]);
  expect(server.envelope).toBe(before);
});

test("type then quick accept or deny lands; a foreign write between them refuses", async () => {
  const { actions } = start({
    [familyCellKey(x)]: { proposal: pea("P"), staged: null },
    [familyCellKey(y)]: { proposal: pea("Q"), staged: null },
  });
  const quick = actions(); // rendered before anything below lands
  expect((await act(() => quick.propose(z, human("T"), "base"))).refused).toBeUndefined();
  expect((await act(() => quick.accept([x]))).refused).toBeUndefined();
  expect((await act(() => quick.deny([y]))).refused).toBeUndefined();
  expect(cell(x)?.staged?.value.value).toBe("P");
  expect(cell(y)?.proposal ?? null).toBeNull();

  const { actions: again } = start({ [familyCellKey(x)]: { proposal: pea("P"), staged: null } });
  const late = again();
  await act(() => late.propose(z, human("T"), "base"));
  external([{ path: ["cells", familyCellKey(y), "proposal"], value: pea("F") }]);
  expect((await act(() => late.accept([x]))).refused).toMatchObject({ code: "stale-revision" });
  expect((await act(() => late.deny([x]))).refused).toMatchObject({ code: "stale-revision" });
  expect(cell(x)).toMatchObject({ proposal: { value: { value: "P", storageType: "String" } } });
  expect(cell(x)?.staged ?? null).toBeNull();
});

test("an aggregate accept skips a contested cell and refuses once for every covered cell", async () => {
  const { actions } = start({
    [familyCellKey(x)]: { proposal: pea("P"), staged: null },
    [familyCellKey(y)]: {
      proposal: pea("Q"),
      staged: { value: { value: "mine", storageType: "String" } },
    },
    [familyCellKey(z)]: { proposal: pea("R"), staged: null },
  });
  const all = actions();
  external([{ path: ["cells", familyCellKey(x), "proposal"], value: pea("NEWER") }]);
  const out = await act(() => all.accept([x, y, z]));
  expect(out.skipped).toEqual([{ key: familyCellKey(y), reason: "contested" }]);
  expect(out.refused).toMatchObject({
    code: "stale-revision",
    addresses: [familyCellKey(x), familyCellKey(z)],
  });
  expect(cell(y)?.staged?.value.value).toBe("mine");
});

test("an emptied cell stages the empty value; empty equal to the baseline stages nothing", async () => {
  const { actions } = start();
  // Rulings 2026-09-18 16:00 #3: an empty value is a value, so a person can clear a parameter.
  await act(() => actions().propose(x, human(""), "base"));
  expect(cell(x)?.staged).toEqual({ value: { value: "", storageType: "String" } });
  await act(() => actions().propose(y, human(""), ""));
  expect(cell(y)?.staged ?? null).toBeNull();
});
