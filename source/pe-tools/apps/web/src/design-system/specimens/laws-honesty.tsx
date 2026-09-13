import { useState } from "react";

import { ArmingStrip } from "#/components/lang/arming-strip";
import { StateCell } from "#/components/lang/cell";
import { FactChip } from "#/components/lang/chip";
import { Provenance } from "#/components/lang/section";
import { ActionButton } from "#/components/lang/action-button";
import { CounterExample, Gap, Law } from "#/design-system/exhibit";
import { ARMING_SPECIMEN, PARAM_ROWS, cellProps } from "#/design-system/specimens-data";

const noop = () => {};
const row = (key: string) => PARAM_ROWS.find((item) => item.key === key)!;

export function HonestyLaws({ owner }: { owner: (name: string) => string }) {
  return (
    <>
      <Law
        name="a stand-in announces itself"
        owner={owner("a stand-in announces itself")}
        ruling="Fixture and typed-but-unproven data use the dashed seam. An unmarked surface claims that a real system stands behind it."
      >
        <FactChip dashed title="Fixture data; no host, document, or element stands behind it.">
          fixture
        </FactChip>
        <CounterExample why="the same fixture without the seam claims to be real">
          <FactChip title="Fixture data">fixture</FactChip>
        </CounterExample>
      </Law>

      <Law
        name="provenance rides with the value"
        owner={owner("provenance rides with the value")}
        ruling="A number carries its source wherever it appears. Provenance parked elsewhere makes the reader remember a join the UI already knows."
      >
        <div className="w-[20rem] max-w-full">
          <StateCell {...cellProps(row("typeComments"))} />
        </div>
        <CounterExample why="the source is detached from the value it qualifies">
          <div className="flex flex-col gap-2">
            <StateCell value="2 hr" />
            <Provenance>source · RFI-217 p.2</Provenance>
          </div>
        </CounterExample>
      </Law>

      <CeremonyLaw owner={owner("ceremony scales with blast radius")} />
    </>
  );
}

function CeremonyLaw({ owner }: { owner: string }) {
  const [reason, setReason] = useState<string>(ARMING_SPECIMEN.reasonExample);
  return (
    <Law
      name="ceremony scales with blast radius"
      owner={owner}
      ruling="A write beyond the page carries a reason, explicit target, plan hash, drift refusal, and receipt. A lone blue verb is not enough."
    >
      <div className="w-full max-w-3xl">
        <ArmingStrip
          verb={ARMING_SPECIMEN.verb}
          target={ARMING_SPECIMEN.target}
          count={ARMING_SPECIMEN.count}
          planHash={ARMING_SPECIMEN.planHash}
          reason={reason}
          onReasonChange={setReason}
          state={{ phase: "arming" }}
          onCommit={noop}
          onCancel={() => setReason("")}
        />
      </div>
      <CounterExample why="the write has no visible target, reason, or plan identity">
        <ActionButton tone="commit" label="apply to Revit" onClick={noop} reason="Writes to the model" />
      </CounterExample>
      <Gap>
        ArmingStrip cannot show who armed it or how old the plan is because that identity does not
        exist in the state model.
      </Gap>
    </Law>
  );
}
