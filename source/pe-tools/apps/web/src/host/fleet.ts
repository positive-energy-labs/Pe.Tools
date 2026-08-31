/** Fuses SDK registry custody/lifecycle with bridge-observed documents. */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Envelope,
  FleetPhase,
  SessionListResult,
  SessionObservation,
  SessionReceipt,
} from "@pe/host-contracts/pe-revit-contract";
import type { HostLane } from "@pe/host-contracts/service-identity";

import { HOST_QUERY_KEY, useBridgeSessionsListQuery } from "#/host/queries";
import { fromBridgeSessions, type Custody, type SessionFacts } from "#/host/target";

type WorldPhase = FleetPhase | "failed";

/** One world as the sentence speaks about it and /instances tables it. */
export interface WorldFacts {
  /** The pe-revit session id when the SDK knows this world, else the bridge session id. */
  id: string;
  custody: Custody;
  phase: WorldPhase;
  detail: string;
  /** Host/UI lane. The SDK payload source calls `dev` checkouts `checkout`. */
  lane?: HostLane;
  year?: string;
  pid?: number;
  activeDocumentTitle?: string;
  openDocumentCount: number;
  /** Live bridge observation, when this world holds an open WebSocket to the host. */
  session?: SessionFacts;
  /** The SDK's own registry row, when `session list` knows this world. */
  row?: SessionObservation;
}

type ObservationProjection = {
  readonly custody: Custody;
  readonly detail: string;
  readonly id: string;
  readonly lane?: HostLane;
  readonly phase: WorldPhase;
  readonly process?: { readonly pid: number; readonly processStartUtc: string };
};

function assertNever(value: never): never {
  throw new Error(`unhandled session observation: ${JSON.stringify(value)}`);
}

function receiptLane(receipt: SessionReceipt): HostLane {
  switch (receipt.payload) {
    case "checkout":
      return "dev";
    case "installed":
      return "installed";
    default:
      return assertNever(receipt);
  }
}

function projectObservation(row: SessionObservation): ObservationProjection {
  switch (row.case) {
    case "controlled-active":
      switch (row.bridge.bridge) {
        case "ready":
          return {
            custody: "controlled",
            detail: row.detail,
            id: row.id,
            lane: receiptLane(row.receipt),
            phase: "ready",
            process: row.process,
          };
        case "unresponsive-endpoint":
          return {
            custody: "controlled",
            detail: row.detail,
            id: row.id,
            lane: receiptLane(row.receipt),
            phase: "unresponsive",
            process: row.process,
          };
        default:
          return assertNever(row.bridge);
      }
    case "controlled-pending": {
      let process: ObservationProjection["process"];
      switch (row.attempt.attempt) {
        case "awaiting-launch":
          process = undefined;
          break;
        case "launched":
          switch (row.attempt.bridge.bridge) {
            case "answering":
            case "missing-endpoint":
              process = row.attempt.process;
              break;
            default:
              return assertNever(row.attempt.bridge);
          }
          break;
        default:
          return assertNever(row.attempt);
      }
      return {
        custody: "controlled",
        detail: row.detail,
        id: row.id,
        lane: receiptLane(row.receipt),
        phase: "booting",
        process,
      };
    }
    case "observed-active":
      switch (row.bridge.bridge) {
        case "answering":
          return {
            custody: "observed",
            detail: "SDK bridge answers for this observed Revit process.",
            id: String(row.process.pid),
            phase: "ready",
            process: row.process,
          };
        case "missing-endpoint":
          return {
            custody: "observed",
            detail: "SDK bridge endpoint is missing for this observed Revit process.",
            id: String(row.process.pid),
            phase: "unresponsive",
            process: row.process,
          };
        case "unresponsive-endpoint":
          return {
            custody: "observed",
            detail: "SDK bridge does not answer for this observed Revit process.",
            id: String(row.process.pid),
            phase: "unresponsive",
            process: row.process,
          };
        default:
          return assertNever(row.bridge);
      }
    case "gone-receipt":
      return {
        custody: "controlled",
        detail: row.detail,
        id: row.id,
        lane: receiptLane(row.receipt),
        phase: "gone",
      };
    case "failed-receipt":
      return {
        custody: "controlled",
        detail: row.detail,
        id: row.id,
        lane: receiptLane(row.receipt),
        phase: "failed",
      };
    default:
      return assertNever(row);
  }
}

/** Joins only one exact process incarnation; the SDK census owns every world's classification. */
export function fuseFleet(
  rows: readonly SessionObservation[],
  sessions: readonly SessionFacts[],
): WorldFacts[] {
  const claimedSessionIds = new Set<string>();
  const worlds: WorldFacts[] = rows.map((row) => {
    const projected = projectObservation(row);
    const processStartUtcUnixMs = projected.process
      ? Date.parse(projected.process.processStartUtc)
      : Number.NaN;
    const session =
      projected.process && Number.isFinite(processStartUtcUnixMs)
        ? sessions.find(
            (candidate) =>
              !claimedSessionIds.has(candidate.sessionId) &&
              candidate.processId === projected.process!.pid &&
              candidate.processStartUtcUnixMs === processStartUtcUnixMs,
          )
        : undefined;
    if (session) claimedSessionIds.add(session.sessionId);
    return {
      id: projected.id,
      custody: projected.custody,
      phase: projected.phase,
      detail: projected.detail,
      lane: projected.lane ?? session?.lane ?? undefined,
      year: String(row.year),
      pid: projected.process?.pid,
      activeDocumentTitle: session?.activeDocumentTitle,
      openDocumentCount: session?.openDocumentCount ?? 0,
      session,
      row,
    };
  });
  worlds.push(
    ...sessions
      .filter((session) => !claimedSessionIds.has(session.sessionId))
      .map((session) => ({
        id: session.sessionId,
        custody: "observed" as const,
        phase: "ready" as const,
        detail: "Host bridge is connected, but no exact SDK census row matched.",
        lane: session.lane ?? undefined,
        pid: session.processId,
        activeDocumentTitle: session.activeDocumentTitle,
        openDocumentCount: session.openDocumentCount,
        session,
      })),
  );
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
    queryFn: async (): Promise<SessionListResult> => {
      const response = await fetch(all ? "/sessions?all=true" : "/sessions");
      if (!response.ok) throw new Error(`session list ${response.status}`);
      // The route relays the CLI envelope untouched, so this is the SDK's own result shape. No
      // `?? []` fallback: an envelope without `sessions` means the contract moved underneath us,
      // and a silent empty fleet is exactly the failure this cutover exists to end.
      const body = (await response.json()) as Envelope<SessionListResult>;
      const result = body.result;
      if (!result || !Array.isArray(result.sessions))
        throw new Error("session list envelope carried no result.sessions[]");
      if (!Array.isArray(result.unreadableReceipts))
        throw new Error("session list envelope carried no result.unreadableReceipts[]");
      if (!Array.isArray(result.processReadErrors))
        throw new Error("session list envelope carried no result.processReadErrors[]");
      return result;
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
      worlds: fuseFleet(status.data?.sessions ?? [], sessions),
      sessions,
      unreadableReceipts: status.data?.unreadableReceipts ?? [],
      processReadErrors: status.data?.processReadErrors ?? [],
      registryRoot: status.data?.registryRoot,
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
