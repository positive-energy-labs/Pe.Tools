import { Workspace } from "#/anatomy";
import { FamiliesHead } from "#/families/head";
import { FamiliesMatrix } from "#/families/matrix";
import { FamiliesReadoutBands } from "#/families/readout-bands";
import { FamiliesScopeBand } from "#/families/scope-band";
import { useFamiliesWorkspace } from "#/families/workspace-context";

export function FamiliesWorkspaceView() {
  const { store } = useFamiliesWorkspace();
  return (
    <Workspace
      className="bg-page text-ink"
      headRail={<FamiliesHead store={store} />}
      readoutBand={
        <>
          <FamiliesScopeBand />
          <FamiliesReadoutBands />
        </>
      }
      table={<FamiliesMatrix />}
    />
  );
}
