/**
 * Fleet — one fusion of every Revit world the client can observe: the SDK's own
 * `pe-revit session status` rows (the authority on what sessions exist, who holds custody of
 * them, and which companion legs are up) plus the bridge's connected sessions (the only source of
 * live document observation). Pure functions so POCs and tests exercise the full state space
 * without a host; `useFleet` binds them to the live queries.
 *
 * The row shape is the SDK's `SessionRow`, imported from the generated contract — not restated.
 * `custody`, `origin`, `lane`, `phase`, `state`, `legs[]` and `documents[]` are read straight off
 * it. The old hand-rolled `kind: "user" | "sandbox"` split is gone: custody says it, the SDK
 * computes it, and the SDK resolver is what enforces it.
 *
 * The sentence grammar's world clause derives from here — the same facts /instances renders,
 * spoken instead of tabled.
 */
import { useQuery } from "@tanstack/react-query";
import type {
  Envelope,
  SessionRow,
  SessionStatusResult,
} from "@pe/host-contracts/pe-revit-contract";

import { HOST_QUERY_KEY, useBridgeSessionsListQuery } from "#/host/queries";
import {
  fromBridgeSessions,
  resolveTarget,
  type Custody,
  type SessionFacts,
  type TargetSelector,
} from "#/host/target";

export type { SessionRow };

/**
 * The fleet phase, the SDK's own `SessionRow.phase` (SessionResolver.PhaseOf): `ready` |
 * `booting` | `unresponsive` | `gone`. Branch on this, not on the finer `state` — `state` is the
 * word to SHOW (materialized, failed, dead, pid-reused, stopped, running, ready, booting).
 */
export type WorldPhase = "ready" | "booting" | "unresponsive" | "gone";

const PHASES: readonly WorldPhase[] = ["ready", "booting", "unresponsive", "gone"];

/** One world as the sentence speaks about it and /instances tables it. */
export interface WorldFacts {
  /** The pe-revit session id when the SDK knows this world, else the bridge session id. */
  id: string;
  custody: Custody;
  phase: WorldPhase;
  /** Free-text provenance recorded at start (cli, mcp, pea, web, test). Disclosed, never a gate. */
  origin?: string;
  /** Payload SOURCE: dev | installed. Null when unknown. */
  lane?: string;
  year?: string;
  pid?: number;
  activeDocumentTitle?: string;
  openDocumentCount: number;
  /** Live bridge observation, when this world holds an open WebSocket to the host. */
  session?: SessionFacts;
  /** The SDK's own status row, when `session status` knows this world. */
  row?: SessionRow;
}

function phaseOf(row: SessionRow): WorldPhase {
  return PHASES.find((p) => p === row.phase) ?? "gone";
}

/**
 * `session status` rows are the fleet; bridge sessions add live document observation to the rows
 * they belong to, and stand alone when the SDK has no row for them (an `observed` Revit the user
 * started themselves, which pe-revit holds no receipt for and this page must never try to drive).
 *
 * The join key is the pe-revit session id the payload reported at registration, with pid as the
 * fallback for a payload that reported none.
 */
export function fuseFleet(
  rows: readonly SessionRow[],
  sessions: readonly SessionFacts[],
): WorldFacts[] {
  const claimed = new Set<string>();
  const worlds: WorldFacts[] = rows.map((row) => {
    const session = sessions.find(
      (s) =>
        (s.sdkSessionId && s.sdkSessionId === row.id) ||
        (row.pid != null && s.processId === row.pid),
    );
    if (session) claimed.add(session.sessionId);
    return {
      id: row.id,
      custody: row.custody,
      phase: phaseOf(row),
      origin: row.origin ?? undefined,
      lane: row.lane ?? undefined,
      year: row.year ?? undefined,
      pid: row.pid ?? undefined,
      // The bridge sees the CURRENT active document; the row's is as of its own observation. Prefer
      // the live one when a connection exists.
      activeDocumentTitle: session?.activeDocumentTitle ?? row.activeDocument?.title ?? undefined,
      openDocumentCount: session?.openDocumentCount ?? row.documents?.length ?? 0,
      session,
      row,
    };
  });
  for (const session of sessions) {
    if (claimed.has(session.sessionId)) continue;
    worlds.push({
      id: session.sdkSessionId ?? session.sessionId,
      custody: session.custody,
      phase: "ready", // an open bridge connection is the strongest readiness claim there is
      lane: session.lane ?? undefined,
      pid: session.processId,
      activeDocumentTitle: session.activeDocumentTitle,
      openDocumentCount: session.openDocumentCount,
      session,
    });
  }
  return worlds;
}

/**
 * The world clause: what the sentence appends after a target. Speaks derivation truth ("still
 * booting", "gone"), never offers a choice — choosing is the plugin sentence's job via its own
 * slots. Total over every resolution state.
 */
export function worldClause(worlds: readonly WorldFacts[], selector: TargetSelector): string {
  const sessions = worlds.flatMap((world) => (world.session ? [world.session] : []));
  const resolution = resolveTarget(sessions, selector);
  if (resolution.kind === "resolved") {
    const world = worlds.find((w) => w.session?.sessionId === resolution.session.sessionId);
    const name = world?.custody === "observed" ? "your Revit" : `a live world (${world?.id})`;
    return ` in ${name}`;
  }
  // A pinned pe-revit session that no bridge answers for: the SDK still knows what became of it,
  // so say what it says instead of guessing "gone".
  if (selector.startsWith("session:")) {
    const world = worlds.find((w) => w.id === selector.slice("session:".length));
    if (world?.phase === "booting") return " in a world that is still booting";
    if (world?.phase === "unresponsive") return " — its world is unresponsive";
    return " — its world is gone";
  }
  if (resolution.kind === "ambiguous") return " in … several worlds — pick one";
  if (resolution.reason === "no-sessions") return " — no world is running";
  return " — its world is gone"; // dangling pid/session pin: the process died
}

/** The one human name for a world: the pe-revit session id, or "your Revit" when observed. */
export function worldName(world: Pick<WorldFacts, "id" | "custody">): string {
  return world.custody === "observed" ? "your Revit" : world.id;
}

export function useSessionStatusQuery(enabled = true) {
  // Under HOST_QUERY_KEY so root SSE invalidation refetches it; the interval covers the boot
  // window where no bridge events exist yet.
  // ponytail: 5s poll, always on while mounted; a start-scoped poll if it ever matters.
  return useQuery({
    queryKey: [...HOST_QUERY_KEY, "", "sessions.status", ""],
    enabled,
    queryFn: async (): Promise<SessionRow[]> => {
      const response = await fetch("/sessions");
      if (!response.ok) throw new Error(`session status ${response.status}`);
      // The route relays the CLI envelope untouched, so this is the SDK's own result shape. No
      // `?? []` fallback: an envelope without `sessions` means the contract moved underneath us,
      // and a silent empty fleet is exactly the failure this cutover exists to end.
      const body = (await response.json()) as Envelope<SessionStatusResult>;
      const sessions = body.result?.sessions;
      if (!Array.isArray(sessions))
        throw new Error("session status envelope carried no result.sessions[]");
      return [...sessions];
    },
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
  });
}

export function useFleet(enabled = true): {
  worlds: WorldFacts[];
  sessions: SessionFacts[];
  isLoading: boolean;
  error: Error | null;
} {
  const sessionsQuery = useBridgeSessionsListQuery({ enabled });
  const status = useSessionStatusQuery(enabled);
  const sessions = fromBridgeSessions(sessionsQuery.data?.sessions ?? []);
  return {
    worlds: fuseFleet(status.data ?? [], sessions),
    sessions,
    isLoading: sessionsQuery.isLoading || status.isLoading,
    error: status.error,
  };
}
