/**
 * The ducts section of the app chrome's Settings popover (the route puts it there through the
 * `settings` route-control slot): everything that is the same everywhere, so it never sits on the
 * page body. The loss Rules are reached from it as one more popover (`RulesPopover`).
 * The design friction rate is a person-owned Work cell (`designFriction`, in-wg per 100 ft; Pea has
 * no write to it and Revit never receives it). The parameter slots say which Revit parameter each
 * input is read from; the two airflow slots are reassignable here (each candidate with its coverage
 * in the open system, the document when none), the same choice as the inbox's Set row. The other
 * slots are shown, not yet chosen here.
 */
import { useRef, useState } from "react";
import { transitionPatches } from "@pe/agent-contracts";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import type { Priced } from "@pe/ducts-domain/pricing";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Button } from "@pe/kit/lang/button";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { Popover, PopoverContent, PopoverTrigger } from "@pe/kit/lang/popover";
import { reviewTransitions, type CellWire } from "#/components/work/band";
import { PrimaryRouteControls } from "#/navigation/route-controls";

import { airflowOptions, airflowPatches, slotWord, type AirflowOf } from "../../airflow";
import type { LossesWork } from "../../work";
import { RulesTree } from "./rules-pane";

const KEY = "designFriction";

type SlotScope = Pick<SystemScope, "groups" | "terminals" | "units"> | null;

/** The slots read here but not chosen here, in a person's words. */
const READ_ONLY = [
  ["fanStatic", "Unit ESP"],
  ["terminalDrop", "Grille drop"],
  ["componentDrop", "Component drop"],
  ["fittingCoefficient", "Fitting coefficient"],
] as const;

/** What the Rules popover needs from the screen: the priced read, the system, and the tree's jump. */
export type RulesHandle = {
  priced: Priced | null;
  groups: readonly string[];
  open: boolean;
  setOpen: (open: boolean) => void;
  focus: string | null;
  setFocus: (key: string | null) => void;
  nameOf: (id: number) => string;
  light: (ids: readonly number[] | null) => void;
};

export function DuctSettings({
  work,
  rate,
  snapshot,
  scope,
  rules,
}: {
  work: LossesWork;
  rate: number;
  snapshot: DuctSnapshot;
  scope: SlotScope;
  rules: RulesHandle;
}) {
  const cell = work.doc?.designFriction ?? {};
  const wire: CellWire = { segment: null, revision: work.revision, write: work.write };
  return (
    <PrimaryRouteControls route="ducts" slot="settings">
      <section
        className="hairline-t flex w-[44ch] max-w-full flex-col gap-2 pt-2"
        aria-label="Duct settings"
        data-e-settings=""
      >
        <h2 className="t-head">Ducts</h2>
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
          <span className="t-small text-ink-2" data-e-source={cell.staged ? "override" : "default"}>
            in-wg per 100 ft · {cell.staged ? "yours" : "default"}
          </span>
        </span>
        <p className="t-small text-ink-2">
          The rate Manual D sizes to: available static x 100 / total effective length. A duct whose
          own friction exceeds it is marked in the tree; a diagnostic, never a blocker. It is not
          written to Revit.
        </p>
        <p className="border-line border-t pt-2 font-medium">Parameter slots</p>
        <AirflowSlot snapshot={snapshot} work={work} scope={scope} of="terminal" />
        <AirflowSlot snapshot={snapshot} work={work} scope={scope} of="unit" />
        <dl className="t-small grid grid-cols-[auto_1fr] gap-x-2" data-e-slots>
          {READ_ONLY.map(([key, word]) => (
            <div key={key} className="contents">
              <dt className="text-ink-2">{word}</dt>
              <dd className="face-mono">{slotWord(snapshot.slots?.[key])}</dd>
            </div>
          ))}
        </dl>
        <RulesPopover rules={rules} snapshot={snapshot} work={work} />
      </section>
    </PrimaryRouteControls>
  );
}

/**
 * The loss Rules, as a popover off the Settings section. A rule is a fitting type (family : type)
 * plus a geometry condition; its table is the one choice a person makes and Pe re-looks-up every
 * instance under it. The tree's element rows open it on their rule (`rules.setOpen`), so it falls
 * back to the chrome Settings button as its anchor while the section's own trigger is hidden.
 */
function RulesPopover({
  rules,
  snapshot,
  work,
}: {
  rules: RulesHandle;
  snapshot: DuctSnapshot;
  work: LossesWork;
}) {
  const trigger = useRef<HTMLSpanElement>(null);
  const [wide, setWide] = useState(false);
  const { priced } = rules;
  return (
    <Popover open={rules.open && priced != null} onOpenChange={rules.setOpen}>
      <span ref={trigger} className="border-line border-t pt-2" data-e-rules-trigger="">
        <PopoverTrigger
          render={
            <Button label="loss rules" refusal={priced ? undefined : "Rules appear once the system is priced"}>
              Loss rules…
            </Button>
          }
        />
      </span>
      {priced ? (
        <PopoverContent
          side="left"
          align="start"
          className="w-[66ch] max-w-(--available-width) p-2"
          data-e-rules-popover=""
          anchor={() =>
            (trigger.current?.getClientRects().length
              ? trigger.current
              : document.querySelector("button[data-chrome-settings]")) as Element
          }
        >
          <div className="mb-1 flex items-baseline gap-2">
            <p className="font-medium">Loss rules</p>
            <span
              className="t-small text-ink-2 min-w-0 flex-1 truncate"
              title="A rule is a fitting type (family : type) plus a geometry condition. Its table is the one choice a person makes; Pe re-looks-up every instance under it. A fitting with a stated drop is an override under its type."
            >
              table per fitting type · {wide ? "every system" : "this system"}
            </span>
            <Button
              label={wide ? "rules of this system only" : "rules of every system"}
              onClick={() => setWide(!wide)}
            >
              {wide ? "this system" : "all systems"}
            </Button>
          </div>
          <RulesTree
            snapshot={snapshot}
            priced={priced}
            groups={rules.groups}
            wide={wide}
            work={work}
            focus={rules.focus}
            onFocus={rules.setFocus}
            nameOf={rules.nameOf}
            light={rules.light}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}

/** The airflow read slot: the parameter grilles (or units) read their flow from, and every candidate's coverage. */
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
  const at = options.find((o) => o.slot === current);
  const noun = of === "unit" ? "units" : "grilles";
  const where = scope ? "in this system" : "in the document";
  return (
    <div
      data-e-airflow={of === "unit" ? undefined : current}
      data-e-unit-airflow={of === "unit" ? current : undefined}
    >
      <p className="t-small">
        {of === "unit" ? "Unit airflow from " : "Grille airflow from "}
        <span className="face-mono">{slotWord(current)}</span>
        <span className="text-ink-2">
          {" "}
          · {at?.have ?? 0} of {at?.of ?? 0} {noun} read
        </span>
      </p>
      <div className="flex flex-wrap gap-1 pt-1">
        {options.map((o) => (
          <Button
            key={o.slot}
            kind="framed"
            label={`${o.label} · ${o.have}/${o.of}`}
            reason={`Read every ${of === "unit" ? "unit" : "grille"}'s airflow from ${o.label}: ${o.have} of ${o.of} ${noun} ${where} hold a value`}
            pressed={o.slot === current}
            onClick={() => void work.write(airflowPatches(work.doc, o.slot, of) as never)}
          >
            {o.label} · {o.have}/{o.of}
          </Button>
        ))}
      </div>
    </div>
  );
}
