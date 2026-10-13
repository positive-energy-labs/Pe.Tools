/**
 * /open, the front surface (host ledger 2026-10-09 ruling 3): the patch bay side by side, a
 * projection of the host's one `Machine` reading plus the SDK recents and the thread list. The
 * machine layer (update, share, Pea, host) is the drawer behind the version chip, not here.
 */
import { useEffect, useMemo, useRef } from "react";
import type { Machine } from "@pe/agent-contracts";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";

import { Surface } from "#/components/lang/surface";
import { frozenDemo } from "#/host/demo-client";
import { useSessionEvents } from "#/host/world-log";
import { machineOf } from "#/machine/model";
import { PatchBay, useThreadSummaries } from "#/open/bay";
import { openManifest, type OpenHandle } from "#/open/manifest";
import { modelRows } from "#/open/model";
import { BAY_THREADS } from "#/open/seeds";
import { inventoryOf, previousOf, useHostCall, useInventory } from "#/readings";
import { RouteShell } from "#/route";
import { useSurfaceHost } from "#/navigation/surface-host";
import { useRoute } from "#/route/use-route";
import { readScopedActionStatuses } from "../../../../packages/mcps/src/shared/takeoff-action-client";

export function OpenPage() {
  const compact = useSurfaceHost().surface === "tray";
  const handle = useRoute(openManifest);
  const fixture = useMemo(() => frozenDemo() !== null, []);
  const machine = machineOf(handle.readings.machine as Parameters<typeof machineOf>[0]);
  const recents =
    (previousOf(handle.readings.recents) as { result?: { recents?: RecentDocument[] } } | undefined)
      ?.result?.recents ?? [];
  const sessions = machine?.revit.sessions ?? null;
  const rows = useMemo(() => modelRows(sessions ?? [], recents), [sessions, recents]);
  const threads = useThreadSummaries(!fixture, fixture ? BAY_THREADS : null);
  useWorldLog(handle, fixture);
  const loading =
    handle.readings.machine.state === "loading" || handle.readings.machine.state === "absent";
  return (
    <Surface head={<RouteShell manifest={openManifest} handle={handle} />}>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" data-testid="open-route">
        <p className="m-0 text-ink-2">
          {compact
            ? "Choose a document and a Revit below."
            : "Documents on the left, Revits on the right."}{" "}
          Pick a document, patch it into a Revit, and press the one verb that names what happens.
        </p>
        <PatchBay
          machine={machine as Machine | null}
          loading={loading}
          rows={rows}
          threads={threads}
          fixture={fixture}
          layout={compact ? "stack" : "row"}
          onNote={(label, detail, caution, receipt) =>
            handle.note(
              label,
              detail,
              caution,
              receipt ? { kind: "receipt", id: receipt.id } : undefined,
            )
          }
        />
      </div>
    </Surface>
  );
}

/** Unresolved lifecycle receipts and bridge-observed world events land in the route's one log. */
function useWorldLog(handle: OpenHandle, fixture: boolean) {
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
    (signal) => readScopedActionStatuses({ kind: "instances" }, "", signal),
    ["actions", "subject", "instances"],
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
