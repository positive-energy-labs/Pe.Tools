import { Suspense } from "react";
import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import { StateDot } from "#/components/master-table/cells";
import { Pane } from "#/components/ui/pane";
import { fmtNum } from "#/components/master-table/model";
import { cn } from "#/lib/utils";
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
    <Suspense fallback={<div className="p-2 text-ink-2">reading zones…</div>}>
      <Pane kind="navigation" title="zones" meta={`${world.zones.length} declared`}>
        <div className="shrink-0 border-b border-line px-2 py-1.5">
          <div className="t-caption t-upper mb-1 text-ink-2">room states — one per room</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {ROOM_STATES.map((s) => (
              <span
                key={s}
                title={STATE_META[s].note}
                className="face-mono t-value inline-flex items-center gap-1 text-ink-2"
              >
                <StateDot tone={STATE_META[s].tone} dim={s === "unreviewed"} />
                {STATE_META[s].label}
              </span>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-b border-line px-2 py-2">
          <div className="t-caption t-upper mb-1 text-ink-2">zone pipeline — global filter</div>
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
                  className={cn(
                    "flex items-baseline gap-1.5 rounded-sm px-1 py-0.5 text-left hover:bg-recess",
                    on && "bg-select",
                  )}
                >
                  <span className="face-mono t-value w-3 shrink-0 text-ink-2">{i + 1}</span>
                  <span className={cn("face-mono t-value flex-1 truncate", !on && "text-ink-2")}>
                    {stage}
                  </span>
                  <span className="face-mono t-value tabular-nums text-ink-2">{n}</span>
                </Press>
              );
            })}
          </div>
          {stageFilter && (
            <Press
              type="button"
              className="t-caption mt-1 text-ink-2 hover:text-ink"
              onClick={() => setStageFilter(null)}
            >
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
                <div className="t-caption t-upper sticky top-0 z-sticky border-y border-line bg-recess px-2 py-0.5 text-ink-2">
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
                          className={cn(
                            "flex w-full items-center gap-1.5 border-b border-line px-2 py-1 text-left hover:bg-recess",
                            on && "bg-select",
                            off && "opacity-55",
                          )}
                        >
                          <ZoneThumb zone={z.zone} className="size-5" />
                          <span className="face-mono t-value shrink-0">{z.zone.key}</span>
                          <span className="min-w-0 flex-1 truncate t-value text-ink-2">
                            {off ? "off-plan scribble" : z.name}
                          </span>
                          {calls > 0 && (
                            <span className="shrink-0">
                              <FactChip
                                tone="alarm"
                                title={`${calls} room${calls === 1 ? "" : "s"} in this zone need a human call — an open detector flag or .r10 drift`}
                              >
                                {calls} call{calls === 1 ? "" : "s"}
                              </FactChip>
                            </span>
                          )}
                          <ZoneStateBar zone={z} states={states} />
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
