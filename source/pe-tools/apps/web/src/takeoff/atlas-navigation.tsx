import { Suspense } from "react";
import { FactChip } from "#/components/lang/chip";
import { List } from "#/components/lang/list-popup";
import { Press } from "#/components/lang/press";
import { StateDot } from "#/components/master-table/cells";
import { Pane } from "#/components/lang/pane";
import { fmtNum } from "#/components/master-table/model";
import { ROOM_STATES, STATE_META, STAGE_BLURB } from "#/takeoff/room-state";
import { onPlan } from "#/takeoff/room-actions";
import { ZoneStateBar } from "#/takeoff/zone-state-bar";
import { ZoneThumb } from "#/takeoff/zone-plan";
import { useAtlasWorkspace } from "#/takeoff/atlas-context";

export function AtlasNavigation() {
  const {
    world,
    stageFilter,
    zoneKey,
    setStageFilter,
    zoneStates,
    filteredZones,
    selectZone,
    stageCounts,
    scopeShortcuts,
  } = useAtlasWorkspace();
  return (
    <Suspense fallback={<div className="t-small t-upper p-2 text-ink-2">reading zones…</div>}>
      <Pane
        id="zones"
        kind="navigation"
        flush
        title="zones"
        meta={`${world.zones.length} declared`}
        shortcuts={scopeShortcuts}
      >
        <div className="hairline-b px-2 py-1.5">
          <div className="t-small t-upper mb-1">room states — one per room</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {ROOM_STATES.map((s) => (
              <span
                key={s}
                title={STATE_META[s].note}
                className="t-small face-mono inline-flex items-center gap-1 text-ink-2"
              >
                <StateDot tone={STATE_META[s].tone} dim={s === "unreviewed"} />
                {STATE_META[s].label}
              </span>
            ))}
          </div>
        </div>

        <div className="hairline-b px-2 py-1.5">
          <div className="t-small t-upper mb-1">zone pipeline — global filter</div>
          <List
            aria-label="zone pipeline"
            region="zones"
            items={stageCounts}
            keyOf={({ stage }) => stage}
            labelOf={({ stage }) => stage}
            empty="no stages"
            // One stage filters the plan; picking it again shows all.
            onPick={({ stage }) => setStageFilter(stageFilter === stage ? null : stage)}
            row={({ stage, n }) => ({
              lead: (
                <span className="face-mono w-3">
                  {stageCounts.findIndex((c) => c.stage === stage) + 1}
                </span>
              ),
              label: <span className="face-mono">{stage}</span>,
              meta: n,
              active: stageFilter === stage,
              title: STAGE_BLURB[stage],
            })}
          />
          {stageFilter && (
            <Press type="button" tone="quiet" size="caption" onClick={() => setStageFilter(null)}>
              clear filter — show all {world.zones.length}
            </Press>
          )}
        </div>

        <List
          aria-label="zones"
          region="zones"
          // Lanes in the world's order; each lane is a sticky group head with its count.
          items={world.lanes.flatMap((lane) =>
            filteredZones.filter((z) => z.zone.lane.label === lane.label),
          )}
          keyOf={(z) => z.zone.guid}
          labelOf={(z) => `${z.zone.key} ${z.name}`}
          groupOf={(z) => z.zone.lane.label}
          empty="no zones match the stage filter"
          onPick={(z) => selectZone(z.zone.guid === zoneKey ? null : z)}
          row={(z) => {
            const states = zoneStates(z);
            const calls = states.filter((s) => s === "call").length;
            const off = !onPlan(z);
            return {
              lead: <ZoneThumb zone={z.zone} />,
              label: (
                <span className="truncate">
                  <span className="face-mono">{z.zone.key}</span>{" "}
                  {off ? "off-plan scribble" : z.name}
                </span>
              ),
              meta: (
                <span className="flex items-center gap-1">
                  {calls > 0 && (
                    <FactChip
                      tone="alarm"
                      title={`${calls} room${calls === 1 ? "" : "s"} in this zone need a human call — an open detector flag or .r10 drift`}
                    >
                      {calls} call{calls === 1 ? "" : "s"}
                    </FactChip>
                  )}
                  <ZoneStateBar zone={z} states={states} className="w-16 shrink-0" />
                </span>
              ),
              active: z.zone.guid === zoneKey,
              title: off
                ? `off-plan scribble — ${fmtNum(z.zone.declaredSqft, 0)} sf, drawn far from the level cluster; kept in the list, excluded from the plan`
                : `${z.name} · ${z.zone.lane.label} · ${fmtNum(z.zone.declaredSqft, 0)} sf declared`,
            };
          }}
        />
      </Pane>
    </Suspense>
  );
}
