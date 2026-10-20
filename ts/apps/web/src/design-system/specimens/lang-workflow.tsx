import type { TrichotomyCellLike } from "@pe/agent-contracts";
import { Save } from "lucide-react";

import { ArmingStrip, armingStripRecipe } from "#/components/lang/arming-strip";
import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import {
  reviewAddresses,
  ReviewRow,
  UnstageAll,
  WorkSentence,
  WorkStanding,
  workSummary,
  type CellWire,
} from "#/components/work/band";
import { StateCell } from "@pe/kit/lang/cell";
import { Tag } from "@pe/kit/lang/chip";
import { Kbd, KeyLegend, type LegendKey } from "#/components/lang/kbd";
import { Button } from "@pe/kit/lang/button";
import { Verdict } from "@pe/kit/lang/verdict";
import { ARMING_SPECIMEN } from "#/design-system/specimens-data";

import { RecipeGrid, SpecimenFrame, type GridVariantProps } from "./recipe-grid";
import { TooltipHint } from "@pe/kit/lang/tooltip";

const noop = () => {};

/** A drawing's keys: pointer gestures as words, keys as `Kbd`. */
const LEGEND_SPECIMEN: readonly LegendKey[] = [
  { pointer: "drag", does: "orbit" },
  { keys: ["Shift"], pointer: "drag", does: "pan" },
  { pointer: "wheel", does: "zoom" },
  { keys: ["F"], does: "frame the selection" },
  { keys: ["Esc"], does: "clear the selection" },
];

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
      <SpecimenFrame name="KeyLegend" importPath="#/components/lang/kbd">
        <div className="flex items-end gap-6">
          <KeyLegend keys={LEGEND_SPECIMEN} bind={false} />
          <KeyLegend keys={LEGEND_SPECIMEN} bind={false} defaultOpen />
        </div>
      </SpecimenFrame>
      <SpecimenFrame name="Verdict" importPath="@pe/kit/lang/verdict">
        <div className="flex items-center gap-1">
          <TooltipHint content="Stage Pea's proposal">
            <Verdict kind="accept" onClick={noop} />
          </TooltipHint>
          <TooltipHint content="Clear Pea's proposal">
            <Verdict kind="deny" onClick={noop} />
          </TooltipHint>
          <TooltipHint content="Clear the staged value">
            <Verdict kind="unstage" onClick={noop} />
          </TooltipHint>
          <TooltipHint content="Stage Pea's proposal on 3 cells">
            <Verdict kind="accept" onClick={noop}>
              3
            </Verdict>
          </TooltipHint>
          <TooltipHint content="Refuse this call">
            <Verdict kind="deny" onClick={noop}>
              deny
            </Verdict>
          </TooltipHint>
          <TooltipHint content="in flight">
            <Verdict kind="accept" disabled onClick={noop}>
              accept
            </Verdict>
          </TooltipHint>
        </div>
      </SpecimenFrame>
      <SpecimenFrame
        name="WorkSentence · WorkStanding · ReviewRow · UnstageAll"
        importPath="#/components/work/band"
      >
        <WorkSentence
          summary={workSummary(REVIEW_SPECIMEN, { groupOf: (key) => [key] }, ["field"])}
          cells={REVIEW_SPECIMEN}
          wire={wire}
          commit={
            <Button kind="framed" label="save" reason="Write every staged field" onClick={noop}>
              save
            </Button>
          }
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
      <SpecimenFrame name="ArtifactFrame" importPath="@pe/kit/lang/artifact-frame">
        <ArtifactFrame
          head={<Tag>door 421</Tag>}
          foot={
            <>
              <Tag>2 unsaved</Tag>
              <Button
                kind="commit"
                label="save"
                icon={Save}
                reason="Writes both values"
                onClick={noop}
              >
                save
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3 px-3 py-3">
            <StateCell value="24 in" />
            <StateCell value="36 in" stage="staged" />
          </div>
        </ArtifactFrame>
      </SpecimenFrame>
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
