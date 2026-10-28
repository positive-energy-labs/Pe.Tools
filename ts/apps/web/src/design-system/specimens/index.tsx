import { CatalogueSpecimens } from "./catalogue";
import { RealTable } from "./integration-table";
import { PaneStripSpecimen } from "./pane-strip";
import { SatelliteSpecimens } from "./satellites";
import { TokenSpecimens } from "./tokens";
import { LevelsSpecimen } from "./levels";

export function DesignSystemSpecimens() {
  return (
    <>
      <TokenSpecimens />
      <CatalogueSpecimens />
      <RealTable />
      <PaneStripSpecimen />
      <LevelsSpecimen />
      <SatelliteSpecimens />
    </>
  );
}
