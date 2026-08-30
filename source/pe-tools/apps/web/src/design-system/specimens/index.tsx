import { CatalogueSpecimens } from "./catalogue";
import { RealTable } from "./integration-table";
import { SatelliteSpecimens } from "./satellites";
import { TokenSpecimens } from "./tokens";

export function DesignSystemSpecimens() {
  return (
    <>
      <TokenSpecimens />
      <CatalogueSpecimens />
      <RealTable />
      <SatelliteSpecimens />
    </>
  );
}
