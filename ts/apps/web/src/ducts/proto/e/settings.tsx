import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * The ducts section of the app chrome's Settings popover (the route puts it there through the
 * `settings` route-control slot): everything that is the same everywhere, so it never sits on the
 * page body. The loss Rules are not here: they are the sidebar's bottom pane (`screen.tsx`).
 * The design friction rate is a person-owned Work cell (`designFriction`, in-wg per 100 ft; Pea has
 * no write to it and Revit never receives it). The parameter slots say which Revit parameter each
 * input is read from; the two airflow slots are reassignable here (each candidate with its coverage
 * in the open system, the document when none), the same choice as the inbox's Set row. The other
 * slots are shown, not yet chosen here.
 */
import { Fragment } from "react";
import { transitionPatches } from "@pe/agent-contracts";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import { PrimaryRouteControls } from "#/navigation/route-controls";

import { airflowOptions, airflowPatches, slotWord, type AirflowOf } from "../../airflow";
import type { LossesWork } from "../../work";
import { SlotPicker } from "./slot-picker";

const KEY = "designFriction";

/** The section is one aligned list of label and value lines. */
const LINES = "t-small grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1";

type SlotScope = Pick<SystemScope, "groups" | "terminals" | "units"> | null;

/** The slots read here but not chosen here, in a person's words. */
const READ_ONLY = [
  ["fanStatic", "Unit ESP"],
  ["terminalDrop", "Grille drop"],
  ["componentDrop", "Component drop"],
  ["fittingCoefficient", "Fitting coefficient"],
] as const;

export function DuctSettings({
  work,
  rate,
  snapshot,
  scope,
}: {
  work: LossesWork;
  rate: number;
  snapshot: DuctSnapshot;
  scope: SlotScope;
}) {
  const cell = work.doc?.designFriction ?? {};
  const wire: CellWire = { segment: null, revision: work.revision, write: work.write };
  return (
    <PrimaryRouteControls route="ducts" slot="settings">
      <section
        className="hairline-t flex w-[40ch] max-w-full flex-col gap-2 pt-2"
        aria-label="Duct settings"
        data-e-settings=""
      >
        <h2 className="t-head">Ducts</h2>
        <div className={LINES} data-e-slots>
          <span className="text-ink-2">Design friction</span>
          <TooltipHint content="The rate Manual D sizes to: available static x 100 / total effective length. A duct whose own friction exceeds it is marked in the tree; a diagnostic, never a blocker. It is not written to Revit.">
            <span
              className="inline-flex items-baseline gap-1 whitespace-nowrap"
              data-e-cell={KEY}
              aria-label="design friction rate"
            >
              <StateCell
                {...cellFromTrichotomy(cell, { value: String(rate), cap: "editable" }, String)}
                scale="row"
                numeric={{ min: 0, digits: 3 }}
                placeholder={String(DEFAULT_DESIGN_FRICTION_RATE)}
                onCommit={(text: string) =>
                  work
                    .write(
                      transitionPatches([], KEY, cell, {
                        kind: "stage",
                        rung: { value: Number(text) },
                      }),
                    )
                    .then((refusal) => refusal?.message)
                }
                transitions={reviewTransitions(wire, KEY, cell)}
              />
              <span
                className="t-small text-ink-2"
                data-e-source={cell.staged ? "override" : "default"}
              >
                in-wg/100 ft · {cell.staged ? "yours" : "default"}
              </span>
            </span>
          </TooltipHint>
          <AirflowSlot snapshot={snapshot} work={work} scope={scope} of="terminal" />
          <AirflowSlot snapshot={snapshot} work={work} scope={scope} of="unit" />
          {READ_ONLY.map(([key, word]) => (
            <Fragment key={key}>
              <span className="text-ink-2">{word}</span>
              <TooltipHint content="Read from this parameter; not chosen here yet">
                <span className="face-mono">{slotWord(snapshot.slots?.[key])}</span>
              </TooltipHint>
            </Fragment>
          ))}
        </div>
      </section>
    </PrimaryRouteControls>
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
        onPick={(slot) => void work.write(airflowPatches(work.doc, slot, of) as never)}
      />
    </>
  );
}
