import { Fragment, useState } from "react";
import { DUCT_AIR_TYPES, type DuctAirType } from "@pe/agent-contracts";
import { Input } from "@pe/kit/lang/input";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { coloursOf } from "../../colours";
const LINES = "t-small grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1";
import type { LossesWork } from "../../work";
import { transitionPatches } from "@pe/agent-contracts";
const AIR_WORDS: Record<DuctAirType, string> = {
  supply: "Supply air",
  return: "Return air",
  exhaust: "Exhaust air",
  fresh: "Fresh / outdoor air",
  unknown: "Unknown / mixed",
};

/** This ducts-owned palette never reaches Revit. */
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
