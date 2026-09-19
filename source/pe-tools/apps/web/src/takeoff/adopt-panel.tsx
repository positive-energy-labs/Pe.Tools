import { Fragment } from "react";
import { showAdopt, TakeoffProposalRows } from "#/takeoff/proposals";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { ActionButton } from "#/components/lang/action-button";
import { Input } from "#/components/lang/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/lang/dialog";
import { fmtNum } from "#/components/master-table/model";
import { type CandidateRegion } from "#/takeoff/model";
import { type TakeoffsController } from "#/takeoff/controller";

export interface AdoptRow {
  region: CandidateRegion;
  view: string;
  checked: boolean;
  name: string;
  systemTag: string;
}

export function AdoptRegions({ store }: { store: TakeoffsController }) {
  const views = store.views;
  const zones = store.world.zones;
  const listed = store.adoptRows;
  const failure = store.failure;
  const busy = store.busy?.key ?? null;
  const refusal = store.handle.actions.adopt.refusal;

  const patchRow = (view: string, elementId: number, patch: Partial<AdoptRow>) =>
    store.actions.patchAdopt(view, elementId, patch);

  const picked = listed?.filter((r) => r.checked) ?? [];

  const adopt = () => void store.handle.actions.adopt.run();

  return (
    <section aria-label="Adopt zoning regions" className="p-2 whitespace-normal">
      <p>
        tick the designer-drawn regions that are zones. adoption stamps them in place (role, guid,
        name, system tag) — re-adopt to edit. legends are ignored.
      </p>
      {busy === "adopt" && (
        <OutcomeLine
          kind="busy"
          label="adopting zones"
          says="Preparing the model and stamping the selected regions."
        />
      )}
      {store.busy === null && failure !== null && (
        <OutcomeLine kind="error" label="adoption failed" says={failure.message} />
      )}
      <div className="mt-2 max-h-96 overflow-y-auto">
        {(listed ?? []).map((r) => (
          <Fragment key={`${r.view}:${r.region.elementId}`}>
            <div className="flex items-center gap-2 px-2 py-1">
              <Input
                type="checkbox"
                aria-label={`Select ${r.name} in ${r.view}`}
                checked={r.checked}
                onChange={(e) =>
                  patchRow(r.view, r.region.elementId, { checked: e.target.checked })
                }
              />
              <span className="w-28" title={r.view}>
                {r.view}
              </span>
              <span className="size-2.5" style={{ backgroundColor: `rgb(${r.region.color})` }} />
              <span className="w-24" title={r.region.typeName}>
                {r.region.typeName}
              </span>
              <span className="w-16">{fmtNum(r.region.sqft, 0)} sf</span>
              <div className="min-w-0 flex-1">
                <Input
                  aria-label={`Zone name for region ${r.region.elementId} in ${r.view}`}
                  value={r.name}
                  placeholder="zone name"
                  onChange={(e) => patchRow(r.view, r.region.elementId, { name: e.target.value })}
                />
              </div>
              <div className="w-24">
                <Input
                  aria-label={`System tag for region ${r.region.elementId} in ${r.view}`}
                  value={r.systemTag}
                  placeholder="system tag"
                  onChange={(e) =>
                    patchRow(r.view, r.region.elementId, { systemTag: e.target.value })
                  }
                />
              </div>
              {r.region.role === "zoning-region" && (
                <FactChip
                  tone="done"
                  title="This region is already stamped as a Zoning Region. Re-adopting edits its name and system tag in place."
                >
                  stamped
                </FactChip>
              )}
            </div>
            {/* Pea's proposed choice for this candidate, in the band grammar. */}
            <div className="px-2">
              <TakeoffProposalRows
                cells={store.cells.adopt}
                wire={store.wires.adopt}
                keep={(key) => key === `${r.view}:${r.region.elementId}`}
                label={() => r.name || r.region.typeName}
                show={showAdopt}
              />
            </div>
          </Fragment>
        ))}
        {listed === null && (
          <div className="px-2 py-3">
            <OutcomeLine kind="busy" label="reading regions" says={views.join(", ")} />
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
        <ActionButton
          tone="commit"
          label={`stamp ${picked.length} as zoning regions`}
          disabled={busy !== null || refusal !== null}
          reason={
            refusal ??
            (busy !== null
              ? `${busy} is in flight`
              : `Writes role, guid, name and system tag onto ${picked.length} filled region${picked.length === 1 ? "" : "s"} across ${new Set(picked.map((row) => row.view)).size} views. Idempotent: re-adopting edits in place.`)
          }
          onClick={adopt}
        />
        <FactChip title="Zoning Regions already stamped anywhere in this document.">
          {zones.length} already adopted
        </FactChip>
      </div>
    </section>
  );
}

export function SyncPanel({ store }: { store: TakeoffsController }) {
  const { zones: zoneGuids, r10: r10Path } = store.selection;
  const { inScope, blockedZones, inserts, untagged, tags, linkedUpdates } = store.syncPlan;
  const busy = store.busy?.key ?? null;
  const sync = () => void store.handle.actions["commit-sync"].run();
  const refusal = store.handle.actions["commit-sync"].refusal;

  return (
    <Panel title={`sync to ${r10Path}`} onClose={() => store.actions.openPanel(null)}>
      {store.syncReview ? (
        <FactChip title="This review is valid only while its document, capture, Work revision, file version and zone scope remain exact.">
          review · capture {store.syncReview.captureId.slice(0, 8)} · Work r
          {store.syncReview.work.revision} · file {store.syncReview.fileVersion}
        </FactChip>
      ) : null}
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
          label={`${blockedZones.length} zone(s) block this sync`}
          says="resolve room flags, orphaned regions, materialization failures, or post-sync area drift first"
        />
      )}

      <div className="mt-2 flex items-center gap-2">
        <ActionButton
          tone="commit"
          label={`sync ${inserts.length + linkedUpdates} rooms`}
          disabled={busy !== null || refusal !== null}
          reason={
            refusal ??
            (busy !== null
              ? `${busy} is in flight`
              : `Inserts ${inserts.length} rooms into ${r10Path} and writes the {file, room} link back onto each Room Region. Work on a COPY of the template.`)
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
