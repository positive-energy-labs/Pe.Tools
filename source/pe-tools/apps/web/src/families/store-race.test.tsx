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
      key: { route: "families", target: null },
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

import { useFamiliesStore } from "./store";

const x = { familyId: 1, typeName: "T", parameter: "X" };
const y = { familyId: 1, typeName: "T", parameter: "Y" };
const z = { familyId: 2, typeName: "T", parameter: "Z" };
const human = (value: string) => ({ familyName: "F", value });
const pea = (value: string): FamilyCellState["proposal"] => ({
  value: { familyName: "F", value },
  by: "pea",
});
const cell = (address: typeof x) => server.envelope.doc.cells[familyCellKey(address)];

function start(cells: Record<string, FamilyCellState> = {}) {
  server.envelope = {
    version: 1,
    revision: 1,
    doc: familiesRouteState.schema.parse({
      scope: null,
      excludedIds: [],
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
  return { hook, observe, actions: () => hook.result.current.actions };
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
    proposal: { value: { value: "P" } },
    staged: { value: { value: "P" } },
  });
  await act(() => actions().propose(x, human("H"), "base"));
  expect(cell(x)).toMatchObject({
    proposal: { value: { value: "P" } },
    staged: { value: { value: "H" } },
  });
  await act(() => actions().deny([x]));
  expect(cell(x)).toMatchObject({ proposal: null, staged: { value: { value: "H" } } });
  external([{ path: ["cells", familyCellKey(x), "proposal"], value: pea("R") }]);
  observe();
  await act(() => actions().unstage([x]));
  expect(cell(x)).toMatchObject({ proposal: { value: { value: "R" } }, staged: null });
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
    refusals = [await actions().accept([x]), await actions().deny([x])];
  });
  expect(refusals).toEqual([
    expect.objectContaining({ code: "not-ready" }),
    expect.objectContaining({ code: "not-ready" }),
  ]);
  expect(server.envelope).toBe(before);
});

test("type then quick accept or deny lands; a foreign write between them refuses", async () => {
  const { actions } = start({
    [familyCellKey(x)]: { proposal: pea("P"), staged: null },
    [familyCellKey(y)]: { proposal: pea("Q"), staged: null },
  });
  const quick = actions(); // rendered before anything below lands
  expect(await act(() => quick.propose(z, human("T"), "base"))).toBeNull();
  expect(await act(() => quick.accept([x]))).toBeNull();
  expect(await act(() => quick.deny([y]))).toBeNull();
  expect(cell(x)?.staged?.value.value).toBe("P");
  expect(cell(y)?.proposal ?? null).toBeNull();

  const { actions: again } = start({ [familyCellKey(x)]: { proposal: pea("P"), staged: null } });
  const late = again();
  await act(() => late.propose(z, human("T"), "base"));
  external([{ path: ["cells", familyCellKey(y), "proposal"], value: pea("F") }]);
  expect(await act(() => late.accept([x]))).toMatchObject({ code: "stale-revision" });
  expect(await act(() => late.deny([x]))).toMatchObject({ code: "stale-revision" });
  expect(cell(x)).toMatchObject({ proposal: { value: { value: "P" } } });
  expect(cell(x)?.staged ?? null).toBeNull();
});
