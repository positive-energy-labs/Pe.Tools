// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import * as Atom from "effect/unstable/reactivity/Atom";
import { address, type Reading, type ReadingRequest, type WorkKey } from "@pe/agent-contracts";
import { familiesSpec } from "./manifest";
import { useFamiliesStore } from "./store";
import type { FamiliesObservation } from "./host";

const calls = vi.hoisted(() => ({
  read: vi.fn(),
  cancel: vi.fn(),
  fetch: vi.fn(),
  write: vi.fn(),
}));
vi.mock("./host", async (original) => ({
  ...(await original<typeof import("./host")>()),
  readFamiliesObservation: calls.read,
  cancelFamiliesObservation: calls.cancel,
}));
vi.mock("#/host/runtime", () => ({ hostFetch: calls.fetch }));
vi.mock("#/host/client", () => ({
  hostUrl: (path: string) => `http://host${path}`,
  callHostRpc: vi.fn(() => {
    throw Error("unexpected RPC");
  }),
}));

// Only acquisition and persistence are faked. useRoute's action scope, Page owner,
// manifest read verb, store effects and progressive parts assembly all run unchanged.
const refs = {
  A: { session: "families-session", openId: "document-A" },
  B: { session: "families-session", openId: "document-B" },
};
vi.mock("#/route/route-target", () => ({
  useRouteTarget: (_manifest: unknown, _registry: unknown, _seed: unknown, target: "A" | "B") => ({
    inventoryResult: { state: "ready", observation: {} },
    resolution: { kind: "resolved", target: { kind: "document", ref: refs[target] } },
    bindingLost: null,
    bindingLostRef: { current: null },
    resolvedAddress: address(`C:/Models/${target}.rvt`),
    workAddress: address(`C:/Models/${target}.rvt`),
    workOpen: null,
    targetProvenance: { source: "url-pin", raw: target },
  }),
}));
const absent = { state: "absent" } as const;
const matrix = new Map<string, Atom.Writable<Reading<unknown>>>();
const sources = new Map<string, Atom.Atom<Reading<unknown>>>();
vi.mock("#/readings", async (original) => ({
  ...(await original<typeof import("#/readings")>()),
  readingAtom: (request: ReadingRequest) => {
    if (request.kind === "families-matrix") {
      const key = request.target.openId;
      if (!matrix.has(key)) matrix.set(key, Atom.make<Reading<unknown>>(absent));
      return matrix.get(key)!;
    }
    const key = JSON.stringify(request);
    if (!sources.has(key)) sources.set(key, Atom.make({ state: "ready", observation: [] }));
    return sources.get(key)!;
  },
  targetInventory: () => ({
    kind: "ready",
    sessions: {
      "families-session": {
        kind: "ready",
        values: [
          { openId: refs.A.openId, kind: "project" },
          { openId: refs.B.openId, kind: "project" },
        ],
      },
    },
  }),
  useHostCall: () => ({ isPending: false }),
  useReading: () => absent,
  dirty: vi.fn(),
}));
const workSlices = new Map<string, Atom.Atom<unknown>>();
vi.mock("#/route/route-work", async (original) => ({
  ...(await original<typeof import("#/route/route-work")>()),
  docAtom: (_spec: unknown, key: WorkKey) => {
    const id = JSON.stringify(key);
    if (!workSlices.has(id))
      workSlices.set(
        id,
        Atom.make({
          state: "ready",
          observation: { doc: null, revision: 0 },
        }),
      );
    return workSlices.get(id)!;
  },
  docWriter: (_spec: unknown, key: WorkKey) => ({
    apply: (patches: unknown[], revision: number) => calls.write(key, patches, revision),
  }),
}));
const pods = { state: "ready", observation: [] } as const;
vi.mock("#/route/pods", () => ({ usePodList: () => [pods, vi.fn()] }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const family = {
  familyId: 1,
  familyUniqueId: "late-A-family",
  familyName: "Only in A",
  typeNames: ["24x24"],
  parameters: [],
  issues: [],
  isPartial: false,
  placedInstanceCount: 1,
};

test("late A parts and completion cannot enter B or a returned A; an unchanged A still completes", async () => {
  for (const route of [["B"], ["B", "A"], []] as const) {
    matrix.clear();
    sources.clear();
    workSlices.clear();
    calls.write.mockClear();
    calls.read.mockClear();
    calls.fetch.mockClear();
    calls.write.mockResolvedValue(null);
    let complete!: (reading: FamiliesObservation) => void;
    calls.read.mockImplementation(
      () =>
        new Promise<FamiliesObservation>((resolve) => {
          complete = resolve;
        }),
    );
    let deliverPart!: (response: Response) => void;
    let starting!: FamiliesObservation;
    calls.fetch.mockImplementation((url: string) => {
      const query = new URL(url).searchParams;
      if (query.get("record") === "late-A-part")
        return new Promise<Response>((resolve) => {
          deliverPart = resolve;
        });
      if (query.get("format") === "parts")
        return Promise.resolve(
          Response.json({
            reading: {
              ...starting,
              id: "A-progress",
              progress: {
                ...starting.progress!,
                completed: 1,
                total: 2,
              },
            },
            records: ["late-A-part"],
          }),
        );
      throw Error(`unexpected fetch: ${url}`);
    });

    const hook = renderHook(({ target }) => useFamiliesStore({ target }), {
      initialProps: { target: "A" },
    });
    act(() =>
      hook.result.current.setPage({
        stage: "audit",
        draft: { categories: ["Air Terminals"], families: null, placement: "PlacedOnly" },
      }),
    );
    let pending!: ReturnType<typeof hook.result.current.handle.actions.read.run>;
    await act(async () => {
      pending = hook.result.current.handle.actions.read.run();
    });
    expect(calls.read).toHaveBeenCalledTimes(1);
    starting = hook.result.current.page.reading!;
    expect(starting.document).toEqual(refs.A);
    expect(starting.progress?.state).toBe("reading");

    // Start the real parts fetch while A owns it, but hold the immutable body in flight.
    await act(async () =>
      hook.result.current.handle.registry.set(matrix.get(refs.A.openId)!, {
        state: "ready",
        observation: { bodyVersion: "A-progress" },
      }),
    );
    expect(deliverPart).toBeTypeOf("function");
    for (const target of route) hook.rerender({ target });

    const snapshot = () => {
      const store = hook.result.current;
      return {
        display: store.page.reading,
        work: {
          key: store.handle.work.key,
          doc: store.handle.work.doc,
          revision: store.handle.work.revision,
        },
        readiness: familiesSpec.targetReady!({
          target: { kind: "document", ref: store.documentTarget! },
          page: store.page,
          work: store.handle.work,
        } as never),
      };
    };
    const before = snapshot();
    expect(before.display?.result.families).toEqual([]);
    expect(before.readiness).toBe("Complete this Families read before planning edits");
    await act(async () => {
      deliverPart(Response.json(family));
    });
    if (route.length) {
      expect.soft(snapshot(), `late parts after A→${route.join("→")}`).toEqual(before);
      expect(calls.write).not.toHaveBeenCalled();
    } else {
      expect(hook.result.current.page.reading?.result.families).toEqual([family]);
    }
    const afterParts = snapshot();

    await act(async () => {
      complete({
        ...starting,
        id: "A-complete",
        envelope: { revision: 1 },
        progress: { ...starting.progress!, state: "complete", completed: 2, total: 2 },
        result: { families: [family], issues: [], page: null },
      });
      await pending;
    });
    if (route.length) {
      expect(snapshot(), `late completion after A→${route.join("→")}`).toEqual(afterParts);
      expect(calls.write).not.toHaveBeenCalled();
    } else {
      expect(hook.result.current.page.reading?.id).toBe("A-complete");
      expect(snapshot().readiness).toBeNull();
      expect(calls.write).toHaveBeenCalledExactlyOnceWith(
        starting.work,
        [{ path: ["scope", "edit"], value: { value: starting.filter } }],
        1,
      );
    }
    expect(hook.result.current.handle.failure).toBeNull();
    console.info(
      `A${route.length ? `→${route.join("→")}` : " unchanged"}: parts=${
        hook.result.current.page.reading?.id
      }; Work writes=${calls.write.mock.calls.length}; readiness=${snapshot().readiness}`,
    );
    hook.unmount();
  }
});
