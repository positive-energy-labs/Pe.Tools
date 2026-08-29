import { Suspense } from "react";
import { FactChip } from "#/components/lang/chip";
import { PressContent } from "#/components/anatomy/press-content";
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
    setZoneKey,
    setCursor,
    zoneStates,
    filteredZones,
    selectZone,
    stageCounts,
  } = useAtlasWorkspace();
  return (
    <Suspense fallback={<div className="p-2">reading zones…</div>}>
      <Pane kind="navigation" title="zones" meta={`${world.zones.length} declared`}>
        <div className="px-2 py-1.5">
          <div className="mb-1">room states — one per room</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {ROOM_STATES.map((s) => (
              <span key={s} title={STATE_META[s].note} className="inline-flex items-center gap-1">
                <StateDot tone={STATE_META[s].tone} dim={s === "unreviewed"} />
                {STATE_META[s].label}
              </span>
            ))}
          </div>
        </div>

        <div className="px-2 py-2">
          <div className="mb-1">zone pipeline — global filter</div>
          <div className="flex flex-col">
            {stageCounts.map(({ stage, n }, i) => {
              const on = stageFilter === stage;
              return (
                <Press
                  key={stage}
                  type="button"
                  title={STAGE_BLURB[stage]}
                  onClick={() => {
                    setStageFilter(on ? null : stage);
                    setZoneKey(null);
                    setCursor(null);
                  }}
                  tone="quiet"
                  state={on ? "selected" : "rest"}
                >
                  <PressContent geometry="baseline">
                    <span className="w-3">{i + 1}</span>
                    <span className="flex-1">{stage}</span>
                    <span>{n}</span>
                  </PressContent>
                </Press>
              );
            })}
          </div>
          {stageFilter && (
            <Press type="button" tone="quiet" size="caption" onClick={() => setStageFilter(null)}>
              clear filter — show all {world.zones.length}
            </Press>
          )}
        </div>

        <div>
          {world.lanes.map((lane) => {
            const zs = filteredZones.filter((z) => z.zone.lane.label === lane.label);
            if (zs.length === 0) return null;
            return (
              <div key={lane.label}>
                <div className="sticky z-sticky px-2 py-0.5">
                  {lane.label} · {zs.length}
                </div>
                <ul>
                  {zs.map((z) => {
                    const states = zoneStates(z);
                    const calls = states.filter((s) => s === "call").length;
                    const on = z.zone.key === zoneKey;
                    const off = !onPlan(z);
                    return (
                      <li key={z.zone.key}>
                        <Press
                          type="button"
                          onClick={() => selectZone(on ? null : z)}
                          title={
                            off
                              ? `off-plan scribble — ${fmtNum(z.zone.declaredSqft, 0)} sf, drawn far from the level cluster; kept in the list, excluded from the plan`
                              : `${z.name} · ${z.zone.lane.label} · ${fmtNum(z.zone.declaredSqft, 0)} sf declared`
                          }
                          tone="quiet"
                          state={on ? "selected" : "rest"}
                        >
                          <PressContent geometry="row">
                            <ZoneThumb zone={z.zone} className="size-5" />
                            <span>{z.zone.key}</span>
                            <span className="min-w-0 flex-1">
                              {off ? "off-plan scribble" : z.name}
                            </span>
                            {calls > 0 && (
                              <span>
                                <FactChip
                                  tone="alarm"
                                  title={`${calls} room${calls === 1 ? "" : "s"} in this zone need a human call — an open detector flag or .r10 drift`}
                                >
                                  {calls} call{calls === 1 ? "" : "s"}
                                </FactChip>
                              </span>
                            )}
                            <ZoneStateBar zone={z} states={states} />
                          </PressContent>
                        </Press>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Pane>
    </Suspense>
  );
}
