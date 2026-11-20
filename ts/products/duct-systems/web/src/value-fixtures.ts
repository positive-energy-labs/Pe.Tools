import { networkFixtures } from "@pe/ducts-web/network-fixtures";
import { ductsDesign } from "@pe/duct-systems-contract/ducts";
import { ductsDocumentSchema } from "@pe/ducts-contract/system-work";
import { fansDocumentSchema } from "@pe/fans-contract/fans";
import {
  ductsRosterData,
  ductsNetworkData,
  ductsPricingData,
} from "@pe/duct-systems-contract/ducts-read";
import { pricingValue, pricingWire } from "@pe/duct-systems-domain/pricing-value";
import { systemList } from "@pe/duct-systems-domain/system-list";
import { resolveCriteria } from "@pe/ducts-domain/calc/inputs";
import { FIRM_SEED } from "@pe/ducts-domain/input-layers";

// Every declared read projects the same registered snapshot, without native or home reads.
const providers = <D>(
  project: (snapshot: (typeof networkFixtures)[keyof typeof networkFixtures]["snapshot"]) => D,
) =>
  Object.fromEntries(
    Object.entries(networkFixtures).map(([name, fixture]) => [
      name,
      () => ({
        data: project(fixture.snapshot),
        coverage: { requested: [], covered: [], unknown: [], refused: [] },
      }),
    ]),
  );
const network = (snapshot: Parameters<typeof pricingValue>[0]) =>
  ductsNetworkData.parse({
    ...snapshot,
    sourceVersion: "fixture",
    systemReads: { completed: snapshot.systems.map((s) => s.id), missing: [] },
  });
export const rosterFixtures = providers((snapshot) =>
  ductsRosterData.parse({
    ...snapshot,
    sourceVersion: "fixture",
    rows: systemList(snapshot, null),
  }),
);
export const networkValueFixtures = providers(network);
export const pricingFixtures = providers((snapshot) => {
  const ductSystemsWork = ductsDocumentSchema.parse({}),
    fansWork = fansDocumentSchema.parse({});
  const design = ductsDesign(ductSystemsWork, fansWork);
  const firm = { refused: "no-shared-root" as const };
  return ductsPricingData.parse({
    ...pricingWire(pricingValue(snapshot, [], design)),
    network: network(snapshot),
    ductSystemsWork,
    fansWork,
    design,
    fanRows: [],
    catalogFindings: [],
    criteria: resolveCriteria(null, FIRM_SEED),
    firm,
    settings: {},
  });
});
