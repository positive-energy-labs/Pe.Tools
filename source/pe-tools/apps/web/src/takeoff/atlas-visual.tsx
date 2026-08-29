import { Suspense } from "react";
import { Press } from "#/components/lang/press";
import { Pane } from "#/components/ui/pane";
import { cn } from "#/lib/utils";
import { LevelPlan } from "#/takeoff/level-plan";
import { LevelStats } from "#/takeoff/level-stats";
import { ZoneCard } from "#/takeoff/zone-card";
import { useAtlasWorkspace } from "#/takeoff/atlas-context";

export function AtlasVisual() {
  const {
    store,
    world,
    live,
    busy,
    geoReady,
    actions,
    stageFilter,
    zoneKey,
    cursor,
    planOpen,
    statsOpen,
    level,
    setLevel,
    setZoneKey,
    setCursor,
    setPlanOpen,
    setStatsOpen,
    stateOf,
    zoneCalls,
    selected,
    levelZones,
    cursorRow,
    selectZone,
  } = useAtlasWorkspace();
  return (
    <Suspense fallback={<div className="p-2 text-ink-2">reading plan…</div>}>
      <Pane
        kind="visual"
        toolbar={
          <>
            {world.lanes.map((lane) => {
              const zs = world.zones.filter((z) => z.zone.lane.label === lane.label);
              const calls = zs.reduce((n, z) => n + zoneCalls(z), 0);
              return (
                <Press
                  key={lane.label}
                  type="button"
                  onClick={() => setLevel(lane.label)}
                  title={`${lane.view}${lane.replayPath ? " · captured this session" : " · not captured yet"}`}
                  className={cn(
                    "face-mono t-value rounded-sm border px-2 py-0.5",
                    lane.label === level
                      ? "border-line-2 bg-select"
                      : "border-transparent text-ink-2 hover:bg-recess",
                  )}
                >
                  {lane.label}
                  <span className="ml-1 opacity-60">{zs.length}</span>
                  {calls > 0 && <span className="ml-1 text-alarm">·{calls}</span>}
                </Press>
              );
            })}

            <Press
              type="button"
              onClick={() => setStatsOpen(!statsOpen)}
              title="level-wide totals — the whole-building dashboard was noise; the level is the unit you actually work in"
              className={cn(
                "face-mono t-value ml-2 rounded-sm border border-line-2 px-1.5 py-0.5",
                statsOpen ? "bg-select" : "text-ink-2 hover:bg-recess",
              )}
            >
              level stats
            </Press>
            <Press
              type="button"
              onClick={() => setPlanOpen(!planOpen)}
              title={
                planOpen ? "collapse the plan — give the table the full height" : "show the plan"
              }
              className="face-mono t-value rounded-sm border border-line-2 px-1.5 py-0.5 text-ink-2 hover:bg-recess"
            >
              {planOpen ? "▴ hide plan" : "▾ show plan"}
            </Press>

            <span className="face-mono t-value ml-auto text-ink-2">
              {selected ? `scoped to ${selected.zone.key}` : "whole house in scope"} — Esc clears
            </span>
          </>
        }
      >
        <LevelPlan
          zones={levelZones}
          stageFilter={stageFilter}
          selectedKey={zoneKey}
          cursor={cursor}
          stateOf={stateOf}
          onSelectZone={selectZone}
          onHover={(id) => store.actions.hover(id)}
          onCursor={(z, guid) => {
            setZoneKey(z.zone.key);
            setLevel(z.zone.lane.label);
            setCursor(guid);
          }}
          onClear={() => {
            setZoneKey(null);
            setCursor(null);
          }}
        />
        {statsOpen && (
          <LevelStats
            level={level}
            zones={levelZones}
            stateOf={stateOf}
            onClose={() => setStatsOpen(false)}
          />
        )}

        {selected && (
          <ZoneCard
            store={store}
            zone={selected}
            cursorRoom={cursorRow?.room ?? null}
            geoReady={geoReady}
            live={live}
            busy={busy}
            actions={actions}
            stateOf={stateOf}
            systems={world.systems}
            onClose={() => selectZone(null)}
          />
        )}
      </Pane>
    </Suspense>
  );
}
