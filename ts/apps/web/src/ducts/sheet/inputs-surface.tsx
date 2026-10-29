/**
 * The one inputs surface of the fan sheet (protoui round 3, 2026-10-28): every row of the sheet
 * inputs census (`.artifacts/handoffs/sheet-inputs-census-20261028.md`, searchable by `census`)
 * as one labelled line under four groups, firm (file, not yet) / project / this fan / this element,
 * sub-grouped by what the value is about. A live field is a house input wired to the one write
 * it has today (`setDefaults`, `changeInputs`, the slot picker); every other field is disabled,
 * shows its current value and says exactly why it is a no-op. A bare read-out (a hash, a version,
 * a coverage count) has neither.
 *
 * Rulings (kaitpw 2026-10-28): R1 the firm group holds the defaults (a firm file in the long run,
 * document Work today); R2 rulings, drops and end cfm are per project; R3 the firm's one ESP
 * parameter is the REQUIRED ESP Pe writes, rated ESP has no firm slot.
 */
import { Fragment, useState } from "react";
import type { DuctsRouteDocument, DuctsSheetInputs } from "@pe/agent-contracts";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { IMPLAUSIBLE_FPM, IMPLAUSIBLE_ROW_IN_WG } from "@pe/ducts-domain/kernel/price-leg";
import { LOSS_RULES } from "@pe/ducts-domain/loss-rules";
import { SHEET_ENGINE_VERSION } from "@pe/ducts-domain/sheet/types";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Accordion } from "@pe/kit/lang/accordion";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { SlotPicker } from "../proto/e/slot-picker";
import { pressure } from "./api";
import type { SheetDefaults } from "./types";
import { SHIM_TERMINAL_DROP_SOURCE } from "./use-fan-sheet";
import type { OpenSheet } from "./use-sheet";

export type InputGroup = "firm" | "project" | "fan" | "element";
export const INPUT_GROUPS: readonly { key: InputGroup; label: string }[] = [
  { key: "firm", label: "firm (file, not yet)" },
  { key: "project", label: "project" },
  { key: "fan", label: "this fan" },
  { key: "element", label: "this element" },
];
export const INPUT_SUBS = [
  "airflow slots",
  "equipment slots",
  "drops",
  "rules",
  "geometry",
  "basis",
] as const;
export type InputSub = (typeof INPUT_SUBS)[number];
export type NoOp =
  | "no-op: not in contract"
  | "no-op: engine only"
  | "no-op: C# only"
  | "no-op: no home";
export type LiveKind =
  | "slot"
  | "firm-split"
  | "project-split"
  | "terminal-drop"
  | "auto-join-gap"
  | "rulings"
  | "end-rulings"
  | "end-cfm"
  | "drop";

export interface InputField {
  /** The census row name; search it in the census handoff. */
  census: string;
  group: InputGroup;
  sub: InputSub;
  label: string;
  /** The current value as text; a live field's control shows its own. */
  value: string;
  /** A disabled field says why; a live field names its control; a read-out has neither. */
  reason?: NoOp;
  live?: LiveKind;
  shim?: string;
}

export interface InputContext {
  snapshot: DuctSnapshot;
  doc: DuctsRouteDocument | null;
  revision: number | null;
  sheet: OpenSheet | null;
  defaults: SheetDefaults;
  projectInputs: DuctsSheetInputs;
  slots: readonly { slot: string; covered: number; total: number }[];
  activeSlot: string;
  /** The focused blocker's element, or null: the element group then says "pick a row". */
  element: { id: number; family: string | null } | null;
}

const text = (value: number | string | null | undefined) => (value == null ? "—" : String(value));
const count = (record: object | null | undefined) => Object.keys(record ?? {}).length;
type Cell<T> = { edit?: { value?: T } | null } | undefined;
const edit = <T,>(cell: Cell<T>) => cell?.edit?.value;

/** Every census row as a field, in surface order. Pure, so the test counts the same list. */
export function inputFields(ctx: InputContext): InputField[] {
  const { snapshot, doc, sheet, defaults, projectInputs, element } = ctx;
  const slots = snapshot.slots;
  const rows = sheet?.inputs?.inputs ?? [];
  const row = (name: string) => rows.find((input) => input.name === name);
  const fan = sheet?.overview.fan ?? null;
  const totals = sheet?.overview.totals ?? null;
  const open = sheet ? null : "no fan open";
  const assumed = rows.filter((input) => input.name.endsWith(" cfm (assumed)"));
  const rulings = projectInputs.rulings ?? [];
  const accepted = rulings.filter((r) => r.verdict === "accept").length;
  const endRulings = projectInputs.endRulings ?? [];
  const id = element?.id;
  const key = id == null ? null : String(id);
  const cell = <T,>(record: Record<string, Cell<T>> | undefined) =>
    key == null ? undefined : edit(record?.[key]);
  const revitFlow = ctx.slots.find((s) => s.slot === "revit:Flow");
  const verdicts = Object.keys(doc?.assumptions ?? {}).filter((k) => !k.includes(":")).length;
  const fanStatic = key == null ? undefined : edit(doc?.assumptions[`fan-static:${key}`]);
  const familyDrop =
    element?.family == null
      ? undefined
      : edit(doc?.assumptions[`component-drop:${element.family}`]);

  const firm: InputField[] = [
    // airflow slots
    {
      census: "Literal terminalFlow",
      group: "firm",
      sub: "airflow slots",
      label: "last-resort slot literal",
      value: "terminalFlow",
      reason: "no-op: engine only",
    },
    {
      census: "Web DEFAULT_SLOT",
      group: "firm",
      sub: "airflow slots",
      label: "web fallback slots",
      value: "PE_M_Grd_AirFlow · PE_M_Fan_AirFlowDesign",
      reason: "no-op: not in contract",
    },
    {
      census: "Split-policy default",
      group: "firm",
      sub: "airflow slots",
      label: "split policy default",
      value: defaults.splitPolicy,
      live: "firm-split",
    },
    {
      census: "Assumed served flow",
      group: "firm",
      sub: "airflow slots",
      label: "assumed served flow (A8)",
      value: "on",
      reason: "no-op: engine only",
    },
    {
      // Set from this unit's no-flow rows ("set <unit> design flow"); stored as project unitCfm.
      census: "sideStreamCfm",
      group: "fan",
      sub: "airflow slots",
      label: "unit design flow (typed)",
      value: fan ? `${text(projectInputs.unitCfm?.[String(fan.unitId)])} cfm` : "—",
    },
    // equipment slots
    {
      census: "Terminal drop slot",
      group: "firm",
      sub: "equipment slots",
      label: "terminal drop slot",
      value: text(slots?.terminalDrop),
      reason: "no-op: C# only",
    },
    {
      census: "Component drop slot",
      group: "firm",
      sub: "equipment slots",
      label: "component drop slot",
      value: text(slots?.componentDrop),
      reason: "no-op: C# only",
    },
    {
      census: "Fitting coefficient slot",
      group: "firm",
      sub: "equipment slots",
      label: "fitting coefficient slot",
      value: `${text(slots?.fittingCoefficient)} · not read by the sheet`,
      reason: "no-op: C# only",
    },
    {
      census: "Roster kind / passive heuristics",
      group: "firm",
      sub: "equipment slots",
      label: "roster kind heuristics",
      value: "regex lists (roster.ts)",
      reason: "no-op: engine only",
    },
    // drops
    {
      census: "Terminal drop default",
      group: "firm",
      sub: "drops",
      label: "terminal drop",
      value: `${text(defaults.terminalDropInWg)} in-wg`,
      live: "terminal-drop",
      ...(defaults.terminalDropSource === SHIM_TERMINAL_DROP_SOURCE
        ? { shim: "ducts-terminal-drop" }
        : {}),
    },
    {
      census: "Equipment / inline drop default",
      group: "firm",
      sub: "drops",
      label: "equipment / inline drop",
      value: "— (raises unknown-drop)",
      reason: "no-op: no home",
    },
    {
      census: "Allowance default",
      group: "firm",
      sub: "drops",
      label: "allowance default",
      value: "0 in-wg per side",
      reason: "no-op: engine only",
    },
    {
      census: "allowanceInWg (typed)",
      group: "firm",
      sub: "drops",
      label: "typed allowance",
      value: totals
        ? `supply ${pressure(totals.supply.allowanceInWg)} · return ${pressure(totals.return.allowanceInWg)} in-wg`
        : (open ?? "—"),
      reason: "no-op: not in contract",
    },
    // rules
    {
      census: "LOSS_RULES",
      group: "firm",
      sub: "rules",
      label: "loss rules",
      value: `${LOSS_RULES.length} rules → ASHRAE tables`,
      reason: "no-op: engine only",
    },
    {
      census: "Manual D equivalent-length option",
      group: "firm",
      sub: "rules",
      label: "Manual D equivalent length",
      value: "—",
      reason: "no-op: no home",
    },
    {
      census: "Implausible-loss limits",
      group: "firm",
      sub: "rules",
      label: "implausible-loss limits",
      value: `${IMPLAUSIBLE_ROW_IN_WG} in-wg · ${IMPLAUSIBLE_FPM} fpm`,
      reason: "no-op: engine only",
    },
    {
      census: "Merge policy (Q4/Q8)",
      group: "firm",
      sub: "rules",
      label: "merge policy",
      value: "price to the merge",
      reason: "no-op: engine only",
    },
    {
      census: "choices",
      group: "firm",
      sub: "rules",
      label: "table choices",
      value: "{}",
      reason: "no-op: not in contract",
    },
    // geometry
    {
      census: "Auto-join max gap",
      group: "firm",
      sub: "geometry",
      label: "auto-join gap",
      value: `${text(defaults.autoJoinMaxGapIn)} in`,
      live: "auto-join-gap",
    },
    {
      census: "Candidate box",
      group: "firm",
      sub: "geometry",
      label: "candidate box",
      value: `${text(row("candidate box in")?.value)} in`,
      reason: "no-op: C# only",
    },
    {
      census: "Heal search radius",
      group: "firm",
      sub: "geometry",
      label: "heal search radius",
      value: `${text(row("candidate box in")?.value)} in (the candidate box)`,
      reason: "no-op: C# only",
    },
    {
      census: "Facing threshold",
      group: "firm",
      sub: "geometry",
      label: "facing threshold",
      value: "cos 0.9 · 0.5 in lateral (DuctHealth.cs)",
      reason: "no-op: C# only",
    },
    {
      census: "Roughness",
      group: "firm",
      sub: "geometry",
      label: "roughness",
      value: "0.0003 ft (loss-physics.ts)",
      reason: "no-op: engine only",
    },
    {
      census: "Max hops",
      group: "firm",
      sub: "geometry",
      label: "max hops",
      value: "2000",
      reason: "no-op: C# only",
    },
    // basis
    {
      census: "Defaults version",
      group: "firm",
      sub: "basis",
      label: "defaults version",
      value: "unversioned",
      reason: "no-op: engine only",
    },
    {
      census: "Overview path cap",
      group: "firm",
      sub: "basis",
      label: "overview path cap",
      value: "5 + rest",
      reason: "no-op: engine only",
    },
    {
      census: "Engine version",
      group: "firm",
      sub: "basis",
      label: "engine version",
      value: SHEET_ENGINE_VERSION,
      reason: "no-op: engine only",
    },
    {
      census: "Engine basis",
      group: "firm",
      sub: "basis",
      label: "engine basis",
      value: "folded into the host basis",
      reason: "no-op: engine only",
    },
  ];
  const project: InputField[] = [
    // airflow slots
    {
      census: "sheetInputs.project.slot",
      group: "project",
      sub: "airflow slots",
      label: "airflow slot",
      value: ctx.activeSlot,
      live: "slot",
    },
    {
      census: "Slot coverage list",
      group: "project",
      sub: "airflow slots",
      label: "slot coverage",
      value: `${ctx.slots.length} candidates in the picker`,
    },
    {
      census: "parameters.terminalFlow",
      group: "project",
      sub: "airflow slots",
      label: "Settings grille airflow",
      value: text(edit(doc?.parameters.terminalFlow)),
      reason: "no-op: not in contract",
    },
    {
      census: "Snapshot slots.terminalFlow",
      group: "project",
      sub: "airflow slots",
      label: "snapshot slot",
      value: text(slots?.terminalFlow),
      reason: "no-op: C# only",
    },
    {
      census: "revit:Flow",
      group: "project",
      sub: "airflow slots",
      label: "revit:Flow",
      value: revitFlow ? `${revitFlow.covered}/${revitFlow.total} in the picker` : "not listed",
    },
    // Not a census row: the contract's project split override beside the firm default (contradiction 3).
    {
      census: "sheetInputs.project.splitPolicy",
      group: "project",
      sub: "airflow slots",
      label: "split policy",
      value: projectInputs.splitPolicy ?? `default (${defaults.splitPolicy})`,
      live: "project-split",
    },
    {
      census: "Chain flowCfm",
      group: "project",
      sub: "airflow slots",
      label: "chain cfm",
      value: "—",
      reason: "no-op: no home",
    },
    // equipment slots
    {
      census: "parameters.fanFlow",
      group: "project",
      sub: "equipment slots",
      label: "Settings unit airflow",
      value: text(edit(doc?.parameters.fanFlow)),
      reason: "no-op: not in contract",
    },
    {
      census: "Label parameter",
      group: "project",
      sub: "equipment slots",
      label: "label parameter",
      value: text(edit(doc?.labelParameter) ?? "PE_G___TagInstance"),
      reason: "no-op: not in contract",
    },
    {
      census: "Roster confirmation",
      group: "project",
      sub: "equipment slots",
      label: "roster confirmation",
      value: "all suggestions",
      reason: "no-op: no home",
    },
    {
      census: "Unit roles (legacy)",
      group: "project",
      sub: "equipment slots",
      label: "unit roles (legacy)",
      value: `${count(doc?.roles)} ruled`,
      reason: "no-op: not in contract",
    },
    // rules
    {
      census: "Work rules",
      group: "project",
      sub: "rules",
      label: "rule tables",
      value: `${count(doc?.rules)} edited`,
      reason: "no-op: not in contract",
    },
    {
      census: "Work ruleAssignments",
      group: "project",
      sub: "rules",
      label: "rule assignments",
      value: `${count(doc?.ruleAssignments)} edited`,
      reason: "no-op: not in contract",
    },
    {
      census: "Design friction",
      group: "project",
      sub: "rules",
      label: "design friction",
      value: `${edit(doc?.designFriction) ?? DEFAULT_DESIGN_FRICTION_RATE} in-wg/100 ft`,
      reason: "no-op: not in contract",
    },
    // geometry
    {
      census: "Join rulings",
      group: "project",
      sub: "geometry",
      label: "join rulings",
      value: `${accepted} accepted · ${rulings.length - accepted} rejected`,
      live: "rulings",
    },
    // Not a census row: R-CAP (2026-10-28) end rulings beside the pair rulings they sit with in the cell.
    {
      census: "End rulings",
      group: "project",
      sub: "geometry",
      label: "end rulings",
      value: `${endRulings.length} capped`,
      live: "end-rulings",
    },
    {
      census: "proposal",
      group: "project",
      sub: "geometry",
      label: "proposal verb",
      value: "via the ledger rows",
    },
    {
      census: "Open-end verdicts",
      group: "project",
      sub: "geometry",
      label: "open-end verdicts",
      value: `${verdicts} in old Work`,
      reason: "no-op: not in contract",
    },
    {
      census: "Path override (asserted end)",
      group: "project",
      sub: "geometry",
      label: "path override",
      value: "—",
      reason: "no-op: no home",
    },
    // basis
    {
      census: "Project overrides of firm defaults",
      group: "project",
      sub: "basis",
      label: "firm overrides",
      value: `${count(edit(doc?.sheetDefaults))} fields`,
    },
    {
      census: "Defaults version each ruling saw",
      group: "project",
      sub: "basis",
      label: "defaults version per ruling",
      value: "—",
      reason: "no-op: no home",
    },
    {
      census: "workingPhase",
      group: "project",
      sub: "basis",
      label: "working phase",
      value: text(edit(doc?.workingPhase)),
      reason: "no-op: not in contract",
    },
    {
      census: "systemColours",
      group: "project",
      sub: "basis",
      label: "system colours",
      value: `${count(edit(doc?.systemColours))} hexes`,
      reason: "no-op: not in contract",
    },
    {
      census: "Store revision",
      group: "project",
      sub: "basis",
      label: "store revision",
      value: "—",
      reason: "no-op: C# only",
    },
    {
      census: "Work revision",
      group: "project",
      sub: "basis",
      label: "Work revision",
      value: text(ctx.revision),
    },
  ];
  const fanGroup: InputField[] = [
    // equipment slots (R3)
    {
      census: "Rated ESP (FanStatic → externalStatic)",
      group: "fan",
      sub: "equipment slots",
      label: "required ESP (written)",
      value: fan
        ? `${pressure(fan.ratedEspInWg)} in-wg ← ${text(slots?.fanStatic)}`
        : (open ?? "—"),
      reason: "no-op: C# only",
    },
    {
      census: "Required ESP slot",
      group: "fan",
      sub: "equipment slots",
      label: "rated ESP",
      value: "— no firm slot",
      reason: "no-op: no home",
    },
    {
      census: "Design flow (FanFlow → fanFlow)",
      group: "fan",
      sub: "equipment slots",
      label: "design flow",
      value: sheet
        ? `${text(row("unit design cfm")?.value)} cfm · ${row("unit design cfm")?.source ?? ""}`
        : (open ?? "—"),
      reason: "no-op: C# only",
    },
    {
      census: "Assumed fan cfm (A8)",
      group: "fan",
      sub: "equipment slots",
      label: "assumed fan cfm",
      value: sheet ? `on · ${assumed.length} assumed` : (open ?? "—"),
      reason: "no-op: engine only",
    },
    // basis
    {
      census: "Host basis",
      group: "fan",
      sub: "basis",
      label: "host basis",
      value: defaults.basis ?? open ?? "—",
    },
    {
      census: "Snapshot observation version",
      group: "fan",
      sub: "basis",
      label: "snapshot version",
      value: "header only",
      reason: "no-op: C# only",
    },
    {
      census: "Tables version",
      group: "fan",
      sub: "basis",
      label: "tables version",
      value: "header only",
      reason: "no-op: C# only",
    },
    {
      census: "Settings basis / subject",
      group: "fan",
      sub: "basis",
      label: "settings basis",
      value: "canonical JSON, host only",
      reason: "no-op: engine only",
    },
  ];
  const elementGroup: InputField[] = [
    // airflow slots
    {
      census: "endCfm",
      group: "element",
      sub: "airflow slots",
      label: "typed end cfm",
      value: key == null ? "—" : `${text(projectInputs.endCfm?.[key])} cfm`,
      live: "end-cfm",
    },
    {
      census: "Work flows",
      group: "element",
      sub: "airflow slots",
      label: "Work flow",
      value: text(cell(doc?.flows)?.cfm),
      reason: "no-op: not in contract",
    },
    // equipment slots
    {
      census: "Work esp",
      group: "element",
      sub: "equipment slots",
      label: "Work esp",
      value: text(cell(doc?.esp)?.inWg),
      reason: "no-op: not in contract",
    },
    {
      census: "Work equipmentFlows",
      group: "element",
      sub: "equipment slots",
      label: "Work equipment flow",
      value: text(cell(doc?.equipmentFlows)?.cfm),
      reason: "no-op: not in contract",
    },
    {
      census: "assumptions fan-static:<id>",
      group: "element",
      sub: "equipment slots",
      label: "fan-static override",
      value: text(fanStatic?.kind === "fan-static" ? fanStatic.inWg : null),
      reason: "no-op: not in contract",
    },
    // drops
    {
      census: "drops",
      group: "element",
      sub: "drops",
      label: "typed drop",
      value: key == null ? "—" : `${text(projectInputs.drops?.[key])} in-wg`,
      live: "drop",
    },
    {
      census: "Work terminalDrops",
      group: "element",
      sub: "drops",
      label: "Work terminal drop",
      value: text(cell(doc?.terminalDrops)?.inWg),
      reason: "no-op: not in contract",
    },
    {
      census: "Work componentDrops",
      group: "element",
      sub: "drops",
      label: "Work component drop",
      value: text(cell(doc?.componentDrops)?.inWg),
      reason: "no-op: not in contract",
    },
    {
      census: "assumptions component-drop:<family>",
      group: "element",
      sub: "drops",
      label: "family drop override",
      value: text(familyDrop?.kind === "component-drop" ? familyDrop.inWg : null),
      reason: "no-op: not in contract",
    },
  ];
  return [...firm, ...project, ...fanGroup, ...elementGroup];
}

export const fieldState = (field: InputField) =>
  field.live ? "live" : field.reason ? "no-op" : "read-out";

function NumberField({
  label,
  value,
  disabled,
  placeholder,
  commit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  placeholder?: string;
  /** null when the person empties a field that held a value: remove the typed value. */
  commit: (value: number | null) => void;
}) {
  return (
    <span className="w-24">
      <Input
        key={value ?? "unset"}
        aria-label={label}
        type="number"
        min={0}
        step="any"
        face="mono"
        defaultValue={value ?? ""}
        disabled={disabled}
        placeholder={placeholder ?? "unknown"}
        onBlur={(event) => {
          const field = event.currentTarget;
          if (!field.value.trim()) {
            if (value != null) commit(null);
            return;
          }
          if (!field.validity.valid || !Number.isFinite(field.valueAsNumber)) return;
          if (field.valueAsNumber !== value) commit(field.valueAsNumber);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </span>
  );
}

function SplitToggle({
  value,
  label,
  refusal,
  onPick,
}: {
  value: "even" | "proportional" | null;
  label: string;
  refusal: string | null;
  onPick: (policy: "even" | "proportional") => void;
}) {
  return (
    <span className="flex gap-1">
      {(["even", "proportional"] as const).map((policy) => (
        <Button
          key={policy}
          kind="framed"
          label={`${label} ${policy}`}
          pressed={value === policy}
          refusal={refusal}
          onClick={() => onPick(policy)}
        >
          {policy}
        </Button>
      ))}
    </span>
  );
}

const LINES = "t-small grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1";

export function InputsSurface({
  ctx,
  busy,
  elementName,
  onSlot,
  changeInputs,
  setDefaults,
}: {
  ctx: InputContext;
  busy: boolean;
  /** The focused element in a person's words; never a raw id as the only noun. */
  elementName: string | null;
  onSlot: (slot: string) => void;
  changeInputs: (inputs: DuctsSheetInputs) => void;
  setDefaults: (next: Partial<Omit<SheetDefaults, "basis" | "terminalDropSource">>) => void;
}) {
  const [open, setOpen] = useState<string | null>("project");
  const fields = inputFields(ctx);
  const wait = busy ? "Wait for the current read" : ctx.sheet ? null : "Open a fan first";
  const id = ctx.element?.id;
  const control = (field: InputField) => {
    switch (field.live) {
      case "slot":
        return (
          <SlotPicker
            word="Airflow slot"
            current={ctx.activeSlot}
            noun="terminals"
            where="in the document"
            options={ctx.slots.map((s) => ({
              slot: s.slot,
              have: s.covered,
              of: s.total,
              label: s.slot,
            }))}
            onPick={onSlot}
          />
        );
      case "firm-split":
        return (
          <SplitToggle
            value={ctx.defaults.splitPolicy}
            label="Split default"
            refusal={busy ? "Wait for the current read" : null}
            onPick={(splitPolicy) => setDefaults({ splitPolicy })}
          />
        );
      case "project-split":
        return (
          <SplitToggle
            value={ctx.projectInputs.splitPolicy ?? null}
            label="Project split"
            refusal={wait}
            onPick={(splitPolicy) => changeInputs({ splitPolicy })}
          />
        );
      case "terminal-drop":
        return (
          <span className="flex items-baseline gap-2">
            <NumberField
              label="Terminal drop in-wg"
              value={ctx.defaults.terminalDropInWg}
              disabled={busy}
              commit={(value) => setDefaults({ terminalDropInWg: value })}
            />
            <TooltipHint content={ctx.defaults.terminalDropSource}>
              <span
                className="t-small"
                data-tone={field.shim ? "caution" : undefined}
                data-shim={field.shim}
              >
                in-wg · {field.shim ? "SHIM placeholder" : ctx.defaults.terminalDropSource}
              </span>
            </TooltipHint>
          </span>
        );
      case "auto-join-gap":
        return (
          <span className="flex items-baseline gap-2">
            <NumberField
              label="Auto-join gap in"
              value={ctx.defaults.autoJoinMaxGapIn}
              disabled={busy}
              commit={(value) => value != null && setDefaults({ autoJoinMaxGapIn: value })}
            />
            <span className="t-small text-ink-2">in</span>
          </span>
        );
      case "rulings":
        return (
          <span className="flex items-baseline gap-2">
            <span className="face-mono">{field.value}</span>
            <Button
              kind="framed"
              label="Clear every join ruling"
              refusal={wait ?? ((ctx.projectInputs.rulings?.length ?? 0) > 0 ? null : "No rulings")}
              onClick={() => changeInputs({ rulings: [] })}
            >
              clear
            </Button>
          </span>
        );
      case "end-rulings":
        return (
          <span className="flex items-baseline gap-2">
            <span className="face-mono">{field.value}</span>
            <Button
              kind="framed"
              label="Clear every end ruling"
              refusal={
                wait ?? ((ctx.projectInputs.endRulings?.length ?? 0) > 0 ? null : "No end rulings")
              }
              onClick={() => changeInputs({ endRulings: [] })}
            >
              clear
            </Button>
          </span>
        );
      case "end-cfm":
        return (
          <span className="flex items-baseline gap-2">
            <NumberField
              label="Typed end cfm"
              value={id == null ? null : (ctx.projectInputs.endCfm?.[String(id)] ?? null)}
              disabled={busy || id == null}
              placeholder={id == null ? "pick a row" : "unknown"}
              commit={(value) =>
                id != null &&
                changeInputs(
                  value == null ? { clear: { endCfm: [String(id)] } } : { endCfm: { [id]: value } },
                )
              }
            />
            <span className="t-small text-ink-2">cfm</span>
          </span>
        );
      case "drop":
        return (
          <span className="flex items-baseline gap-2">
            <NumberField
              label="Typed drop in-wg"
              value={id == null ? null : (ctx.projectInputs.drops?.[String(id)] ?? null)}
              disabled={busy || id == null}
              placeholder={id == null ? "pick a row" : text(ctx.defaults.terminalDropInWg)}
              commit={(value) =>
                id != null &&
                changeInputs(
                  value == null ? { clear: { drops: [String(id)] } } : { drops: { [id]: value } },
                )
              }
            />
            <span className="t-small text-ink-2">in-wg</span>
          </span>
        );
      default:
        return (
          <span
            className="flex min-w-0 items-baseline gap-2"
            data-noop={field.reason ? "" : undefined}
          >
            <span className="face-mono truncate" data-input-value={field.census}>
              {field.value}
            </span>
            {field.reason && <span className="t-small shrink-0 text-ink-2">{field.reason}</span>}
          </span>
        );
    }
  };
  const groups = INPUT_GROUPS.map((group) => {
    const own = fields.filter((field) => field.group === group.key);
    const live = own.filter((field) => field.live).length;
    const label =
      group.key === "element" ? `${group.label} · ${elementName ?? "pick a row"}` : group.label;
    return {
      key: group.key,
      label,
      state: `${live} live · ${own.length}`,
      body: (
        <div className={LINES} data-inputs-group={group.key}>
          {INPUT_SUBS.map((sub) => {
            const rows = own.filter((field) => field.sub === sub);
            return rows.length === 0 ? null : (
              <Fragment key={sub}>
                <span className="col-span-2 t-small text-ink-2 pt-1">{sub}</span>
                {rows.map((field) => (
                  <Fragment key={field.census}>
                    <span
                      className="truncate text-ink-2"
                      data-input-field={field.census}
                      data-input-state={fieldState(field)}
                    >
                      {field.label}
                    </span>
                    {control(field)}
                  </Fragment>
                ))}
              </Fragment>
            );
          })}
        </div>
      ),
    };
  });
  return (
    <section aria-label="Sheet inputs" data-sheet-inputs="" className="flex flex-col">
      <Accordion label="Sheet inputs" groups={groups} open={open} onOpen={setOpen} />
    </section>
  );
}
