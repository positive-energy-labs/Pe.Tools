import { Save } from "lucide-react";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { ArmingStrip } from "#/components/lang/arming-strip";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { StateCell } from "#/components/lang/cell";
import { FactChip, Tag } from "#/components/lang/chip";
import { Section } from "#/components/lang/section";
import { Verb } from "#/components/lang/verb";
import { ARMING_FIXTURE } from "#/design-system/fixtures";

const noop = () => {};

export function LangWorkflowSpecimens() {
  return (
    <Section label="lang · workflow">
      <div className="flex flex-col gap-5">
        <AddressingBar
          name="family"
          sentence={<span>editing profiles/door.pea.json</span>}
          facts={
            <FactChip tone="caution" title="Two edits are not on disk.">
              unsaved draft · 2
            </FactChip>
          }
          verb={
            <Verb tone="commit" label="save profile" reason="Writes the profile" onClick={noop} />
          }
          seam={
            <FactChip dashed title="Fixture data; no document is connected.">
              fixture
            </FactChip>
          }
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <ArmingStrip
            verb={ARMING_FIXTURE.verb}
            target={ARMING_FIXTURE.target}
            count={ARMING_FIXTURE.count}
            planHash={ARMING_FIXTURE.planHash}
            reason=""
            onReasonChange={noop}
            state={{ phase: "arming" }}
            onCommit={noop}
            onCancel={noop}
          />
          <ArmingStrip
            verb={ARMING_FIXTURE.verb}
            target={ARMING_FIXTURE.target}
            count={ARMING_FIXTURE.count}
            planHash={ARMING_FIXTURE.planHash}
            reason={ARMING_FIXTURE.reasonExample}
            onReasonChange={noop}
            state={{ phase: "refused", refusal: ARMING_FIXTURE.refusal, onReplan: noop }}
            onCommit={noop}
            onCancel={noop}
          />
        </div>
        <ArtifactFrame
          head={<Tag>door 421</Tag>}
          foot={
            <>
              <Tag>2 unsaved</Tag>
              <Verb
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
      </div>
    </Section>
  );
}
