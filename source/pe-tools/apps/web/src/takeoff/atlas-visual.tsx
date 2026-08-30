import { Suspense } from "react";
import { Press } from "#/components/lang/press";
import { Pane } from "#/components/lang/pane";
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
    <Suspense fallback={<div className="p-2">reading plan…</div>}>
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
                  size="value"
                  tone={lane.label === level ? "neutral" : "quiet"}
                  state={lane.label === level ? "selected" : "rest"}
                  title={`${lane.view}${lane.replayPath ? " · captured this session" : " · not captured yet"}`}
                >
                  <span className="face-mono">
                    {lane.label}
                    <span className="ml-1">{zs.length}</span>
                    {calls > 0 && <span className="ml-1">·{calls}</span>}
                  </span>
                </Press>
              );
            })}

            <Press
              type="button"
              onClick={() => setStatsOpen(!statsOpen)}
              size="value"
              tone="neutral"
              state={statsOpen ? "selected" : "rest"}
              title="level-wide totals — the whole-building dashboard was noise; the level is the unit you actually work in"
            >
              <span className="face-mono">level stats</span>
            </Press>
            <Press
              type="button"
              onClick={() => setPlanOpen(!planOpen)}
              title={
                planOpen ? "collapse the plan — give the table the full height" : "show the plan"
              }
              tone="neutral"
              size="value"
            >
              <span className="face-mono">{planOpen ? "▴ hide plan" : "▾ show plan"}</span>
            </Press>

            <span className="face-mono t-caption ml-auto text-ink-2">
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
