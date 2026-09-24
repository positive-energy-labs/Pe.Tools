import type { TrichotomyCellLike } from "@pe/agent-contracts";
import { Save } from "lucide-react";

import { ArmingStrip, armingStripRecipe } from "#/components/lang/arming-strip";
import { ArtifactFrame, artifactFrameRecipe } from "#/components/lang/artifact-frame";
import {
  reviewAddresses,
  ReviewRow,
  UnstageAll,
  WorkSentence,
  WorkStanding,
  workSummary,
  type CellWire,
} from "#/components/lang/band";
import { StateCell } from "#/components/lang/cell";
import { Tag } from "#/components/lang/chip";
import { Kbd } from "#/components/lang/kbd";
import { ActionButton } from "#/components/lang/action-button";
import { Verdict } from "#/components/lang/verdict";
import { ARMING_SPECIMEN } from "#/design-system/specimens-data";

import { RecipeGrid, SpecimenFrame, type GridVariantProps } from "./recipe-grid";

const noop = () => {};

/** Open, contested and Pea-agreed staged: the three verb sets the reviewer draws. */
const REVIEW_SPECIMEN: Record<string, TrichotomyCellLike> = {
  "Neck Width": { proposal: { value: "10in", confidence: "high" }, staged: null },
  "Face Width": {
    proposal: { value: "Neck Width + 5in" },
    staged: { value: "Neck Width + 6in" },
  },
  "Neck Height": { proposal: { value: "10in" }, staged: { value: "10in" } },
};
const wire: CellWire = { segment: "fields", write: async () => null, revision: 4 };

export function LangWorkflowSpecimens() {
  return (
    <>
      <SpecimenFrame name="Kbd" importPath="#/components/lang/kbd">
        <div className="flex items-center gap-2">
          <Kbd>⌘K</Kbd>
          <Kbd mute>Esc</Kbd>
        </div>
      </SpecimenFrame>
      <SpecimenFrame name="Verdict" importPath="#/components/lang/verdict">
        <div className="flex items-center gap-1">
          <Verdict kind="accept" title="Stage Pea's proposal" onClick={noop} />
          <Verdict kind="deny" title="Clear Pea's proposal" onClick={noop} />
          <Verdict kind="unstage" title="Clear the staged value" onClick={noop} />
          <Verdict kind="accept" title="Stage Pea's proposal on 3 cells" onClick={noop}>
            3
          </Verdict>
          <Verdict kind="deny" title="Refuse this call" onClick={noop}>
            deny
          </Verdict>
          <Verdict kind="accept" title="in flight" disabled onClick={noop}>
            accept
          </Verdict>
        </div>
      </SpecimenFrame>
      <SpecimenFrame
        name="WorkSentence · WorkStanding · ReviewRow · UnstageAll"
        importPath="#/components/lang/band"
      >
        <WorkSentence
          summary={workSummary(REVIEW_SPECIMEN, { groupOf: (key) => [key] }, ["field"])}
          cells={REVIEW_SPECIMEN}
          wire={wire}
          commit={<ActionButton label="save" reason="Write every staged field" onClick={noop} />}
        />
        <UnstageAll wire={wire} cells={REVIEW_SPECIMEN} keys={["Face Width"]} done={noop} />
        {reviewAddresses(REVIEW_SPECIMEN).map(([address, cell]) => (
          <ReviewRow
            key={address}
            wire={wire}
            address={address}
            label={address}
            cell={cell}
            facts={{ value: String((cell.staged ?? cell.proposal)?.value) }}
          />
        ))}
        <WorkStanding
          lifetime="Unsaved document. This Work lives until it closes. Save to keep it."
          unresolved={["another writer changed this Work; your last write did not land"]}
          conflict
          reload={noop}
        />
      </SpecimenFrame>
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
