import { Suspense } from "react";
import { emptyListState, useList } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { Pane } from "@pe/kit/lang/pane";
import { fmtNum } from "@pe/kit/table/model";
import { onPlan } from "#/takeoff/room-actions";
import { ZoneStateBar } from "#/takeoff/zone-state-bar";
import { ZoneThumb } from "#/takeoff/zone-plan";
import { useAtlasWorkspace } from "#/takeoff/atlas-context";
import { ScopeKeys } from "@pe/kit/keys";
import { levelsOf } from "#/takeoff/plan-image";
import type { ModelZone } from "#/takeoff/world";

/**
 * The zones rail: the kit list every route navigates with (SURFACE-PHILOSOPHY N3), so "/" searches
 * it, the arrows walk it and each level is a sticky, collapsible head. The room-state key lives
 * once, beside the plan it describes; the rail no longer repeats it.
 */
export function AtlasNavigation() {
  const { world, zoneKey, zoneStates, filteredZones, selectZone, scopeShortcuts } =
    useAtlasWorkspace();
  const levels = levelsOf(world.lanes);
  const list = useList<ModelZone>({
    followSelection: { key: zoneKey },
    // Levels in the world's order, each once: many view lanes share a level.
    items: levels.flatMap((label) => filteredZones.filter((z) => z.zone.lane.label === label)),
    keyOf: (z) => z.zone.guid,
    search: (z) => ({
      text: [z.zone.key, z.name, z.zone.lane.label, z.stage, ...z.tags],
      ids: z.zone.elementId == null ? [] : [z.zone.elementId],
    }),
    groups: { of: (z) => z.zone.lane.label, order: levels, collapsible: levels },
    state: { ...emptyListState(), selected: zoneKey ? [zoneKey] : [] },
    select: "single",
    onPick: (z) => selectZone(z.zone.guid === zoneKey ? null : z),
  });
  return (
    <Suspense fallback={<div className="t-small t-upper p-2 text-ink-2">reading zones…</div>}>
      <Pane id="zones" flush scroll="clip" title="zones" meta={`${world.zones.length} declared`}>
        <ScopeKeys keys={scopeShortcuts} />
        <div className="min-h-0 flex-1 overflow-auto">
          <ListView
            list={list}
            aria-label="zones"
            empty={{
              message: "No zones declared",
              exit: "Adopt zones from a zoning-plan view in the Adopt stage",
            }}
            row={(z) => {
              const states = zoneStates(z);
              const calls = states.filter((s) => s === "call").length;
              const off = !onPlan(z);
              return {
                lead: <ZoneThumb zone={z.zone} className="size-5" />,
                label: (
                  <span className="truncate">
                    <span className="face-mono">{z.zone.key}</span>{" "}
                    {off ? "off-plan scribble" : z.name}
                  </span>
                ),
                // Open calls block the zone's sync (I2): the kit burn on the row, not a chip.
                damage: calls > 0 ? `${calls} call${calls === 1 ? "" : "s"}` : null,
                meta: <ZoneStateBar zone={z} states={states} className="w-12 shrink-0" />,
                title: off
                  ? `off-plan scribble · ${fmtNum(z.zone.declaredSqft, 0)} sf, drawn far from the level; listed, not drawn`
                  : `${z.name} · ${z.zone.lane.label} · ${fmtNum(z.zone.declaredSqft, 0)} sf declared`,
              };
            }}
          />
        </div>
      </Pane>
    </Suspense>
  );
}
