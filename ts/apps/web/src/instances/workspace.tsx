import { useEffect, useRef, useState } from "react";
import { EmptyState } from "#/components/lang/empty";
import { StateCell } from "#/components/lang/cell";
import { Tag } from "#/components/lang/chip";
import type { useFleet } from "#/readings";
import { useSessionLog } from "#/host/world-log";
import { timeAgo } from "#/lib/utils";
import { RouteShell } from "#/route";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { Provenance } from "#/components/lang/section";
import { Surface } from "#/components/lang/surface";
import { InstancesCluster } from "#/instances/cluster";
import { instancesManifest, type InstancesHandle } from "#/instances/manifest";

export type InstancesFleet = ReturnType<typeof useFleet>;

/**
 * /instances — the route shell around the portable `InstancesCluster` (promoted from proto
 * variant F, 2026-09-01). The route owns only its name line and the world-event ledger rail;
 * everything a user acts on lives in the cluster, which other Revit-touching routes can mount
 * verbatim. No targeting sentence: this page is where sessions come FROM, not a targeted surface.
 */
export function InstancesWorkspace({
  handle,
  target,
  setTarget,
  fleet,
  shell = true,
}: {
  handle: InstancesHandle;
  target: string;
  setTarget: (target: string) => void;
  fleet: InstancesFleet;
  shell?: boolean;
}) {
  const worldLog = useSessionLog(fleet.sessions);
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

  const content = (
    <PaneSplit
      axis="horizontal"
      grow
      resize={{
        target: "end",
        defaultSize: 288,
        minSize: 240,
        minOtherSize: 320,
        collapse: {
          collapsed: !ledgerOpen,
          onCollapsedChange: (collapsed) => setLedgerOpen(!collapsed),
          collapsedSize: 40,
          collapseBelow: 120,
        },
      }}
      start={
        <InstancesCluster
          handle={handle}
          fleet={fleet}
          target={target}
          setTarget={setTarget}
          onEvent={(event) =>
            setLocalLog((log) => [
              ...log.slice(-99),
              { atMs: event.atMs, actor: "you", label: event.label },
            ])
          }
        />
      }
      end={
        <Pane
          kind="flank"
          side="right"
          title="ledger"
          meta={ledger.length}
          help="Settled SDK envelopes merged with bridge-observed world events."
          collapsed={!ledgerOpen}
          onCollapsedChange={(collapsed) => setLedgerOpen(!collapsed)}
        >
          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto">
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
        </Pane>
      }
    />
  );

  return shell ? (
    <Surface head={<RouteShell manifest={instancesManifest} />}>{content}</Surface>
  ) : (
    content
  );
}
