import { Workspace } from "#/components/anatomy";
import { FamiliesMatrix } from "#/families/matrix";
import { manifest } from "#/families/manifest";
import { FamiliesReadoutBands } from "#/families/readout-bands";
import { FamiliesFilterBand } from "#/families/scope-band";
import { RouteShell } from "#/route";

export function FamiliesWorkspaceView() {
  return (
    <Workspace
      headRail={<RouteShell manifest={manifest} />}
      readoutBand={
        <>
          <FamiliesFilterBand />
          <FamiliesReadoutBands />
        </>
      }
      table={<FamiliesMatrix />}
    />
  );
}
