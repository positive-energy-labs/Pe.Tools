import { resolveMany, type Many } from "../../../../packages/agent-contracts/src/route-field";

export interface TakeoffRoster {
  views: { id: string; label: string }[];
  zones: { id: string; label: string }[];
  zonesComplete?: boolean;
}
export function selectedTakeoffPage<P extends { views: Many; zones: Many }>(
  page: P,
  roster?: TakeoffRoster,
) {
  if ((page.views === "all" || page.zones === "all") && !roster)
    throw Error("Read the current subject roster before expanding all");
  // TODO: docs/features/routes/LEDGER.md#s7-8e539bcbeb add native metadata zone enumeration before admitting all zones on a live document.
  if (page.zones === "all" && roster?.zonesComplete === false)
    throw Error("The native metadata zone roster is unavailable; choose explicit zones");
  return {
    ...page,
    views: resolveMany(page.views, roster?.views.map((row) => row.id) ?? []),
    zones: resolveMany(page.zones, roster?.zones.map((row) => row.id) ?? []),
  };
}
