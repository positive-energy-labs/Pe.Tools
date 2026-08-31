/** Fuses SDK registry custody/lifecycle with bridge-observed documents. */
import { useQuery } from "@tanstack/react-query";
import type {
  BridgeObservation,
  ControlledActiveBridgeObservation,
  Envelope,
  FleetPhase,
  PendingBridgeObservation,
  ProcessIdentity,
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
  pid?: number;
  /** Live bridge observation, when this world holds an open WebSocket to the host. */
  session?: SessionFacts;
  /** The SDK's own registry row, when `session list` knows this world. */
  row?: SessionObservation;
}

type ObservationView = readonly [WorldPhase, string, ProcessIdentity?];

function assertNever(value: never): never {
  throw new Error(`unhandled session observation: ${JSON.stringify(value)}`);
}

const ACTIVE_PHASE = {
  ready: "ready",
  "unresponsive-endpoint": "unresponsive",
} satisfies Record<ControlledActiveBridgeObservation["bridge"], WorldPhase>;
const PENDING_PHASE = {
  answering: "booting",
  "missing-endpoint": "booting",
} satisfies Record<PendingBridgeObservation["bridge"], WorldPhase>;
const OBSERVED_VIEW = {
  answering: ["ready", "SDK bridge answers for this observed Revit process."],
  "missing-endpoint": [
    "unresponsive",
    "SDK bridge endpoint is missing for this observed Revit process.",
  ],
  "unresponsive-endpoint": [
    "unresponsive",
    "SDK bridge does not answer for this observed Revit process.",
  ],
} satisfies Record<BridgeObservation["bridge"], readonly [WorldPhase, string]>;
const RECEIPT_LANE = {
  checkout: "dev",
  installed: "installed",
} satisfies Record<SessionReceipt["payload"], HostLane>;

function projectObservation(row: SessionObservation): ObservationView {
  switch (row.case) {
    case "controlled-active":
      return [ACTIVE_PHASE[row.bridge.bridge], row.detail, row.process];
    case "controlled-pending":
      switch (row.attempt.attempt) {
        case "awaiting-launch":
          return ["booting", row.detail];
        case "launched":
          return [PENDING_PHASE[row.attempt.bridge.bridge], row.detail, row.attempt.process];
        default:
          return assertNever(row.attempt);
      }
    case "observed-active": {
      const [phase, detail] = OBSERVED_VIEW[row.bridge.bridge];
      return [phase, detail, row.process];
    }
    case "gone-receipt":
      return ["gone", row.detail, row.process];
    case "failed-receipt":
      switch (row.failure.source) {
        case "journal":
          return ["failed", row.detail, row.failure.process];
        case "receipt":
          return ["failed", row.detail];
        default:
          return assertNever(row.failure);
      }
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
    const [phase, detail, process] = projectObservation(row);
    const session = process
      ? sessions.find(
          (candidate) =>
            !claimedSessionIds.has(candidate.sessionId) &&
            candidate.processId === process.pid &&
            candidate.processStartUtcUnixMs === Date.parse(process.processStartUtc),
        )
      : undefined;
    if (session) claimedSessionIds.add(session.sessionId);
    const observed = row.case === "observed-active";
    return {
      phase,
      detail,
      id: observed ? String(row.process.pid) : row.id,
      custody: observed ? "observed" : "controlled",
      lane: observed ? (session?.lane ?? undefined) : RECEIPT_LANE[row.receipt.payload],
      pid: process?.pid,
      session,
      row,
    };
  });
  for (const session of sessions)
    if (!claimedSessionIds.has(session.sessionId))
      worlds.push({
        id: session.sessionId,
        custody: "observed",
        phase: "ready",
        detail: "Host bridge is connected, but no exact SDK census row matched.",
        lane: session.lane ?? undefined,
        pid: session.processId,
        session,
      });
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
}
