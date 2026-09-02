import { useEffect, useRef, useState } from "react";
import { EmptyState } from "#/components/lang/empty";
import { StateCell } from "#/components/lang/cell";
import { Tag } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import type { useFleet } from "#/host/fleet";
import { useWorldLog } from "#/host/use-target";
import { timeAgo } from "#/lib/utils";
import { RouteHead } from "#/targeting/head";
import { Press } from "#/components/lang/press";
import { Provenance } from "#/components/lang/section";
import { InstancesCluster } from "#/instances/cluster";

export type InstancesFleet = ReturnType<typeof useFleet>;

/**
 * /instances — the route shell around the portable `InstancesCluster` (promoted from proto
 * variant F, 2026-09-01). The route owns only its name line and the world-event ledger rail;
 * everything a user acts on lives in the cluster, which other Revit-touching routes can mount
 * verbatim. No targeting sentence: this page is where sessions come FROM, not a targeted surface.
 */
export function InstancesWorkspace({
  target,
  setTarget,
  fleet,
  source,
}: {
  target: string;
  setTarget: (target: string) => void;
  fleet: InstancesFleet;
  source?: "fixture";
}) {
  const worldLog = useWorldLog(fleet.sessions);
  const [localLog, setLocalLog] = useState<{ atMs: number; actor: "you"; label: string }[]>([]);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const ledger = [
    ...worldLog.map((event) => ({
      atMs: event.atMs,
      actor: "bridge" as const,
      label: event.label,
    })),
    ...localLog,
  ].sort((left, right) => left.atMs - right.atMs);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [ledger.length, ledgerOpen]);

  return (
    <div className="min-h-screen" data-testid="instances-workspace">
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <RouteHead name="Instances" aside={source === "fixture" ? <Tag>fixture</Tag> : undefined} />
      </div>
      {/* No min-height: the tables are content-sized; a forced 75vh made MasterTable's flex-1
       * scroll body stretch and left dead space under the documents table (annotation 2). */}
      <div className="mx-auto flex max-w-6xl gap-0 px-6 py-5">
        <div className="flex min-w-0 flex-1 flex-col pr-5">
          <InstancesCluster
            fleet={fleet}
            target={target}
            setTarget={setTarget}
            source={source}
            onEvent={(event) =>
              setLocalLog((log) => [
                ...log.slice(-99),
                { atMs: event.atMs, actor: "you", label: event.label },
              ])
            }
          />
          {fleet.error ? <StateCell value={`fleet unreadable: ${fleet.error.message}`} /> : null}
        </div>
        {ledgerOpen ? (
          <div className="flex w-72 flex-col pl-5">
            <div className="flex items-baseline justify-between pb-2">
              <span className="flex items-center gap-1.5">
                <Tag>ledger</Tag>
                <HelpTip>Settled SDK envelopes merged with bridge-observed world events.</HelpTip>
              </span>
              <Press
                type="button"
                onClick={() => setLedgerOpen(false)}
                tone="neutral"
                size="caption"
              >
                ›
              </Press>
            </div>
            <div ref={logRef} className="max-h-[72vh] min-h-0 flex-1 overflow-y-auto">
              {ledger.length === 0 ? (
                <EmptyState story="scope" exit="run a lifecycle verb or wait for a world event">
                  nothing observed yet
                </EmptyState>
              ) : null}
              {ledger.map((entry, index) => (
                <div key={index} className="py-1.5">
                  <Tag>{entry.actor}</Tag>
                  <StateCell value={entry.label} />
                  <Provenance>{timeAgo(entry.atMs)}</Provenance>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="ml-2 flex w-6 flex-col items-center gap-2 self-stretch py-2">
            <Press type="button" onClick={() => setLedgerOpen(true)} tone="neutral">
              <span className="[writing-mode:vertical-rl]">
                <Tag>ledger · {ledger.length}</Tag>
              </span>
            </Press>
          </div>
        )}
      </div>
    </div>
  );
}
