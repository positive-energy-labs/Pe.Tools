import { Fragment, useState } from "react";
import { DUCT_AIR_TYPES, type DuctAirType } from "@pe/agent-contracts";
import { Input } from "@pe/kit/lang/input";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { coloursOf } from "../../colours";
const LINES = "t-small grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import { airflowOptions, airflowPatches, type AirflowOf } from "../../airflow";
import type { LossesWork } from "../../work";
import { SlotPicker } from "./slot-picker";
import { cellFromDraft, StateCell } from "@pe/kit/lang/cell";
import { transitionPatches } from "@pe/agent-contracts";
import { reviewTransitions } from "#/components/work/band";
type SlotScope = Pick<SystemScope, "groups" | "terminals" | "units"> | null;
export function ParameterSlots({
  snapshot,
  work,
  scope,
}: {
  snapshot: DuctSnapshot;
  work: LossesWork;
  scope: SlotScope;
}) {
  return (
    <div
      className="t-small grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1"
      aria-label="Parameter slots"
    >
      <AirflowSlot snapshot={snapshot} work={work} scope={scope} of="terminal" />
      <AirflowSlot snapshot={snapshot} work={work} scope={scope} of="unit" />
      {(
        [
          ["fanStatic", "Unit ESP"],
          ["terminalDrop", "Grille drop"],
          ["componentDrop", "Component drop"],
          ["fittingCoefficient", "Fitting coefficient"],
        ] as const
      ).map(([key, label]) => {
        const cell = work.doc?.parameters[key] ?? {};
        return (
          <label key={key} className="contents">
            <span>{label}</span>
            <StateCell
              {...cellFromDraft(cell, { value: snapshot.slots[key], cap: "editable" }, String)}
              scale="row"
              onCommit={(value: string) =>
                work
                  .write(
                    transitionPatches(["parameters"], key, cell, { kind: "set", rung: { value } }),
                  )
                  .then((refusal) => refusal?.message)
              }
              transitions={reviewTransitions(
                { segment: "parameters", revision: work.revision, write: work.write },
                key,
                cell,
              )}
            />
          </label>
        );
      })}
    </div>
  );
}
/** The airflow read slot as one line: the parameter grilles (or units) read their flow from, a picker over every candidate with its coverage, best first. */
function AirflowSlot({
  snapshot,
  work,
  scope,
  of,
}: {
  snapshot: DuctSnapshot;
  work: LossesWork;
  scope: SlotScope;
  of: AirflowOf;
}) {
  const { current, options } = airflowOptions(snapshot, scope, of);
  const noun = of === "unit" ? "units" : "grilles";
  const word = of === "unit" ? "Unit airflow" : "Grille airflow";
  return (
    <>
      <span
        className="text-ink-2"
        data-e-airflow={of === "unit" ? undefined : current}
        data-e-unit-airflow={of === "unit" ? current : undefined}
      >
        {word}
      </span>
      <SlotPicker
        word={word}
        current={current}
        options={options}
        noun={noun}
        where={scope ? "in this system" : "in the document"}
        onPick={(slot) => void work.write(airflowPatches(work.doc, slot, of))}
      />
    </>
  );
}

const AIR_WORDS: Record<DuctAirType, string> = {
  supply: "Supply air",
  return: "Return air",
  exhaust: "Exhaust air",
  fresh: "Fresh / outdoor air",
  unknown: "Unknown / mixed",
};

/** One person-owned Work cell, like designFriction; this palette never reaches Revit. */
export function SystemColours({ work }: { work: LossesWork }) {
  const colours = coloursOf(work.doc);
  const cell = work.doc?.systemColours ?? {};
  const [refusal, setRefusal] = useState<string | null>(null);
  const change = async (type: DuctAirType, ink: string) => {
    try {
      const result = await work.write(
        transitionPatches([], "systemColours", cell, {
          kind: "set",
          rung: { value: { ...colours, [type]: ink } },
        }),
      );
      setRefusal(result?.message ?? null);
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section
      className="hairline-t flex flex-col gap-1 pt-2"
      aria-label="System colours"
      data-system-colours=""
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="t-small">System colours</h3>
        <span className="t-small text-ink-2">{cell.edit ? "yours" : "unproven defaults"}</span>
      </div>
      <div className={LINES}>
        {DUCT_AIR_TYPES.map((type) => (
          <Fragment key={type}>
            <label className="text-ink-2" htmlFor={`duct-colour-${type}`}>
              {AIR_WORDS[type]}
            </label>
            <span className="flex items-center gap-2">
              <span className="w-[7ch] shrink-0">
                <Input
                  type="color"
                  id={`duct-colour-${type}`}
                  aria-label={`${AIR_WORDS[type]} colour`}
                  value={colours[type]}
                  onChange={(e) => void change(type, e.currentTarget.value)}
                />
              </span>
              <span className="face-mono">{colours[type]}</span>
            </span>
          </Fragment>
        ))}
      </div>
      {refusal && <OutcomeLine kind="refused" label={refusal} />}
    </section>
  );
}
