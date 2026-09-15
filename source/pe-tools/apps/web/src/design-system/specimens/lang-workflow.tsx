import { Save } from "lucide-react";

import { AddressingBar, addressingBarRecipe } from "#/components/lang/addressing-bar";
import { ArmingStrip, armingStripRecipe } from "#/components/lang/arming-strip";
import { ArtifactFrame, artifactFrameRecipe } from "#/components/lang/artifact-frame";
import { StateCell } from "#/components/lang/cell";
import { FactChip, Tag } from "#/components/lang/chip";
import { ActionButton } from "#/components/lang/action-button";
import { ARMING_SPECIMEN } from "#/design-system/specimens-data";

import { RecipeGrid, type GridVariantProps } from "./recipe-grid";

const noop = () => {};

export function LangWorkflowSpecimens() {
  return (
    <>
      <RecipeGrid
        name="AddressingBar"
        importPath="#/components/lang/addressing-bar"
        recipe={addressingBarRecipe}
        render={() => (
          <AddressingBar
            name="family"
            sentence={<span>editing profiles/door.pea.json</span>}
            facts={
              <FactChip tone="caution" title="Two edits are not on disk.">
                unsaved draft · 2
              </FactChip>
            }
            verb={
              <ActionButton
                tone="commit"
                label="save profile"
                reason="Writes the profile"
                onClick={noop}
              />
            }
            seam={
              <FactChip dashed title="Fixture data; no document is connected.">
                fixture
              </FactChip>
            }
          />
        )}
      />
      <RecipeGrid
        name="ArmingStrip"
        importPath="#/components/lang/arming-strip"
        recipe={armingStripRecipe}
        render={(props) => <ArmingSpecimen props={props} />}
      />
      <RecipeGrid
        name="ArtifactFrame"
        importPath="#/components/lang/artifact-frame"
        recipe={artifactFrameRecipe}
        render={() => (
          <ArtifactFrame
            head={<Tag>door 421</Tag>}
            foot={
              <>
                <Tag>2 unsaved</Tag>
                <ActionButton
                  tone="commit"
                  label="save"
                  icon={Save}
                  reason="Writes both values"
                  onClick={noop}
                />
              </>
            }
          >
            <div className="grid grid-cols-2 gap-3 px-3 py-3">
              <StateCell value="24 in" />
              <StateCell value="36 in" stage="staged" />
            </div>
          </ArtifactFrame>
        )}
      />
    </>
  );
}

function ArmingSpecimen({ props }: { props: GridVariantProps }) {
  const state = props.state;
  const reason = state === "unarmed" ? "" : ARMING_SPECIMEN.reasonExample;
  const phase =
    state === "refused"
      ? ({ phase: "refused", refusal: ARMING_SPECIMEN.refusal, onReplan: noop } as const)
      : ({ phase: "arming" } as const);
  return (
    <div className="w-[24rem]">
      <ArmingStrip
        verb={ARMING_SPECIMEN.verb}
        target={ARMING_SPECIMEN.target}
        count={ARMING_SPECIMEN.count}
        planHash={ARMING_SPECIMEN.planHash}
        reason={reason}
        onReasonChange={noop}
        state={phase}
        onCommit={noop}
        onCancel={noop}
      />
    </div>
  );
}
