import type { DuctsDesign, DuctsFirm } from "@pe/agent-contracts";
import type { DuctSnapshot } from "../types.ts";
import type { Grids } from "../loss-grid.ts";
import type { Catalogs } from "../catalog.ts";
import { workLayer } from "../input-layers.ts";
import { rosterInputs } from "../roster-inputs.ts";
import { suggestRoster } from "../roster.ts";
import { resolveInputs } from "./inputs.ts";
import { encounterRulings } from "./inputs.ts";
import { buildSheet } from "./build.ts";
export function networkCalcs(snapshot: DuctSnapshot, grids: Grids, catalogs: Catalogs, design: DuctsDesign, firm: DuctsFirm, revision: number) {
  const work = workLayer(design);
  const inputs = resolveInputs({
    snapshot,
    work,
    versions: { Work: revision },
    store: snapshot.store,
    firm,
    catalogs,
  });
  const suggested = suggestRoster(snapshot, [], rosterInputs(inputs));
  const ports = [...suggested.fans, ...suggested.suggestions];
  // One calc per roster port, each on this read's network and inputs, the way the fans read builds
  // one. ponytail: every port is priced on every read; price only the opened systems' ports if a
  // document-wide read measures slow.
  const calcs = ports.map((fan) =>
    buildSheet({
      snapshot,
      grids,
      inputs,
      roster: ports,
      fan: { unitId: fan.unitId, portIndex: fan.portIndex },
      encounterRulings: encounterRulings({ work }),
    }),
  );
  return calcs;
}
