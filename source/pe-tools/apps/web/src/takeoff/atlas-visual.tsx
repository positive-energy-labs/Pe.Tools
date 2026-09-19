import { Suspense } from "react";
import { Press } from "#/components/lang/press";
import { Switcher } from "#/components/lang/switcher";
import { Pane } from "#/components/lang/pane";
import { LevelPlan } from "#/takeoff/level-plan";
import { LevelStats } from "#/takeoff/level-stats";
import { ZoneCard } from "#/takeoff/zone-card";
import { useAtlasWorkspace } from "#/takeoff/atlas-context";
import { levelsOf } from "#/takeoff/plan-image";

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
    planImage,
    setLevel,
    setPlanOpen,
    setStatsOpen,
    stateOf,
    zoneCalls,
    selected,
    levelZones,
    cursorRow,
    selectZone,
    focusRoom,
    clearScope,
    scopeShortcuts,
  } = useAtlasWorkspace();
  return (
    <Suspense fallback={<div className="t-small t-upper p-2 text-ink-2">reading plan…</div>}>
      <Pane
        id="plan"
        kind="visual"
        flush
        title="plan"
        headerSurface="recess"
        shortcuts={scopeShortcuts}
        toolbar={
          <>
            {/* The lanes are a segmented choose-one in the toolbar, not a list. */}
            <Switcher
              ariaLabel="level"
              value={level}
              onChange={setLevel}
              options={levelsOf(world.lanes).map((label) => {
                const lanes = world.lanes.filter((lane) => lane.label === label);
                const captured = lanes.filter((lane) => lane.replayPath).length;
                const zs = world.zones.filter((z) => z.zone.lane.label === label);
                const calls = zs.reduce((n, z) => n + zoneCalls(z), 0);
                return {
                  value: label,
                  label: (
                    <>
                      {label}
                      <span className="ml-1">{zs.length}</span>
                      {calls > 0 && (
                        <span className="ml-1" data-tone="alarm">
                          ·{calls}
                        </span>
                      )}
                    </>
                  ),
                  title: `${lanes.length} view${lanes.length === 1 ? "" : "s"} on this level · ${captured} captured this session`,
                };
              })}
            />

            <span className="hairline-l ml-1 flex items-center gap-1 pl-1">
              <Press
                type="button"
                onClick={() => setStatsOpen(!statsOpen)}
                size="caption"
                frame="line"
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
                size="caption"
                frame="line"
              >
                <span className="face-mono">{planOpen ? "▴ hide plan" : "▾ show plan"}</span>
              </Press>
            </span>

            <span className="t-small face-mono ml-auto min-w-0 truncate">
              {selected ? `${selected.zone.key} in scope` : "whole house in scope"} · Esc clears
            </span>
          </>
        }
      >
        <LevelPlan
          plan={planImage.image && "plan" in planImage.image ? planImage.image.plan : null}
          planRefusal={
            planImage.image && "refusal" in planImage.image ? planImage.image.refusal : null
          }
          planError={planImage.error}
          zones={levelZones}
          stageFilter={stageFilter}
          selectedKey={zoneKey}
          cursor={cursor}
          stateOf={stateOf}
          onSelectZone={selectZone}
          onHover={(id) => store.actions.hover(id)}
          onCursor={focusRoom}
          onClear={clearScope}
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
