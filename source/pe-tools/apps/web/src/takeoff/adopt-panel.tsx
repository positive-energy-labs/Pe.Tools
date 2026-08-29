import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { Cause } from "effect";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { fmtNum } from "#/components/master-table/model";
import { type CandidateRegion } from "#/takeoff/model";
import { type TakeoffStore } from "#/takeoff/store";

export interface AdoptRow {
  region: CandidateRegion;
  view: string;
  checked: boolean;
  name: string;
  systemTag: string;
}

export function AdoptPanel({ store }: { store: TakeoffStore }) {
  const views = useAtomValue(store.atoms.views);
  const zones = useAtomValue(store.atoms.world).zones;
  const listed = useAtomValue(store.atoms.adoptRows);
  const candidates = useAtomValue(store.atoms.candidates);
  const busy = useAtomValue(store.atoms.busy)?.id ?? null;

  const patchRow = (view: string, elementId: number, patch: Partial<AdoptRow>) =>
    store.actions.patchAdopt(view, elementId, patch);

  const picked = listed?.filter((r) => r.checked) ?? [];

  const adopt = () => {
    if (picked.length === 0) return;
    void store.actions.adoptSelected().catch(() => undefined);
  };

  return (
    <Panel
      title={`adopt zoning regions — ${views.length} view${views.length === 1 ? "" : "s"}`}
      onClose={() => store.actions.openPanel(null)}
    >
      <p>
        tick the designer-drawn regions that are zones. adoption stamps them in place (role, guid,
        name, system tag) — re-adopt to edit. legends are ignored.
      </p>
      <div className="mt-2 max-h-96 overflow-y-auto">
        {(listed ?? []).map((r) => (
          <div
            key={`${r.view}:${r.region.elementId}`}
            className="flex items-center gap-2 px-2 py-1"
          >
            <input
              type="checkbox"
              checked={r.checked}
              onChange={(e) => patchRow(r.view, r.region.elementId, { checked: e.target.checked })}
            />
            <span className="w-28" title={r.view}>
              {r.view}
            </span>
            <span className="size-2.5" style={{ backgroundColor: `rgb(${r.region.color})` }} />
            <span className="w-24" title={r.region.typeName}>
              {r.region.typeName}
            </span>
            <span className="w-16">{fmtNum(r.region.sqft, 0)} sf</span>
            <input
              value={r.name}
              placeholder="zone name"
              onChange={(e) => patchRow(r.view, r.region.elementId, { name: e.target.value })}
              className="h-6 min-w-0 flex-1 px-1.5"
            />
            <input
              value={r.systemTag}
              placeholder="system tag"
              onChange={(e) => patchRow(r.view, r.region.elementId, { systemTag: e.target.value })}
              className="h-6 w-24 px-1.5"
            />
            {r.region.role === "zoning-region" && (
              <FactChip
                tone="done"
                title="This region is already stamped as a Zoning Region. Re-adopting edits its name and system tag in place."
              >
                stamped
              </FactChip>
            )}
          </div>
        ))}
        {listed === null && (
          <div className="px-2 py-3">
            {AsyncResult.isFailure(candidates) ? (
              <OutcomeLine
                kind="error"
                label="reading regions failed"
                says={String(Cause.squash(candidates.cause))}
              />
            ) : (
              <OutcomeLine kind="busy" label="reading regions" says={views.join(", ")} />
            )}
          </div>
        )}
        {listed !== null && listed.length === 0 && (
          <div className="px-2 py-3">
            <EmptyState story="scope" exit="draw the zones in Revit first, or bind other views">
              no filled regions — these views carry no designer-drawn regions to adopt
            </EmptyState>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Verb
          tone="commit"
          label={`stamp ${picked.length} as zoning regions`}
          disabled={busy !== null || picked.length === 0}
          reason={
            busy !== null
              ? `${busy} is in flight`
              : picked.length === 0
                ? "tick at least one region — adoption stamps exactly what is ticked, never 'whatever is selected'"
                : `Writes role, guid, name and system tag onto ${picked.length} filled region${picked.length === 1 ? "" : "s"} across ${new Set(picked.map((row) => row.view)).size} views. Idempotent: re-adopting edits in place.`
          }
          onClick={adopt}
        />
        <FactChip title="Zoning Regions already stamped anywhere in this document.">
          {zones.length} already adopted
        </FactChip>
      </div>
    </Panel>
  );
}

export function SyncPanel({ store }: { store: TakeoffStore }) {
  const { zones: zoneGuids, r10: r10Path } = useAtomValue(store.atoms.selection);
  const { inScope, blockedZones, inserts, untagged, tags } = useAtomValue(store.atoms.syncPlan);
  const busy = useAtomValue(store.atoms.busy)?.id ?? null;
  const sync = () => void store.actions.syncRhvac().catch(() => undefined);

  return (
    <Panel title={`sync to ${r10Path}`} onClose={() => store.actions.openPanel(null)}>
      <p>
        inserts reviewed rooms (with Manual J data) into the bound .r10 — always work on a COPY of
        the project template, never the original. systems are seeded by number + name only;
        everything else is filled in RHVAC.
      </p>

      <p className="mt-2">systems to seed ({tags.length})</p>
      {tags.map((tag) => (
        <p key={tag} className="py-0.5">
          {tag}
        </p>
      ))}

      <p className="mt-2">
        rooms to insert ({inserts.length}
        {zoneGuids.length > 0
          ? ` · ${inScope.length} bound zone${inScope.length === 1 ? "" : "s"}`
          : ""}
        )
      </p>
      <div className="max-h-48 overflow-y-auto">
        {inserts.map(({ zone, room }, i) => (
          <p key={room.guid} className="flex gap-2 py-px">
            <span className="w-8">{i + 1}</span>
            <span className="min-w-0 flex-1">{room.name}</span>
            <span>
              {zone.zone.key} · {zone.tags[0] ?? "NO TAG"} · {fmtNum(room.sqft, 0)} sf
            </span>
          </p>
        ))}
        {inserts.length === 0 && (
          <div className="py-2">
            <EmptyState
              story="filter"
              exit="a room becomes eligible once it has a Room Region home, Manual J data entered, and no existing .r10 link"
            >
              nothing eligible to insert
            </EmptyState>
          </div>
        )}
      </div>

      {untagged > 0 && (
        <OutcomeLine
          kind="advisory"
          label={`${untagged} room(s) in untagged zones`}
          says="re-adopt those zones with a system tag first — a room cannot land in a .r10 system that has no name"
        />
      )}
      {blockedZones.length > 0 && (
        <OutcomeLine
          kind="advisory"
          label={`${blockedZones.length} zone(s) excluded`}
          says="resolve room flags, orphaned regions, materialization failures, or post-sync area drift first"
        />
      )}

      <div className="mt-2 flex items-center gap-2">
        <Verb
          tone="commit"
          label={`sync ${inserts.length} rooms`}
          disabled={busy !== null || inserts.length === 0 || untagged > 0}
          reason={
            busy !== null
              ? `${busy} is in flight`
              : inserts.length === 0
                ? "no room is eligible — a room needs a Room Region home, Manual J data, and no existing .r10 link"
                : untagged > 0
                  ? `${untagged} eligible room(s) sit in zones with no system tag — tag those zones first`
                  : `Inserts ${inserts.length} rooms into ${r10Path} and writes the {file, room} link back onto each Room Region. Work on a COPY of the template.`
          }
          onClick={sync}
        />
      </div>
    </Panel>
  );
}

export function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100vh-4rem)] w-[44rem] overflow-y-auto sm:max-w-[44rem]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
