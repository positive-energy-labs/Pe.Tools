/**
 * Mounted journeys of a change of target. The shell is production: the Place, the route target,
 * the document picker and the typed mount, over one fixture host per document. Recorded: the
 * census (inventory and machine), the native boundary, and the command door.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, vi } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import type { TypedRoute } from "@pe/web-kernel/route/typed-route";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture";
import { ref } from "../../../host/tests/host-read-graph.test-support";
import { peReadings } from "../host/resource-stream";
import { readingAtom } from "../host/resource-state";
import { routeRegistry } from "../route/registry";
import { hosted, type JourneyDocument, type Native } from "./mounted-journey.test-support";
import { StandaloneBand } from "./band.test-support";
import { appAtomRegistry } from "./owner";
import type { TypedMount } from "./typed-mount";
import { TypedShell } from "./typed-shell";

// jsdom has no layout: the panes that measure themselves get an observer that never fires.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
const world = vi.hoisted(() => ({
  inventory: { state: "absent" } as unknown,
  machine: { state: "absent" } as unknown,
  atoms: new Map<unknown, "inventory" | "machine">(),
  listeners: new Set<() => void>(),
  ports: (_openId: string | undefined): object => ({}),
  mounts: [] as unknown[],
}));
const census = (notify: () => void) => {
  world.listeners.add(notify);
  return () => void world.listeners.delete(notify);
};
vi.mock("./owner", async (original) => {
  const real = await original<typeof import("./owner")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...real,
    useOwned: (registry: never, atom: never) => {
      const kind = world.atoms.get(atom);
      const owned = real.useOwned(registry, kind ? null : atom);
      const seen = useSyncExternalStore(census, () => (kind ? world[kind] : null));
      return kind ? seen : owned;
    },
  };
});
vi.mock("../host/resource-state", async (original) => {
  const real = await original<typeof import("../host/resource-state")>();
  const { useSyncExternalStore } = await import("react");
  return { ...real, useInventory: () => useSyncExternalStore(census, () => world.inventory) };
});
vi.mock("./typed-mount", async (original) => {
  const real = await original<typeof import("./typed-mount")>();
  return {
    ...real,
    mountTypedRoute: (...[module, input, fingerprint]: Parameters<typeof real.mountTypedRoute>) => {
      const mount = real.mountTypedRoute(
        module,
        input,
        fingerprint,
        world.ports(input.work.open?.openId),
      );
      world.mounts.push(mount);
      return mount;
    },
  };
});

/** Chadds and Snowdon are two files; `again` is Chadds closed and opened again, a new lifetime. */
const documents = {
  chadds: { ref, path: address("C:/Models/Chadds.rvt"), title: "Chadds" },
  snowdon: {
    ref: { ...ref, openId: "snowdon" },
    path: address("C:/Models/Snowdon.rvt"),
    title: "Snowdon",
  },
  again: {
    ref: { ...ref, openId: "chadds-again" },
    path: address("C:/Models/Chadds.rvt"),
    title: "Chadds",
  },
} satisfies Record<string, Required<JourneyDocument>>;
export type JourneyDoc = keyof typeof documents;
const pin = (doc: JourneyDoc) => JSON.stringify({ kind: "open", ref: documents[doc].ref });

async function targetJourney(
  module: TypedRoute,
  reads: string[],
  native: (doc: JourneyDoc) => Native,
  start: { open: JourneyDoc[]; search: URLSearchParams },
) {
  const route = module.spec.key;
  const names = Object.keys(documents) as JourneyDoc[];
  // One host per file: Chadds reopened is served by the host that holds Chadds's saved Work.
  const files = names.filter((doc) => doc !== "again");
  const served = Object.fromEntries(
    await Promise.all(
      files.map(
        async (doc) => [doc, await hosted(route, reads, native(doc), documents[doc])] as const,
      ),
    ),
  ) as Record<JourneyDoc, Awaited<ReturnType<typeof hosted>>>;
  const hosts = { ...served, again: served.chadds };
  const of = (openId: string | undefined) =>
    names.find((doc) => documents[doc].ref.openId === openId);
  world.ports = (openId) => (of(openId) ? hosts[of(openId)!].ports : {});
  world.mounts.length = 0;
  peReadings.subscribe = () => () => {};
  world.atoms.set(readingAtom({ kind: "inventory" }, peReadings), "inventory");
  world.atoms.set(readingAtom({ kind: "machine" }, peReadings), "machine");
  /** The census: which documents the one Revit holds open now. */
  const open = (docs: JourneyDoc[]) => {
    const rows = docs.map((doc, index) => ({
      openId: documents[doc].ref.openId,
      title: documents[doc].title,
      address: documents[doc].path,
      isActive: index === 0,
      isFamilyDocument: false,
    }));
    world.inventory = {
      state: "ready",
      observation: {
        sessions: [{ sessionId: ref.session, connected: true, processId: 1, openDocuments: rows }],
      },
    };
    world.machine = {
      state: "ready",
      observation: machineFixture([{ session: ref.session, documents: rows }]),
    };
    world.listeners.forEach((notify) => notify());
  };
  open(start.open);
  const root = createRootRoute({
    component: () => <TypedShell module={module} fingerprint={routeRegistry[route]!.fingerprint} />,
  });
  const history = createMemoryHistory({ initialEntries: [`/${route}?${start.search}`] });
  const router = createRouter({ routeTree: root, history });
  await router.load();
  render(
    <RegistryContext.Provider value={appAtomRegistry}>
      <RouterProvider router={router} />
    </RegistryContext.Provider>,
    { wrapper: StandaloneBand },
  );
  const mount = () => world.mounts.at(-1) as TypedMount | undefined;
  let started = false;
  return {
    hosts,
    /** Whether the last `bound` had to start Work: false means saved Work was already there. */
    started: () => started,
    mount,
    search: () => new URLSearchParams(history.location.search),
    /** The shell has bound this document, its address is settled, and its Work is started. */
    async bound(doc: JourneyDoc, work = true) {
      await waitFor(
        () => {
          expect(mount()?.target()).toEqual({ kind: "document", ref: documents[doc].ref });
          expect(document.querySelector("[data-url-settled]")).toBeTruthy();
        },
        { timeout: 20000 },
      );
      const live = mount()!;
      // An entry that names an open subject is bound once its target and address are: its Work
      // was started on the first visit.
      if (!work) return live;
      // A document whose Work an earlier visit started has nothing to start.
      await waitFor(() => expect(live.startAction() ?? live.workBasis()).toBeTruthy(), {
        timeout: 20000,
      });
      started = !!live.startAction();
      await act(async () => void (await live.startAction()?.run()));
      return live;
    },
    open: (docs: JourneyDoc[]) => act(() => open(docs)),
    /** The picker's own path: the person presses the document control and takes a row. */
    async pick(doc: JourneyDoc) {
      fireEvent.click(
        screen.getByRole("button", { name: /^(Document: .*; change|Choose a document)$/ }),
      );
      // A route may draw its own <option> of the same name; the picker's rows are list rows.
      const rows = await screen.findAllByRole("option", { name: new RegExp(documents[doc].title) });
      fireEvent.click(rows.find((row) => !(row instanceof HTMLOptionElement))!);
    },
    /** An address somebody else wrote: Pea, a shared link, or a history entry. */
    go: (next: URLSearchParams) => act(() => history.push(`/${route}?${next}`)),
    back: () => act(() => history.back()),
    forward: () => act(() => history.forward()),
    async close() {
      cleanup();
      world.mounts.length = 0;
      await Promise.all(files.map((doc) => hosts[doc].close()));
    },
  };
}

type Journey = Awaited<ReturnType<typeof targetJourney>>;
export interface TargetProduct {
  module: TypedRoute;
  reads: string[];
  native(doc: JourneyDoc): Native;
  /** Make a selection on the bound document through its own controls, and prove it took. */
  use(doc: JourneyDoc, j: Journey): Promise<void>;
  /** Text only this document's reading carries, on the screen or in the mount's roster. */
  shows(doc: JourneyDoc): RegExp;
}
const both: JourneyDoc[] = ["chadds", "snowdon"];
const repin = (j: Journey, doc: JourneyDoc) => {
  const search = j.search();
  search.set("target", pin(doc));
  return j.go(search);
};
/** Every path that changes the resolved target. `from` holds a selection; `to` must start clean. */
const paths: Record<
  string,
  {
    open: JourneyDoc[];
    pinned?: false;
    /** `to` is named by its Address while no Revit holds it open: nothing binds, and nothing is kept. */
    closed?: true;
    from: JourneyDoc;
    to: JourneyDoc;
    change(j: Journey): Promise<void> | void;
  }
> = {
  "the picker": { open: both, from: "chadds", to: "snowdon", change: (j) => j.pick("snowdon") },
  // Pea or a shared link replaces the pin and leaves the other fields of the address as they were.
  "a pinned ?target": {
    open: both,
    from: "chadds",
    to: "snowdon",
    change: (j) => repin(j, "snowdon"),
  },
  "a lost binding reopened": {
    open: ["chadds"],
    from: "chadds",
    to: "again",
    async change(j) {
      await j.open([]);
      // The closed lifetime keeps its saved Work on screen, read-only, with no target to act on.
      await waitFor(() => expect(j.mount()?.target()).toBeNull());
      await j.open(["again"]);
      await j.pick("again");
    },
  },
  "a new sole document": {
    open: ["chadds"],
    pinned: false,
    from: "chadds",
    to: "snowdon",
    change: (j) => j.open(["snowdon"]),
  },
  "a closed document's Address": {
    open: ["chadds"],
    closed: true,
    from: "chadds",
    to: "snowdon",
    change(j) {
      const search = j.search();
      search.set("target", documents.snowdon.path);
      return j.go(search);
    },
  },
};

/** One mounted journey per path: the new target holds nothing of the old one, and can be used. */
export async function targetChange(product: TargetProduct, path: keyof typeof paths) {
  const { open, pinned, closed, from, to, change } = paths[path]!;
  const fields = [...Object.keys(product.module.spec.fields), "selected"];
  const j = await targetJourney(product.module, product.reads, product.native, {
    open,
    search: new URLSearchParams(pinned === false ? {} : { target: pin(from) }),
  });
  try {
    await j.bound(from);
    await product.use(from, j);
    const old = j.mount()!;
    // The old target holds a subject, so "no subject" below can fail.
    const subject = product.module.spec.subject!.field;
    expect((old.page.read() as Record<string, unknown>)[subject]).not.toEqual(
      product.module.spec.fields[subject]!.initial,
    );
    const held = fields.flatMap((field) => j.search().get(field) ?? []);
    expect(held.length).toBeGreaterThan(0);
    await change(j);
    if (closed) {
      await waitFor(() => {
        expect(j.mount()).not.toBe(old);
        expect(j.mount()!.target()).toBeNull();
        expect(fields.filter((field) => j.search().has(field))).toEqual([]);
      });
      const page: Record<string, unknown> = j.mount()!.page.read();
      for (const [name, field] of Object.entries(product.module.spec.fields))
        expect(page[name], name).toEqual(field.initial);
      expect(document.body.textContent).not.toMatch(product.shows(from));
      return;
    }
    const live = await j.bound(to);
    expect(live).not.toBe(old);
    // A saved file's Work is keyed by its Address: the reopened lifetime finds it, and starts none.
    if (documents[from].path === documents[to].path) expect(j.started()).toBe(false);
    // The settled address and the Page hold no selection and no field of the old target.
    expect(fields.filter((field) => j.search().has(field))).toEqual([]);
    const page: Record<string, unknown> = live.page.read();
    expect(page.selected).toEqual([]);
    for (const [name, field] of Object.entries(product.module.spec.fields))
      expect(page[name], name).toEqual(field.initial);
    // No reading of the old target is drawn or held. A reopened file is the same model.
    const { subject: door, core } = product.module.spec;
    const seen = () => document.body.textContent + JSON.stringify(live.value(door?.read ?? core));
    if (documents[from].path !== documents[to].path)
      expect(seen()).not.toMatch(product.shows(from));
    // The new target's own controls work.
    await product.use(to, j);
    expect(seen()).toMatch(product.shows(to));
  } finally {
    await j.close();
  }
}
export const targetPaths = Object.keys(paths);

/**
 * A history entry names its own Page. Back from Snowdon lands on Chadds with the plan and the
 * subject its entry names, the entry is not rewritten, and Forward lands on Snowdon's own.
 */
export async function backRestores(product: TargetProduct) {
  const j = await targetJourney(product.module, product.reads, product.native, {
    open: both,
    search: new URLSearchParams({ target: pin("chadds") }),
  });
  const walk = async (step: () => Promise<void> | void, until: () => boolean) => {
    for (let steps = 0; steps < 12 && !until(); steps++) await step();
    expect(until()).toBe(true);
  };
  const subject = product.module.spec.subject!.field;
  const initial = product.module.spec.fields[subject]!.initial;
  const { subject: door, core } = product.module.spec;
  // The roster may be a virtual list that draws no row here: the mount's own reading also counts.
  const seen = (mount: TypedMount) =>
    document.body.textContent + JSON.stringify(mount.value(door?.read ?? core));
  const held = (mount: TypedMount) => (mount.page.read() as Record<string, unknown>)[subject];
  try {
    await j.bound("chadds");
    await product.use("chadds", j);
    const chadds = j.search().toString();
    await j.pick("snowdon");
    await j.bound("snowdon");
    await product.use("snowdon", j);
    const snowdon = j.search().toString();
    await walk(j.back, () => j.search().get("target") === pin("chadds"));
    const back = await j.bound("chadds", false);
    expect(j.search().toString()).toBe(chadds);
    expect(held(back)).not.toEqual(initial);
    await waitFor(() => expect(seen(back)).toMatch(product.shows("chadds")), { timeout: 20000 });
    await walk(j.forward, () => j.search().toString() === snowdon);
    const forward = await j.bound("snowdon", false);
    expect(j.search().toString()).toBe(snowdon);
    expect(held(forward)).not.toEqual(initial);
    await waitFor(() => expect(seen(forward)).toMatch(product.shows("snowdon")), {
      timeout: 20000,
    });
  } finally {
    await j.close();
  }
}
