import type { DuctsDesign } from "@pe/duct-systems-contract/ducts";
import type { DuctsFirm } from "@pe/ducts-contract/duct-inputs";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import type { Catalogs } from "@pe/ducts-domain/catalog";
import { workLayer } from "@pe/ducts-domain/input-layers";
import { rosterInputs } from "@pe/ducts-domain/roster-inputs";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { resolveInputs } from "@pe/ducts-domain/calc/inputs";
import { encounterRulings } from "@pe/ducts-domain/calc/inputs";
import { buildCalc } from "./build.ts";
export function networkCalcs(snapshot: DuctSnapshot, grids: Grids, catalogs: Catalogs, design: DuctsDesign, firm: DuctsFirm, revision: number) {
  const work = workLayer(design);
  const inputs = resolveInputs({
    snapshot,
    work,
    versions: { Work: revision },
    firm,
    catalogs,
  });
  const suggested = suggestRoster(snapshot, [], rosterInputs(inputs));
  const ports = [...suggested.fans, ...suggested.suggestions];
  // One calc per roster port, each on this read's network and inputs, the way the fans read builds
  // one. ponytail: every port is priced on every read; price only the opened systems' ports if a
  // document-wide read measures slow.
  const calcs = ports.map((fan) =>
    buildCalc({
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
