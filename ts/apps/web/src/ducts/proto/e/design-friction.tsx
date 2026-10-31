import { TooltipHint } from "@pe/kit/lang/tooltip";
import { transitionPatches } from "@pe/agent-contracts";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { cellFromDraft, StateCell } from "@pe/kit/lang/cell";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import type { LossesWork } from "../../work";
const KEY = "designFriction";
/** Design friction explains the diagnostic result, so it remains an authored input. */
export function DesignFriction({ work, rate }: { work: LossesWork; rate: number }) {
  const cell = work.doc?.designFriction ?? {};
  const wire: CellWire = { segment: null, revision: work.revision, write: work.write };
  return (
    <div className="flex items-baseline gap-2 p-1">
      <span>Design friction</span>
      <TooltipHint content="The rate Manual D sizes to: available static x 100 / total effective length. A duct whose own friction exceeds it is marked in the tree; a diagnostic, never a blocker. It is not written to Revit.">
        <span
          className="inline-flex items-baseline gap-1 whitespace-nowrap"
          data-e-cell={KEY}
          aria-label="design friction rate"
        >
          <StateCell
            {...cellFromDraft(cell, { value: String(rate), cap: "editable" }, String)}
            scale="row"
            numeric={{ min: 0, digits: 3 }}
            placeholder={String(DEFAULT_DESIGN_FRICTION_RATE)}
            onCommit={(text: string) =>
              work
                .write(
                  transitionPatches([], KEY, cell, {
                    kind: "set",
                    rung: { value: Number(text) },
                  }),
                )
                .then((refusal) => refusal?.message)
            }
            transitions={reviewTransitions(wire, KEY, cell)}
          />
          <span className="t-small text-ink-2" data-e-source={cell.edit ? "override" : "default"}>
            in-wg/100 ft · {cell.edit ? "yours" : "default"}
          </span>
        </span>
      </TooltipHint>
    </div>
  );
}
