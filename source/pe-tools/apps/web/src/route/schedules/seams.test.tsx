// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { act, cleanup, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import type { ScheduleGridDocument } from "@pe/agent-contracts";
import { appAtomRegistry, useRoute, type RouteHandle } from "#/route";
import { setup } from "../../../../host/tests/schedule-test-fixture";
import { LiveScheduleGridWorkspace } from "./live";
import {
  schedulesManifest,
  type ScheduleGridAction,
  type ScheduleGridPage,
  type ScheduleGridReading,
} from "./manifest";
import { ScheduleGridWorkspace, type ScheduleGridState } from "./workspace";

vi.mock("#/lib/token", () => ({ token: () => "currentColor", dash: () => "none" }));

const sources: { close(): void; onerror: EventSource["onerror"] }[] = [];
const opened: string[] = [];
afterEach(async () => {
  cleanup();
  opened.length = 0;
  for (const source of sources.splice(0)) source.close();
  vi.stubGlobal(
    "EventSource",
    class {
      onmessage = null;
      onerror = null;
      close() {}
    },
  );
  // Route Reading atoms retain their last observation for the app registry's 400 ms idle TTL.
  await new Promise((resolve) => setTimeout(resolve, 450));
});

/** Same SSE adapter as live.test.tsx; the fixture app owns every frame. */
function sourceClass(app: { fetch: (request: Request) => Response | Promise<Response> }) {
  return class Source {
    onmessage: EventSource["onmessage"] = null;
    onerror: EventSource["onerror"] = null;
    onopen: EventSource["onopen"] = null;
    closed = false;
    abort = new AbortController();
    constructor(url: string) {
      sources.push(this);
      opened.push(url);
      void (async () => {
        const response = await app.fetch(
          new Request(new URL(url, "http://host"), { signal: this.abort.signal }),
        );
        const reader = response.body!.getReader();
        this.onopen?.call(this as unknown as EventSource, new Event("open"));
        try {
          while (!this.closed) {
            const next = await reader.read();
            if (next.done) break;
            this.onmessage?.call(
              this as unknown as EventSource,
              new MessageEvent("message", { data: new TextDecoder().decode(next.value).slice(6) }),
            );
          }
        } catch {
          /* closing cancels production stream */
        }
      })();
    }
    close() {
      this.closed = true;
      this.abort.abort();
    }
  };
}

function stubBrowser(app: Parameters<typeof sourceClass>[0]) {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("EventSource", sourceClass(app));
}

test("no Work is subscribed and no bridge is claimed before a reading gives the address", async () => {
  const f = await setup();
  stubBrowser(f.app);
  const mounted = render(
    <RegistryContext.Provider value={appAtomRegistry}>
      {/* No workspaceId and no reading: the address does not exist yet. */}
      <LiveScheduleGridWorkspace />
    </RegistryContext.Provider>,
  );
  await screen.findByText("bridge connecting");
  // The document-scoped slice used to open here and report "bridge connected" over Work that
  // schedule.grid.push refuses for having no workspaceId.
  expect(screen.queryByText("bridge connected")).toBeNull();
  expect(opened.filter((url) => decodeURIComponent(url).includes("schedules"))).toEqual([]);
  mounted.unmount();
});

test("two authored patches fired without awaiting both land, and a refetch is not a disconnection", async () => {
  const f = await setup();
  stubBrowser(f.app);
  await f.patch([{ path: ["cells"], value: {} }]);
  const connected: (boolean | null)[] = [];
  const refreshing: boolean[] = [];
  let handle!: ScheduleGridState;
  const mounted = render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={f.scope.work}
        // The document is the thread's; this test pins it instead of standing up a head.

        target={JSON.stringify({ kind: "open", ref: f.b })}
        render={(state) => {
          handle = state;
          connected.push(state.connected);
          refreshing.push(state.refreshing);
          return <ScheduleGridWorkspace state={state} />;
        }}
      />
    </RegistryContext.Provider>,
  );
  await screen.findByText("bridge connected");
  await screen.findByDisplayValue("100 VA");
  connected.length = 0;
  refreshing.length = 0;

  // Two gestures in one tick, exactly as the grid fires them: neither awaits the other.
  let both!: Awaited<ReturnType<typeof Promise.all<ReturnType<ScheduleGridState["apply"]>[]>>>;
  await act(async () => {
    const first = handle.apply([{ path: ["cells", "1::2", "staged"], value: { value: "175 VA" } }]);
    const second = handle.apply([{ path: ["cells", "1::1", "staged"], value: { value: "P-2" } }]);
    both = await Promise.all([first, second]);
  });
  expect(both[0]).toBeNull();
  expect(both[1]).toBeNull();
  const doc = (await f.view()).doc;
  expect(doc.cells["1::2"]?.staged?.value).toBe("175 VA");
  expect(doc.cells["1::1"]?.staged?.value).toBe("P-2");

  // Subscription changes can briefly re-establish the shared Reading stream, but the Work does
  // not become a dead bridge and settles current without another gesture.
  await vi.waitFor(() => expect(handle.refreshing).toBe(false));
  expect(connected).toContain(true);

  mounted.unmount();
});

test("a re-establishing stream reads as refreshing, not as a dead bridge", () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
  // The refusal is real — an undeclared write is refused while the resource is stale — but the
  // operator was told "nothing arrives and nothing can be pushed", which reads as a lost session.
  render(
    <ScheduleGridWorkspace
      state={{
        slice: null,
        hydrated: true,
        refreshing: true,
        peaActive: false,
        connected: false,
        failure: null,
        apply: async () => ({ code: "not-ready", message: "stale" }),
        execute: async () => null,
        snapshot: null,
        catalog: null,
        busy: null,
        blockedBecause:
          "The route-state stream is re-establishing — writes are refused until it settles",
      }}
    />,
  );
  expect(screen.getByText("bridge refreshing")).toBeTruthy();
  expect(screen.queryByText("bridge disconnected")).toBeNull();
  const push = screen.getByRole("button", { name: /push 0 to Revit/i });
  expect(push.hasAttribute("disabled")).toBe(true);
  expect(push.getAttribute("title")).toContain("re-establishing");
});

test("the original unresolved receipt still blocks apply after the address changes and returns", async () => {
  const f = await setup();
  stubBrowser(f.app);
  await f.patch([{ path: ["cells"], value: {} }]);
  let handle!: ScheduleGridState;
  const view = (workspaceId: string) => (
    <RegistryContext.Provider value={appAtomRegistry}>
      <LiveScheduleGridWorkspace
        workspaceId={workspaceId}
        // The document is the thread's; this test pins it instead of standing up a head.

        target={JSON.stringify({ kind: "open", ref: f.b })}
        render={(state) => {
          handle = state;
          return <ScheduleGridWorkspace state={state} />;
        }}
      />
    </RegistryContext.Provider>
  );
  const recover = "Recover or resume the original receipt before a new apply";
  const mounted = render(view(f.scope.work));
  let pushed: Promise<unknown> | undefined;
  try {
    await screen.findByDisplayValue("100 VA");
    await act(async () => {
      await handle.apply([{ path: ["cells", "1::2", "staged"], value: { value: "175 VA" } }]);
    });
    await vi.waitFor(() => expect(handle.blockedBecause).toBeNull());
    f.hold();
    pushed = handle.execute("push");
    await vi.waitFor(() => expect(handle.blockedBecause).toBe(recover), { timeout: 10_000 });

    // A different schedule is a different Work store; it must not inherit this one's receipt…
    mounted.rerender(view("schedule:elsewhere"));
    await vi.waitFor(() => expect(handle.blockedBecause).not.toBe(recover));
    // …and coming back must not have erased it.
    mounted.rerender(view(f.scope.work));
    await vi.waitFor(() => expect(handle.blockedBecause).toBe(recover), { timeout: 10_000 });
  } finally {
    f.release();
    // Let the held native call finish before the fixture removes its temp workspace.
    await pushed?.catch(() => undefined);
    mounted.unmount();
  }
});

test("the apply queue keeps an explicit expectedRevision explicit and does not poison the next write", async () => {
  const f = await setup();
  stubBrowser(f.app);
  await f.patch([{ path: ["cells"], value: {} }]);
  let work!: RouteHandle<
    ScheduleGridDocument,
    ScheduleGridReading,
    ScheduleGridPage,
    ScheduleGridAction
  >["work"];
  function Probe() {
    work = useRoute(schedulesManifest(), { work: f.scope.work }).work;
    return <span>{String(work.revision)}</span>;
  }
  const mounted = render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <Probe />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => {
    expect(work.revision).not.toBeNull();
    expect(work.current).toBe(true);
  });
  const start = (await f.view()).revision;

  let landed!: Awaited<ReturnType<typeof work.write>>[];
  await act(async () => {
    // 1) undeclared — sets the queue's carried revision.
    const first = work.write([{ path: ["cells", "9::1", "staged"], value: { value: "A" } }]);
    // 2) EXPLICIT and deliberately stale. The queue must not overwrite it with (1)'s success:
    //    a caller-declared conflict is the caller's to receive.
    const second = work.write(
      [{ path: ["cells", "9::2", "staged"], value: { value: "B" } }],
      start - 1,
    );
    // 3) undeclared, queued behind a refusal. The refusal must not poison it.
    const third = work.write([{ path: ["cells", "9::3", "staged"], value: { value: "C" } }]);
    landed = await Promise.all([first, second, third]);
  });

  expect(landed[0]).toBeNull();
  expect(landed[1]).toMatchObject({ code: "stale-revision" });
  expect(landed[2]).toBeNull();
  const view = await f.view();
  expect(view.doc.cells["9::1"]?.staged?.value).toBe("A");
  expect(view.doc.cells["9::2"]).toBeUndefined();
  expect(view.doc.cells["9::3"]?.staged?.value).toBe("C");
  // Two writes landed, not three, and neither was retried behind the caller's back.
  expect(view.revision).toBe(start + 2);
  mounted.unmount();
});

/** A mounted schedules route over the fixture; `route()` is its latest handle. */
async function mountWork() {
  const f = await setup();
  stubBrowser(f.app);
  await f.patch([{ path: ["cells"], value: {} }]);
  let route!: Pick<
    RouteHandle<ScheduleGridDocument, ScheduleGridReading, ScheduleGridPage, ScheduleGridAction>,
    "work" | "failure"
  >;
  function Probe() {
    route = useRoute(schedulesManifest(), { work: f.scope.work });
    return <span>{String(route.work.revision)}</span>;
  }
  const mounted = render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <Probe />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => {
    expect(route.work.revision).not.toBeNull();
    expect(route.work.current).toBe(true);
  });
  const rendered = route.work.revision!;
  expect(rendered).toBe((await f.view()).revision);
  return { f, mounted, rendered, route: () => route };
}
const stage = (key: string, value: string) => [
  { path: ["cells", key, "staged"], value: { value } },
];

test("a bound write follows the owner's own landed writes past its rendered revision", async () => {
  const { f, mounted, rendered, route } = await mountWork();
  let landed!: unknown[];
  await act(async () => {
    const work = route().work;
    // Type, then accept at once: the accept was rendered before the typed write landed.
    landed = await Promise.all([
      work.write(stage("7::1", "typed")),
      work.write(stage("7::2", "accepted"), rendered),
      work.write(stage("7::3", "denied"), rendered),
    ]);
  });
  expect(landed).toEqual([null, null, null]);
  expect((await f.view()).revision).toBe(rendered + 3);
  mounted.unmount();
});

test("a foreign write between the owner's write and a bound write still refuses", async () => {
  const { f, mounted, rendered, route } = await mountWork();
  let landed!: unknown[];
  await act(async () => {
    const work = route().work;
    const typed = await work.write(stage("8::1", "typed"));
    await f.patch(stage("8::9", "foreign"));
    landed = [typed, await work.write(stage("8::2", "accepted"), rendered)];
  });
  expect(landed[0]).toBeNull();
  expect(landed[1]).toMatchObject({ code: "stale-revision" });
  expect((await f.view()).doc.cells["8::2"]).toBeUndefined();
  mounted.unmount();
});

test("a bound write with no rendered revision refuses as not-ready and says so", async () => {
  const { f, mounted, rendered, route } = await mountWork();
  let refusal: unknown;
  await act(async () => {
    refusal = await route().work.write(stage("6::1", "unbound"), null);
  });
  expect(refusal).toMatchObject({ code: "not-ready" });
  expect(route().failure).toMatchObject({ code: "not-ready" });
  expect((await f.view()).revision).toBe(rendered);
  mounted.unmount();
});

/** An action whose run writes one cell through `ctx.write`, from the snapshot it was built at. */
async function mountAction() {
  const f = await setup();
  stubBrowser(f.app);
  await f.patch([{ path: ["cells"], value: {} }]);
  const base = schedulesManifest();
  const manifest = {
    ...base,
    actions: {
      ...base.actions,
      poke: {
        label: "poke",
        says: "writes one cell",
        needs: "host" as const,
        actor: "any" as const,
        input: z.void(),
        dirties: [],
        ready: () => null,
        run: async (ctx: { write: (patches: unknown[]) => Promise<unknown> }) => {
          await ctx.write(stage("5::1", "action"));
        },
      },
    },
  } as unknown as ReturnType<typeof schedulesManifest>;
  let route!: ReturnType<typeof useRoute>;
  function Probe() {
    route = useRoute(manifest, { work: f.scope.work }) as never;
    return <span>{String(route.work.revision)}</span>;
  }
  const mounted = render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <Probe />
    </RegistryContext.Provider>,
  );
  await vi.waitFor(() => expect(route.work.current).toBe(true));
  return { f, mounted, route: () => route };
}

test("an action's write follows the owner's own writes past its snapshot, and a foreign write still refuses", async () => {
  for (const foreign of [false, true]) {
    const { f, mounted, route } = await mountAction();
    const poke = (route().actions as Record<string, { run: () => Promise<unknown> }>).poke!;
    let refusal: unknown;
    await act(async () => {
      expect(await route().work.write(stage("5::0", "own"))).toBeNull();
      if (foreign) await f.patch(stage("5::9", "foreign"));
      refusal = await poke.run();
    });
    if (foreign) expect(refusal).toMatchObject({ code: "stale-revision" });
    else {
      expect(refusal).toBeNull();
      expect((await f.view()).doc.cells["5::1"]?.staged?.value).toBe("action");
    }
    mounted.unmount();
  }
});

test("a push run line says where its receipt lives and each cell before → after", async () => {
  const { pushRunLine } = await import("./manifest");
  const cells = [{ cell: "2::1", before: "R-32", after: "R-454B" }];
  expect(pushRunLine({ podId: "demo", outcome: "Succeeded", cells }, "output/run-1")).toBe(
    "Succeeded · demo · output/run-1/receipt.json · 2::1 R-32 → R-454B",
  );
  expect(pushRunLine({ podId: null, outcome: "Succeeded", cells }, null)).toBe(
    "Succeeded · action receipt (no pod bound) · 2::1 R-32 → R-454B",
  );
});

test("a refused cell reads refused with its reason, keyed on its code when it carries one", async () => {
  const { pushRunLine } = await import("./manifest");
  const cells = [
    { cell: "7::1", before: "Main", after: "R7" },
    {
      cell: "8::1",
      before: "Main",
      after: "oob",
      error: "Expected target evidence is stale: element 1 changed",
      code: "stale-staged-cell",
    },
    {
      cell: "9::1",
      before: "Main",
      after: "oob",
      error: "Expected target evidence is stale: element 2 changed",
    },
  ];
  expect(pushRunLine({ podId: null, outcome: "Succeeded", cells }, null)).toBe(
    "Partly applied · action receipt (no pod bound) · 7::1 Main → R7, 8::1 refused (stale), 9::1 refused (Expected target evidence is stale)",
  );
});
