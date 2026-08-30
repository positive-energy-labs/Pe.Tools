import { useState } from "react";
import { Save } from "lucide-react";

import { ArmingStrip } from "#/components/lang/arming-strip";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { StateCell } from "#/components/lang/cell";
import { FactChip, Tag } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { CounterExample, Demo, Gap } from "#/design-system/exhibit";
import { ARMING_FIXTURE } from "#/design-system/fixtures";

const noop = () => {};

export function CatalogueWorkflow() {
  return (
    <>
      <Demo
        label="ArtifactFrame"
        consumers="MasterTable, proposal cards, and ArmingStrip"
        spec="The language's one enclosure is a ground shift and quiet inset hairline. Head and foot bands carry the object's identity, facts, receipts, and commit verb."
      >
        <div className="max-w-lg">
          <ArtifactFrame
            head={
              <>
                <Tag>overhead coiling door 421</Tag>
                <FactChip title="Rows currently in scope.">13 params</FactChip>
                <FactChip dashed title="Fixture data; no real document stands behind it.">
                  fixture
                </FactChip>
              </>
            }
            foot={
              <>
                <Tag>2 unsaved</Tag>
                <Verb
                  tone="commit"
                  label="save profile"
                  icon={Save}
                  onClick={noop}
                  reason="Writes both staged values into the family profile"
                />
              </>
            }
          >
            <div className="flex flex-col gap-2 px-3 py-3">
              <StateCell value="2 hr" stage="proposed" note="matches the UL listing" />
              <StateCell value="36 in" stage="staged" stagedBy="you" />
            </div>
          </ArtifactFrame>
        </div>
        <CounterExample why="a receipt is plain content that reports on the framed object">
          <ArtifactFrame>
            <div className="px-3 py-2">
              <OutcomeLine kind="receipt" label="42 parameters written" says="it landed" />
            </div>
          </ArtifactFrame>
        </CounterExample>
        <Gap>
          ArtifactFrame has head, foot, and undifferentiated children. The type cannot require a
          full-width CellStateKey to be the last child.
        </Gap>
      </Demo>
      <ArmingCatalogue />
    </>
  );
}

function ArmingCatalogue() {
  const [reason, setReason] = useState("");
  return (
    <Demo
      label="ArmingStrip"
      consumers="parameter-links and writes whose blast radius leaves the page"
      spec="The strip is StateCell's grammar at write scale. A reason arms it; the target and plan stay visible; drift refuses before the write."
    >
      <div className="w-full max-w-3xl">
        <ArmingStrip
          verb={ARMING_FIXTURE.verb}
          target={ARMING_FIXTURE.target}
          count={ARMING_FIXTURE.count}
          planHash={ARMING_FIXTURE.planHash}
          reason={reason}
          onReasonChange={setReason}
          state={{ phase: "arming" }}
          onCommit={noop}
          onCancel={() => setReason("")}
        />
      </div>
      <CounterExample why="a commit Verb alone hides the reason, target, plan identity, and refusal path">
        <Verb tone="commit" label="apply to Revit" onClick={noop} reason="Writes 42 parameters" />
      </CounterExample>
      <Gap>
        the component has no armed-at or armed-by identity. It must say that the plan age is unknown
        until the state model grows those facts.
      </Gap>
    </Demo>
  );
}
