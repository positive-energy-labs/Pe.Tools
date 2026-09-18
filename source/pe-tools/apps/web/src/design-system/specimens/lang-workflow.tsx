import { Save } from "lucide-react";

import { AddressingBar, addressingBarRecipe } from "#/components/lang/addressing-bar";
import { ArmingStrip, armingStripRecipe } from "#/components/lang/arming-strip";
import { ArtifactFrame, artifactFrameRecipe } from "#/components/lang/artifact-frame";
import {
  reviewAddresses,
  reviewCommit,
  ReviewRow,
  WorkBand,
  type ReviewCell,
} from "#/components/lang/band";
import { StateCell } from "#/components/lang/cell";
import { FactChip, Tag } from "#/components/lang/chip";
import { Kbd } from "#/components/lang/kbd";
import { ActionButton } from "#/components/lang/action-button";
import { ARMING_SPECIMEN } from "#/design-system/specimens-data";

import { RecipeGrid, SpecimenFrame, type GridVariantProps } from "./recipe-grid";

const noop = () => {};

/** Open, contested and Pea-agreed staged: the three verb sets the reviewer draws. */
const REVIEW_SPECIMEN: Record<string, ReviewCell> = {
  "Neck Width": { proposal: { value: "10in", confidence: "high" }, staged: null },
  "Face Width": {
    proposal: { value: "Neck Width + 5in" },
    staged: { value: "Neck Width + 6in" },
  },
  "Neck Height": { proposal: { value: "10in" }, staged: { value: "10in" } },
};
const write = async () => null;

export function LangWorkflowSpecimens() {
  return (
    <>
      <SpecimenFrame name="Kbd" importPath="#/components/lang/kbd">
        <div className="flex items-center gap-2">
          <Kbd>⌘K</Kbd>
          <Kbd mute>Esc</Kbd>
        </div>
      </SpecimenFrame>
      <SpecimenFrame name="WorkBand · ReviewRow" importPath="#/components/lang/band">
        <WorkBand
          count={2}
          noun="edit"
          revision={4}
          discard={noop}
          commit={reviewCommit("save 2 staged", 2, noop)}
          visible
          body={reviewAddresses(REVIEW_SPECIMEN).map(([address, cell]) => (
            <ReviewRow
              key={address}
              segment="fields"
              address={address}
              label={address}
              cell={cell}
              facts={{ value: String((cell.staged ?? cell.proposal)?.value) }}
              write={write}
            />
          ))}
        />
      </SpecimenFrame>
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
