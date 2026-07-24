/**
 * Fleet — one fusion of every Revit world the client can observe: bridge-connected
 * sessions (strongest truth) + the sandbox registry (covers the boot window before a
 * bridge connection exists). Pure functions so POCs and tests exercise the full state
 * space without a host; `useFleet` binds them to the live queries.
 *
 * The sentence grammar's world clause derives from here — the same facts /instances
 * renders, spoken instead of tabled.
 *
 * ponytail: instances.tsx still builds its own display rows from the same two queries;
 * fold it onto fuseFleet when that route is next touched.
 */
import { useQuery } from "@tanstack/react-query";

import { HOST_QUERY_KEY, useBridgeSessionsListQuery } from "#/host/queries";
import { fromBridgeSessions, resolveTarget, type SessionFacts, type TargetSelector } from "#/host/target";

/** One entry of `pe-revit sandbox status --json` (relayed verbatim by the host). */
export interface SandboxRegistryEntry {
  id: string;
  state: "materialized" | "booting" | "ready" | "unresponsive" | "stopped" | "dead" | "pid-reused";
  detail?: string | null;
  pid?: number | null;
  year?: string | null;
  startedAtUtc?: string | null;
  stoppedAtUtc?: string | null;
}

export type WorldPhase = "live" | "booting" | "unresponsive" | "dead";

/** One world as the sentence speaks about it. */
export interface WorldFacts {
  /** sandbox id, or "user" for the user's Revit. */
  id: string;
  kind: "user" | "sandbox";
  phase: WorldPhase;
  year?: string;
  pid?: number;
  activeDocumentTitle?: string;
  openDocumentCount: number;
  session?: SessionFacts;
}

const BOOTING_STATES = new Set(["materialized", "booting", "ready"]);

/** Bridge sessions win; registry entries not bridge-connected fill the boot/death tail. */
export function fuseFleet(
  sessions: readonly SessionFacts[],
  registry: readonly SandboxRegistryEntry[],
): WorldFacts[] {
  const worlds: WorldFacts[] = sessions.map((session) => ({
    id: session.lane === "sandbox" ? (session.sandboxId ?? session.sessionId) : "user",
    kind: session.lane === "sandbox" ? "sandbox" : "user",
    phase: "live",
    pid: session.processId,
    activeDocumentTitle: session.activeDocumentTitle,
    openDocumentCount: session.openDocumentCount,
    session,
  }));
  const connected = new Set(worlds.map((world) => world.id));
  for (const entry of registry) {
    if (connected.has(entry.id)) continue;
    worlds.push({
      id: entry.id,
      kind: "sandbox",
      phase: BOOTING_STATES.has(entry.state)
        ? "booting"
        : entry.state === "unresponsive" || entry.state === "pid-reused"
          ? "unresponsive"
          : "dead",
      year: entry.year ?? undefined,
      pid: entry.pid ?? undefined,
      openDocumentCount: 0,
    });
  }
  return worlds;
}

/**
 * The world clause: what the sentence appends after a target. Speaks derivation
 * truth ("still booting", "gone"), never offers a choice — choosing is the plugin
 * sentence's job via its own slots.
 */
export function worldClause(worlds: readonly WorldFacts[], selector: TargetSelector): string {
  const resolution = resolveTarget(
    worlds.flatMap((world) => (world.session ? [world.session] : [])),
    selector,
  );
  if (resolution.kind === "resolved") {
    const world = worlds.find((w) => w.session?.sessionId === resolution.session.sessionId);
    const name = world?.kind === "user" ? "your Revit" : `a live world (${world?.id})`;
    return ` in ${name}`;
  }
  if (selector.startsWith("sandbox:")) {
    const world = worlds.find((w) => w.id === selector.slice("sandbox:".length));
    if (world?.phase === "booting") return " in a world that is still booting";
    if (world?.phase === "unresponsive") return " — its world is unresponsive";
    if (world?.phase === "dead" || !world) return " — its world is gone";
  }
  if (resolution.kind === "unresolved" && resolution.reason === "no-sessions")
    return " — no world is running";
  if (resolution.kind === "ambiguous") return "";
  return "";
}

export function useSandboxRegistryQuery() {
  // Under HOST_QUERY_KEY so root SSE invalidation refetches it; the interval covers
  // the boot window where no bridge events exist yet.
  return useQuery({
    queryKey: [...HOST_QUERY_KEY, "", "sessions.sandboxes", ""],
    queryFn: async (): Promise<SandboxRegistryEntry[]> => {
      const response = await fetch("/sessions/sandboxes");
      if (!response.ok) throw new Error(`sandbox status ${response.status}`);
      const body = (await response.json()) as { result?: { sandboxes?: SandboxRegistryEntry[] } };
      return body.result?.sandboxes ?? [];
    },
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
  });
}

export function useFleet(): { worlds: WorldFacts[]; sessions: SessionFacts[]; isLoading: boolean } {
  const sessionsQuery = useBridgeSessionsListQuery();
  const registry = useSandboxRegistryQuery();
  const sessions = fromBridgeSessions(sessionsQuery.data?.sessions ?? []);
  return {
    worlds: fuseFleet(sessions, registry.data ?? []),
    sessions,
    isLoading: sessionsQuery.isLoading,
  };
}
