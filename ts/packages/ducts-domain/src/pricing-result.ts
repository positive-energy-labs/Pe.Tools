import { neutralFansWork } from "@pe/agent-contracts";
import type { DuctsDesign } from "@pe/agent-contracts";
import type { Catalogs } from "@pe/ducts-domain/catalog";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import { price } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { healPlan } from "@pe/ducts-domain/heal";
import { inferJoints } from "@pe/ducts-domain/proximity";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { systemNotes } from "./system-list-search.ts";
import { systemList } from "./system-list.ts";

export function pricingResult(
  snapshot: DuctSnapshot,
  grids: Grids,
  catalogs: Catalogs,
  doc: DuctsDesign | null,
) {
  const unpriceable = snapshot.groups.filter(
    (group) => group.rootIds.length && group.terminalCount === 0,
  );
  if (unpriceable.length && unpriceable.length === snapshot.groups.length) {
    const names =
      [...new Set(unpriceable.flatMap((group) => group.systemNames))].join(", ") || "This network";
    const groups = new Set(unpriceable.map((group) => group.id));
    const outlets = snapshot.segments
      .filter(
        (segment) =>
          segment.groupId &&
          groups.has(segment.groupId) &&
          segment.connectors.some((port) => !port.connectedTo && (port.flowCfm ?? 0) > 0),
      )
      .map((segment) => segment.id);
    throw Error(
      `${names} has no terminal${outlets.length ? `: its air leaves at open end ${outlets.join(", ")}` : " and no fan-to-terminal path"}; nothing to price`,
    );
  }
  const priced = price(snapshot, grids, doc, doc ?? neutralFansWork, catalogs);
  const heal = healPlan(snapshot, doc);
  return {
    priced,
    ready: readiness(snapshot, doc),
    analysis: {
      heal,
      notes: systemNotes(priced, doc, heal),
      systems: systemList(priced.snapshot, priced),
      inference: inferJoints(snapshot, 1, withStoredRulings(doc, snapshot.store, snapshot)),
    },
  };
}
