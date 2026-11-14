import { knownUserRoot, resolveHomes, resolveProjectHome, noFirmHomeText, type FirmHome, type Home, type FoundHome } from "@pe/host-contracts/product-paths";
import { note, sha256Hex } from "@pe/host-contracts/kinds";
import { hostState } from "./host-ownership.ts";

export const contentRootsRefreshMs = 30_000;
export const contentRootsResolveTimeoutMs = 5_000;
export class ContentHomeUnavailable extends Error {
  readonly code = "pod.home-unavailable";
  readonly status = 503;
  constructor() { super("User content home is unavailable. Set PE_TOOLS_PRODUCT_HOME to its known location, or retry when the Documents lookup answers."); }
}
type Attempt = { stop: AbortController; expired: boolean; work: Promise<void> };
type Roots = {
  homes: Map<string, Home[]>;
  firm: FirmHome;
  pointers: Set<string>;
  ready: Promise<void>;
  refresh: () => Promise<void>;
  pending?: Attempt;
  timer?: ReturnType<typeof setInterval>;
  users: number;
  projects: Map<string, Attempt>;
};
const owners = new Map<string, Roots>();

function unavailable(roots: Roots, places: readonly string[], reason: unknown) {
  const path = roots.firm.root ?? process.env.PE_TOOLS_SHARED_ROOT ?? places[0] ?? knownUserRoot() ?? "firm drives";
  const where = [...new Set([roots.firm.root, process.env.PE_TOOLS_SHARED_ROOT, ...places]
    .filter((place): place is string => Boolean(place)))].join(", ") || "C: through Z:";
  const message = `Firm home unavailable at ${where}: ${String(reason)}. Keeping the last good homes, or the user home, while resolution continues.`;
  note(hostState(), { class: "keep", place: "Firm home", path, sha256: sha256Hex(message), reason: message });
}

async function bounded(work: Promise<void>, timeoutMs: number, expired: () => void, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = () => {};
  try {
    await Promise.race([work, new Promise<void>(resolve => {
      cancelled = resolve;
      signal.addEventListener("abort", cancelled, { once: true });
      if (signal.aborted) return resolve();
      timer = setTimeout(() => { expired(); resolve(); }, Math.max(0, timeoutMs));
    })]);
  } finally { clearTimeout(timer); signal.removeEventListener("abort", cancelled); }
}

// One owner for Pods and Pages. Environment scoping keeps isolated fixtures independent.
function owner() {
  const key = JSON.stringify([process.env.PE_TOOLS_PRODUCT_HOME, process.env.PE_TOOLS_SHARED_ROOT, process.env.PE_TEST_HOME_ROOT]);
  const existing = owners.get(key);
  if (existing) return existing;
  const user = knownUserRoot();
  const current: Roots = {
    homes: new Map(user ? [["", [{ tier: "user", root: user }]]] : []),
    firm: { root: null, looked: [] }, pointers: new Set(), ready: Promise.resolve(),
    refresh: async () => {}, users: 0, projects: new Map(),
  };
  current.refresh = () => {
    if (current.pending && !current.pending.expired) return current.pending.work;
    current.pending?.stop.abort();
    for (const [pointer, project] of current.projects) if (project.expired) {
      project.stop.abort(); current.projects.delete(pointer);
    }
    const attempt: Attempt = { stop: new AbortController(), expired: false, work: Promise.resolve() };
    current.pending = attempt;
    let places: readonly string[] = [], firm = current.firm;
    const work = resolveHomes([...current.pointers], {
      knownFirm: current.firm.root ?? undefined,
      signal: attempt.stop.signal,
      onPending: paths => { places = paths; },
      onUser: root => {
        if (current.pending === attempt && !current.homes.has("")) current.homes.set("", [{ tier: "user", root }]);
      },
      onFirm: found => { firm = found; },
    }).then(homes => {
      if (current.pending !== attempt || attempt.stop.signal.aborted) return;
      current.homes = homes;
      current.firm = { ...firm, root: homes.get("")?.find(home => home.tier === "firm")?.root ?? null };
    }).catch(error => {
      if (current.pending === attempt && !attempt.stop.signal.aborted) unavailable(current, places, error);
    }).finally(() => { if (current.pending === attempt) current.pending = undefined; });
    attempt.work = bounded(work, contentRootsResolveTimeoutMs, () => {
      attempt.expired = true;
      unavailable(current, places, `resolution exceeded ${contentRootsResolveTimeoutMs} ms`);
    }, attempt.stop.signal);
    // Expiry releases waiters; this read can publish until the next tick retires it.
    return attempt.work;
  };
  owners.set(key, current);
  current.ready = current.refresh();
  return current;
}

export async function contentRootsReady(pointer?: string | null) {
  const started = Date.now(), roots = owner();
  await roots.ready;
  if (!pointer || roots.homes.has(pointer)) return;
  roots.pointers.add(pointer);
  let pending = roots.projects.get(pointer);
  if (!pending) {
    const snapshot = roots.homes, homes = snapshot.get("") ?? [];
    const attempt: Attempt = { stop: new AbortController(), expired: false, work: Promise.resolve() };
    roots.projects.set(pointer, attempt);
    attempt.work = resolveProjectHome(pointer, homes.find(home => home.tier === "firm")?.root ?? null, attempt.stop.signal).then(project => {
      if (roots.homes !== snapshot || attempt.stop.signal.aborted) return;
      roots.homes.set(pointer, [
        ...homes.filter(home => home.tier === "user"),
        ...(project ? [{ tier: "project" as const, root: project }] : []),
        ...homes.filter(home => home.tier === "firm"),
      ]);
    }).catch(error => {
      if (!attempt.stop.signal.aborted) unavailable(roots, [pointer], error);
    }).finally(() => { if (roots.projects.get(pointer) === attempt) roots.projects.delete(pointer); });
    pending = attempt;
  }
  const attempt = pending;
  await bounded(attempt.work, contentRootsResolveTimeoutMs - (Date.now() - started), () => {
    attempt.expired = true;
    unavailable(roots, [roots.firm.root ?? pointer], `project binding exceeded ${contentRootsResolveTimeoutMs} ms`);
  }, attempt.stop.signal);
}

/** Cache-only reads, including the startup notice's firm-home report. */
export const contentFirmHome = (): FirmHome => owner().firm;
export function contentHomesFound(): { homes: FoundHome[]; firmNotice: string | null } {
  const roots = owner();
  return {
    homes: (roots.homes.get("") ?? []).map(home => ({ ...home, found: home.tier === "project" ? "pointer" :
      home.tier === "user" ? process.env.PE_TOOLS_PRODUCT_HOME ? "override" : "documents" : process.env.PE_TOOLS_SHARED_ROOT ? "override" : "probe" })),
    firmNotice: !roots.homes.get("")?.length ? new ContentHomeUnavailable().message : roots.firm.root ? null : noFirmHomeText(roots.firm),
  };
}
export function contentHomes(pointer?: string | null): readonly Home[] {
  const roots = owner();
  if (pointer) roots.pointers.add(pointer);
  return roots.homes.get(pointer ?? "") ?? roots.homes.get("") ?? [];
}

export function acquireContentRoots() {
  const roots = owner();
  roots.users++;
  if (!roots.timer) {
    roots.timer = setInterval(() => { void roots.refresh(); }, contentRootsRefreshMs);
    roots.timer.unref();
  }
  return {
    ready: roots.ready,
    close: () => {
      if (--roots.users === 0) {
        clearInterval(roots.timer); roots.timer = undefined;
        roots.pending?.stop.abort();
        roots.pending = undefined;
        for (const project of roots.projects.values()) project.stop.abort();
        roots.projects.clear();
      }
    },
  };
}
