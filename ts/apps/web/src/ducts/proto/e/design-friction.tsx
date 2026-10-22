/**
 * The design friction rate: one number that is the same everywhere, so it lives in a settings
 * popover from the tree pane's header, never on the page body. It is a person-owned Work cell
 * (`designFriction`, in-wg per 100 ft; Pea has no write to it and Revit never receives it). The
 * tree marks a duct whose own rate exceeds it; the run detail names both rates.
 */
import { Settings2 } from "lucide-react";
import { transitionPatches } from "@pe/agent-contracts";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { Button } from "@pe/kit/lang/button";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { Popover, PopoverContent, PopoverTrigger } from "@pe/kit/lang/popover";
import { reviewTransitions, type CellWire } from "#/components/work/band";

import type { LossesWork } from "../../work";

const KEY = "designFriction";

export function DesignFrictionSettings({ work, rate }: { work: LossesWork; rate: number }) {
  const cell = work.doc?.designFriction ?? {};
  const wire: CellWire = { segment: null, revision: work.revision, write: work.write };
  return (
    <Popover>
      <PopoverTrigger render={<Button icon={Settings2} label="duct settings" />} />
      <PopoverContent align="end" data-e-settings="">
        <div className="flex flex-col gap-2">
          <p className="font-medium">Design friction rate</p>
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
              in-wg per 100 ft · {cell.staged ? "yours" : "default"}
            </span>
          </span>
          <p className="t-small text-ink-2">
            The rate Manual D sizes to: available static x 100 / total effective length. A duct
            whose own friction exceeds it is marked in the tree; a diagnostic, never a blocker. It
            is not written to Revit.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
