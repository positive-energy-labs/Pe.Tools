/** Fuses SDK registry custody/lifecycle with bridge-observed documents. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Envelope, FleetPhase } from "@pe/host-contracts/pe-revit-contract";

import { HOST_QUERY_KEY, useBridgeSessionsListQuery } from "#/host/queries";
import { fromBridgeSessions, type Custody, type SessionFacts } from "#/host/target";

/**
 * One `session list` row as SessionCommand.Summary() emits it. beta.131's generated contract
 * carries no row type (the CLI builds rows as anonymous objects, which the generator cannot see),
 * so this mirrors the wire by hand. Owed: delete when the SDK regenerates SessionRow.
 */
export interface SessionRow {
  readonly id: string;
  readonly phase: FleetPhase;
  readonly detail: string | null;
  readonly origin: string | null;
  readonly year: string | null;
  readonly project: string | null;
  readonly worktree: string | null;
  /** Payload SOURCE in the CLI's words: "checkout" (the UI's "dev") | "installed". */
  readonly payload: string | null;
  readonly buildStamp: string | null;
  readonly pid: number | null;
  readonly processStartUtc: string | null;
  readonly observedAtUtc: string;
}

interface SessionListResult {
  readonly state: string;
  readonly registryRoot: string;
  readonly sessions: readonly SessionRow[];
}

/** Branch on phase; SHOW row.phase. */
type WorldPhase = "ready" | "booting" | "unresponsive" | "gone";

const PHASES: readonly WorldPhase[] = ["ready", "booting", "unresponsive", "gone"];

/** One world as the sentence speaks about it and /instances tables it. */
export interface WorldFacts {
  /** The pe-revit session id when the SDK knows this world, else the bridge session id. */
  id: string;
  custody: Custody;
  phase: WorldPhase;
  /** Payload SOURCE: dev | installed. Null when unknown. */
  lane?: string;
  year?: string;
  pid?: number;
  activeDocumentTitle?: string;
  openDocumentCount: number;
  /** Live bridge observation, when this world holds an open WebSocket to the host. */
  session?: SessionFacts;
  /** The SDK's own registry row, when `session list` knows this world. */
  row?: SessionRow;
}

function phaseOf(row: SessionRow): WorldPhase {
  return PHASES.find((p) => p === row.phase) ?? "gone";
}

/** Joins by SDK session id, then pid; unmatched bridges are observed worlds. */
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
      // Every registry row IS a pe-revit receipt; the user's own Revit never appears here.
      custody: "controlled",
      phase: phaseOf(row),
      lane: row.payload === "checkout" ? "dev" : (row.payload ?? undefined),
      year: row.year ?? undefined,
      pid: row.pid ?? undefined,
      // beta.131 rows carry no document snapshot; only a live bridge connection sees documents.
      activeDocumentTitle: session?.activeDocumentTitle,
      openDocumentCount: session?.openDocumentCount ?? 0,
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

interface FleetOptions {
  readonly all?: boolean;
  readonly enabled?: boolean;
}

function useSessionStatusQuery({ all = false, enabled = true }: FleetOptions) {
  // Under HOST_QUERY_KEY so root SSE invalidation refetches it; the interval covers the boot
  // window where no bridge events exist yet.
  // ponytail: 5s poll, always on while mounted; a start-scoped poll if it ever matters.
  return useQuery({
    queryKey: [...HOST_QUERY_KEY, "", "sessions.status", all ? "all" : ""],
    enabled,
    queryFn: async (): Promise<SessionRow[]> => {
      const response = await fetch(all ? "/sessions?all=true" : "/sessions");
      if (!response.ok) throw new Error(`session list ${response.status}`);
      // The route relays the CLI envelope untouched, so this is the SDK's own result shape. No
      // `?? []` fallback: an envelope without `sessions` means the contract moved underneath us,
      // and a silent empty fleet is exactly the failure this cutover exists to end.
      const body = (await response.json()) as Envelope<SessionListResult>;
      const sessions = body.result?.sessions;
      if (!Array.isArray(sessions))
        throw new Error("session list envelope carried no result.sessions[]");
      return [...sessions];
    },
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
  });
}

export function useFleet(options: FleetOptions = {}) {
  const { all = false, enabled = true } = options;
  const sessionsQuery = useBridgeSessionsListQuery({ enabled });
  const status = useSessionStatusQuery({ all, enabled });
  return useMemo(() => {
    const sessions = fromBridgeSessions(sessionsQuery.data?.sessions ?? []);
    return {
      worlds: fuseFleet(status.data ?? [], sessions),
      sessions,
      isLoading: sessionsQuery.isLoading || status.isLoading,
      stale: sessionsQuery.isFetching || status.isFetching,
      error: sessionsQuery.error ?? status.error,
      at: Math.max(sessionsQuery.dataUpdatedAt, status.dataUpdatedAt) || undefined,
      basis: ["sessions.list", "bridge.sessions.list"],
    };
  }, [
    sessionsQuery.data?.sessions,
    sessionsQuery.dataUpdatedAt,
    sessionsQuery.error,
    sessionsQuery.isFetching,
    sessionsQuery.isLoading,
    status.data,
    status.dataUpdatedAt,
    status.error,
    status.isFetching,
    status.isLoading,
  ]);
}
