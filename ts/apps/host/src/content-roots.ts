import { resolveHomes, resolveProjectHome, type Home } from "@pe/host-contracts/product-paths";

export const contentRootsRefreshMs = 30_000;
type Roots = {
  homes: Map<string, Home[]>;
  pointers: Set<string>;
  ready: Promise<void>;
  refresh: () => Promise<void>;
  timer?: ReturnType<typeof setInterval>;
  users: number;
  projects: Map<string, Promise<void>>;
};
// One owner for Pods and Pages. Environment scoping also keeps isolated fixtures independent.
const owners = new Map<string, Roots>();
function owner() {
  const key = JSON.stringify([process.env.PE_TOOLS_PRODUCT_HOME, process.env.PE_TOOLS_SHARED_ROOT, process.env.PE_TEST_HOME_ROOT]);
  let roots = owners.get(key);
  if (roots) return roots;
  const current: Roots = { homes: new Map(), pointers: new Set(), ready: Promise.resolve(), refresh: async () => {}, users: 0, projects: new Map() };
  let pending: Promise<void> | undefined;
  current.refresh = () => pending ??= resolveHomes([...current.pointers]).then(homes => {
    current.homes = homes;
  }).finally(() => { pending = undefined; });
  owners.set(key, current);
  current.ready = current.refresh();
  return current;
}

export async function contentRootsReady(pointer?: string | null) {
  const roots = owner();
  await roots.ready;
  if (!pointer || roots.homes.has(pointer)) return;
  roots.pointers.add(pointer);
  let pending = roots.projects.get(pointer);
  if (!pending) {
    const homes = roots.homes.get("") ?? [];
    pending = resolveProjectHome(pointer, homes.find(home => home.tier === "firm")?.root ?? null).then(project => {
      roots.homes.set(pointer, [
        ...homes.filter(home => home.tier === "user"),
        ...(project ? [{ tier: "project" as const, root: project }] : []),
        ...homes.filter(home => home.tier === "firm"),
      ]);
    }).finally(() => roots.projects.delete(pointer));
    roots.projects.set(pointer, pending);
  }
  await pending;
}

/** Cache-only read. A new document pointer joins the next background resolution. */
export function contentHomes(pointer?: string | null): readonly Home[] {
  const roots = owner();
  if (pointer) roots.pointers.add(pointer);
  return roots.homes.get(pointer ?? "") ?? roots.homes.get("") ?? [];
}

/** Composition owns the timer; requests read snapshots without filesystem probes. */
export function acquireContentRoots() {
  const roots = owner();
  roots.users++;
  if (!roots.timer) {
    roots.timer = setInterval(() => { void roots.refresh().catch(() => {}); }, contentRootsRefreshMs);
    roots.timer.unref();
  }
  return {
    ready: roots.ready,
    close: () => {
      if (--roots.users === 0) { clearInterval(roots.timer); roots.timer = undefined; }
    },
  };
}
