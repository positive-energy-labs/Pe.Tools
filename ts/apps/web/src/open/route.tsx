/**
 * /open, the front surface (host ledger 2026-10-09 ruling 3): the launcher, the documents table,
 * and the Running list, all projections of the host's one `Machine` reading plus the SDK recents.
 * The machine layer (update, share, Pea, host) is the drawer behind the version chip, not here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Machine } from "@pe/agent-contracts";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";

import { Surface } from "#/components/lang/surface";
import { Section } from "#/components/lang/section";
import { OutcomeLine } from "#/components/lang/outcome";
import { WorkStanding } from "#/components/lang/band";
import { frozenDemo } from "#/host/demo-client";
import { useSessionEvents } from "#/host/world-log";
import { machineOf } from "#/machine/model";
import { keyOf } from "#/machine/session";
import { ModelTable } from "#/open/documents";
import { Launcher } from "#/open/launcher";
import { openManifest, type OpenHandle } from "#/open/manifest";
import { EMPTY_DRAFT, modelRows, type LaunchDraft } from "#/open/model";
import { RunningList } from "#/open/running";
import { inventoryOf, previousOf, useHostCall, useInventory } from "#/readings";
import { RouteShell } from "#/route";
import { useRoute } from "#/route/use-route";
import { readScopedActionStatuses } from "../../../../packages/mcps/src/shared/takeoff-action-client";

export function OpenPage() {
  const handle = useRoute(openManifest, { work: "instances" });
  const fixture = useMemo(() => frozenDemo() !== null, []);
  const machine = machineOf(handle.readings.machine as Parameters<typeof machineOf>[0]);
  const recents =
    (previousOf(handle.readings.recents) as { result?: { recents?: RecentDocument[] } } | undefined)
      ?.result?.recents ?? [];
  const sessions = machine?.revit.sessions ?? null;
  const rows = useMemo(() => modelRows(sessions ?? [], recents), [sessions, recents]);
  const [draft, setDraft] = useState<LaunchDraft>(EMPTY_DRAFT);
  useWorldLog(handle, fixture);
  const work = handle.work;
  const basis = work.revision === null ? null : { key: work.key, revision: work.revision };
  const refusal = fixture ? "Fixture: nothing on this page reaches a host." : null;
  const loading =
    handle.readings.machine.state === "loading" || handle.readings.machine.state === "absent";
  return (
    <Surface head={<RouteShell manifest={openManifest} handle={handle} />}>
      {work.refusal ? (
        <WorkStanding
          unresolved={[work.refusal]}
          startFresh={work.startFresh ? () => void work.startFresh?.() : undefined}
        />
      ) : !work.current ? (
        <OutcomeLine
          kind={handle.failure ? "error" : "busy"}
          label={handle.failure?.message ?? "reading the instances Work"}
        />
      ) : (
        <div className="flex min-h-0 flex-col gap-4 overflow-auto pb-16" data-testid="open-route">
          <p className="text-ink-2">Start a Revit, open a model, and see which Revit holds it.</p>
          <Launcher
            handle={handle}
            machine={machine as Machine | null}
            rows={rows}
            draft={draft}
            setDraft={setDraft}
            fixture={fixture}
          />
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
            <Section label="documents">
              <ModelTable
                rows={rows}
                picked={draft.doc}
                loading={loading}
                onPick={(row) =>
                  setDraft({
                    ...draft,
                    doc: draft.doc === row.key ? null : row.key,
                    year: null,
                    target: null,
                  })
                }
              />
            </Section>
            <Section
              label="running"
              aside={
                sessions ? (
                  <span className="text-ink-2">
                    {sessions.length} Revit{sessions.length === 1 ? "" : "s"} on this machine
                  </span>
                ) : null
              }
            >
              <RunningList
                sessions={sessions}
                loading={loading}
                basis={basis}
                refusal={refusal}
                onHere={(session) =>
                  setDraft({ ...draft, year: session.row.year, target: keyOf(session) })
                }
              />
            </Section>
          </div>
        </div>
      )}
    </Surface>
  );
}

/** Unresolved lifecycle receipts and bridge-observed world events land in the route's one log. */
function useWorldLog(handle: OpenHandle, fixture: boolean) {
  const workspaceId = handle.work.key.work!;
  const inventory = useInventory(!fixture);
  const sessions = useMemo(() => inventoryOf(previousOf(inventory)?.sessions ?? []), [inventory]);
  useSessionEvents(
    sessions,
    (event) =>
      handle.note(event.label, "bridge-observed world event", event.kind === "gap", undefined, {
        at: event.atMs,
      }),
    !fixture,
  );
  const unresolved = useHostCall(
    (signal) => readScopedActionStatuses({ kind: "instances", workspaceId }, "", signal),
    ["actions", "subject", "instances", workspaceId],
    !fixture,
  );
  const noted = useRef(new Set<string>());
  useEffect(() => {
    for (const row of unresolved.data ?? [])
      if (!noted.current.has(row.id)) {
        noted.current.add(row.id);
        handle.note(`unresolved ${row.key}`, `action ${row.id} is ${row.state}`, true, {
          kind: "receipt",
          id: row.id,
        });
      }
  }, [unresolved.data, handle]);
}
