import { useState } from "react";
import { Save } from "lucide-react";

import { ArmingStrip } from "@pe/kit/lang/arming-strip";
import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import { Code, JsonEditor } from "@pe/kit/lang/code";
import { StateCell, type CellHandle } from "@pe/kit/lang/cell";
import { PreviewAction } from "@pe/kit/lang/write-action";
import { Table } from "@pe/kit/table/table";
import type { CellLike } from "@pe/agent-contracts";
import { FactChip, Tag } from "@pe/kit/lang/chip";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Button } from "@pe/kit/lang/button";
import { CounterExample, Demo, Gap } from "#/design-system/exhibit";
import { ARMING_SPECIMEN } from "#/design-system/specimens-data";

const noop = () => {};

export function CatalogueWorkflow() {
  return (
    <>
      <HandleCells />
      <Demo
        label="ArtifactFrame"
        consumers="Table, suggestion cards, and ArmingStrip"
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
                <Button
                  kind="commit"
                  label="save profile"
                  icon={Save}
                  onClick={noop}
                  reason="Writes both edit values into the family profile"
                >
                  save profile
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-2 px-3 py-3">
              <StateCell value="2 hr" stage="edit" author="pea" note="matches the UL listing" />
              <StateCell value="36 in" stage="edit" author="human" />
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
      <CodeCatalogue />
      <ArmingCatalogue />
    </>
  );
}

function HandleCells() {
  const [draft, setDraft] = useState<CellLike>({ edit: { value: 900, by: "pea" } });
  const [stale, setStale] = useState(false);
  const [planned, setPlanned] = useState(false);
  const clear = async () => { setDraft({}); setPlanned(false); return null; };
  const cell: CellHandle = {
    owner: { route: "fans", label: "from /fans" }, value: draft, refusal: null,
    stage: async value => { setDraft({ edit: { value, by: "human" } }); setPlanned(false); return null; },
    clear, transitions: () => draft.edit ? [{ kind: "clear", run: clear }] : [],
  };
  const value = { value: [{ key: "flow" }], current: !stale, status: stale ? "unavailable" : "ready",
    reason: stale ? "Fixture Value changed; refresh before editing" : undefined };
  const drawing = { cell, value, label: "Fan flow", model: 800, source: "fixture", numeric: { min: 0 }, unit: { label: "cfm" } };
  return <Demo label="Value and owner handles · fixture" consumers="Fans and Ducts"
    spec="One owner handle supplies attribution, staging, refusal and clear to a cell and a table. A retained stale Value locks both. The fixture plan is deliberately unsealed; it cannot write to Revit.">
    <div className="flex items-center gap-2">
      <StateCell {...drawing} />
      <Button label="Toggle fixture freshness" onClick={() => setStale(value => !value)}>Toggle freshness</Button>
      <PreviewAction label="Write fixture" handle={{
        plan: async () => setPlanned(true), apply: () => { throw Error("Fixture has no native writes"); },
        cancel: () => setPlanned(false), read: () => planned ? { sentence: "Fixture · no native seal",
          rows: ["This plan is inspectable but cannot be applied"], stale } : null,
      }} />
    </div>
    <div className="h-40">
      <Table label="Owner handle fixture" value={value} rowsOf={data => data} rowKey={row => row.key}
        columns={[{ key: "flow", label: "Fan flow", state: () => drawing }]} />
    </div>
  </Demo>;
}

const FAILED_OUT = `{
  "target": null
}`;

const POD = `[Pod("door.audit")]
public async Task<Element> Get(string id) => await _db.Find(id); // one element
`;

/** A duct system as pea would sketch it: one AHU, two mains, branches, terminals (10 nodes). */
const DUCT_DIAGRAM = `flowchart LR
  AHU[AHU-1] -->|6000 cfm| M1[Main A]
  AHU -->|4000 cfm| M2[Main B]
  M1 --> B1[Branch A1]
  M1 --> B2[Branch A2]
  M2 --> B3[Branch B1]
  B1 --> T1([VAV A1-1])
  B1 --> T2([VAV A1-2])
  B2 --> T3([VAV A2-1])
  B3 --> T4([VAV B1-1])
`;

function CodeCatalogue() {
  const [draft, setDraft] = useState('{ "clear_width": 36 }');
  return (
    <Demo
      label="Code / JsonEditor"
      consumers="chat fenced blocks, the lens tool cell, receipts, ops output, and the settings panes"
      spec="A code payload is a machine-operated object, so it wears the artifact frame: language left, machine facts right — line count, copy, and, past 64 KB, show all. A closed mermaid fence draws as a diagram with a source toggle; unsupported types stay source. Code owns the height clamp; the container owns show/hide."
    >
      <div className="max-w-lg">
        <Code code={POD} lang="csharp" />
      </div>
      <div className="max-w-lg">
        <Code code={FAILED_OUT} lang="json" title="out" tone="alarm" />
      </div>
      <div className="max-w-lg">
        <Code code={DUCT_DIAGRAM} lang="mermaid" />
      </div>
      <CounterExample why="editing is a textarea's job — caret, selection and undo — so the editable half is paint with no chrome, and its caller frames it">
        <div className="max-w-lg">
          <ArtifactFrame head={<Tag>settings profile</Tag>}>
            <JsonEditor value={draft} onChange={setDraft} aria-label="profile json" />
          </ArtifactFrame>
        </div>
      </CounterExample>
    </Demo>
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
      <CounterExample why="a commit Button alone hides the reason, target, plan identity, and refusal path">
        <Button kind="commit" label="apply to Revit" onClick={noop} reason="Writes 42 parameters">
          apply to Revit
        </Button>
      </CounterExample>
      <Gap>
        the component has no armed-at or armed-by identity. It must say that the plan age is unknown
        until the state model grows those facts.
      </Gap>
    </Demo>
  );
}
