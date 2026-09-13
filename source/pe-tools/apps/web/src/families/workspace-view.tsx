import { Workspace } from "#/components/anatomy";
import { FamiliesMatrix } from "#/families/matrix";
import { manifest } from "#/families/manifest";
import { FamiliesReadoutBands } from "#/families/readout-bands";
import { FamiliesFilterBand } from "#/families/scope-band";
import { RouteShell } from "#/route";
import { useFamiliesWorkspace } from "#/families/workspace-context";

export function FamiliesWorkspaceView() {
  const { store } = useFamiliesWorkspace();
  return (
    <Workspace
      headRail={<RouteShell manifest={manifest} handle={store.handle} />}
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
