import { useState, type JSX, type ReactNode } from "react";
import { Redo2, Undo2 } from "lucide-react";
import type {
  DuctsInputs,
  DuctsRouteDocument,
  DuctsSheetEdits,
  DuctUnitKind,
  FittingPricing,
  Resolved,
} from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Button } from "@pe/kit/lang/button";
import { SubjectText } from "@pe/kit/lang/subject-text";
import { airflowOptions, type AirflowOption } from "../airflow";
import { ChoiceCell, type CellAct } from "./choice-cell";
import { criterionLabel } from "./criterion-words";
import { fittingGroups, memberSubject, type FittingGroup } from "./fitting-groups";
import type { EditMeta } from "./input-history";
import { inputRows, SECTION_WORDS, type InputRow, type InputSection } from "./input-rows";
import { SheetCell, type WorkCell } from "./sheet-cell";
import type { OpenSheet } from "../sources";

export interface InputContext {
  snapshot: DuctSnapshot;
  doc: DuctsRouteDocument | null;
  revision: number | null;
  sheet: OpenSheet | null;
  inputs: DuctsInputs | null;
  firm: { version: string; path: string; present: boolean } | null;
  slots: readonly { slot: string; covered: number; total: number }[];
  activeSlot: string;
  element: { id: number; family: string | null } | null;
  /** Every fitting the open sheet priced (the inputs detail's census); empty until it lands. */
  fittings: readonly FittingPricing[];
  /** Each served ASHRAE table's title, by id: what a table option means. */
  tableTitles?: Readonly<Record<string, string>>;
}

/** What an edit is, for the history line and the row that offers its restore. */
export type { EditMeta } from "./input-history";

/** The kernel's Work journal as the Inputs surface draws it. */
export interface InputsHistory {
  undoLabel: string | null;
  redoLabel: string | null;
  last: { label: string; words: string; refusal?: string } | null;
  /** The last edit when it was a clear: its row offers "restore" until the next edit. */
  cleared: { press: string; rowKey: string | null; was: string } | null;
  undo: () => void;
  redo: () => void;
  restore: (press: string) => void;
}

const sourceChip = ({ source, ref }: Resolved<unknown>) => `${source}${ref ? ` ${ref}` : ""}`;

type Criterion = {
  key: string;
  label: string;
  source: string;
  cell?: WorkCell;
} & (
  | {
      kind: "number";
      value: number;
      unit: string;
      positive?: boolean;
      /** A number writes this criterion (or side) into the project layer; null removes only it. */
      edit: (value: number | null) => DuctsSheetEdits;
    }
  | {
      kind: "split";
      value: "even" | "proportional";
      edit: (value: "even" | "proportional") => DuctsSheetEdits;
    }
);
/** The settings rows come only from resolved inputs; Work identifies pending join/end rulings. */
export function inputFields(ctx: InputContext): { criteria: Criterion[]; rows: InputRow[] } {
  const criteria: Criterion[] = [];
  if (!ctx.inputs) return { criteria, rows: [] };
  const inputs = ctx.inputs;
  const c = inputs.criteria;
  const staged = ctx.doc?.criteria?.edit;
  const criterionCell = (key: string, side?: "supply" | "return"): WorkCell => {
    const record = staged?.value as Record<string, unknown> | undefined;
    const value = side
      ? (record?.[key] as Record<string, unknown> | undefined)?.[side]
      : record?.[key];
    return value === undefined ? {} : { edit: { ...staged, value } };
  };
  const sided = (key: "velocityLimitFpm" | "allowanceInWg", unit: string) => {
    for (const side of ["supply", "return"] as const)
      criteria.push({
        key: `${key}:${side}`,
        label: `${criterionLabel(key)} ${side}`,
        kind: "number",
        unit,
        value: c[key][side].value,
        source: sourceChip(c[key][side]),
        cell: criterionCell(key, side),
        positive: key === "velocityLimitFpm",
        // The edited side only: the other keeps its own source (typed, stored or firm).
        edit: (value) => ({ criteria: { [key]: { [side]: value } } }),
      });
  };
  sided("velocityLimitFpm", "fpm");
  for (const [key, unit] of [
    ["terminalDropInWg", "in-wg"],
    ["autoJoinGapIn", "in"],
    ["healBoxIn", "in"],
  ] as const)
    criteria.push({
      key,
      label: criterionLabel(key),
      kind: "number",
      unit,
      value: c[key].value,
      source: sourceChip(c[key]),
      cell: criterionCell(key),
      edit: (value) => ({ criteria: { [key]: value } }),
    });
  criteria.push({
    key: "splitPolicy",
    label: criterionLabel("splitPolicy"),
    kind: "split",
    value: c.splitPolicy.value,
    source: sourceChip(c.splitPolicy),
    edit: (splitPolicy) => ({ criteria: { splitPolicy } }),
  });
  sided("allowanceInWg", "in-wg");

  return {
    criteria,
    rows: inputRows({
      snapshot: ctx.snapshot,
      doc: ctx.doc,
      inputs: ctx.inputs,
      fanUnitId: ctx.sheet?.overview.fan?.unitId ?? null,
      pathSubject: (key) => {
        const f = ctx.fittings.find((x) => x.key === key);
        return f ? memberSubject(f) : null;
      },
    }),
  };
}

const SPLIT_POLICIES = [
  {
    key: "even",
    label: "even",
    description: "a junction with no terminal flows splits its air equally between its branches",
  },
  {
    key: "proportional",
    label: "proportional",
    description: "a junction with no terminal flows splits its air by each branch's duct area",
  },
];

function CriterionControl({
  row,
  refusal,
  changeInputs,
  cell,
  act,
}: {
  row: Criterion;
  refusal: string | null;
  changeInputs: (edits: DuctsSheetEdits) => void | Promise<unknown>;
  cell?: DuctsRouteDocument["criteria"];
  act?: CellAct;
}) {
  if (row.kind === "split")
    return (
      <>
        <ChoiceCell
          label={row.label}
          options={SPLIT_POLICIES}
          current={row.value}
          cell={cell}
          path={["criteria"]}
          show={(v) => (v as { splitPolicy?: string } | null)?.splitPolicy ?? "—"}
          refusal={refusal}
          pick={(policy) => {
            if (policy !== row.value) changeInputs(row.edit(policy as "even" | "proportional"));
          }}
          act={act}
        />
        <span className="t-small min-w-0 truncate text-ink-2" data-input-source={row.source}>
          {row.source}
        </span>
      </>
    );
  return (
    <SheetCell
      label={`${row.label} ${row.unit}`}
      value={row.value}
      unit={{ label: row.unit }}
      digits={row.unit === "in-wg" ? 4 : 1}
      source={row.source}
      cell={row.cell}
      refusal={refusal}
      positive={row.positive}
      clearable={row.cell?.edit !== undefined}
      onValue={(value) => changeInputs(row.edit(value))}
    />
  );
}

/**
 * The Protocol section's slot pickers (ducts LEDGER 2026-10-29: protocol is a Work `parameters`
 * cell the C# read consumes, never the engine). Terminal flow counts the roster's terminals; fan
 * flow counts the units on this fan's walk (the sheet's scoped read and its `fanFlowCandidates`).
 */
export function protocolPickers(ctx: Pick<InputContext, "snapshot" | "slots" | "activeSlot">): {
  key: "terminalFlow" | "fanFlow";
  word: string;
  current: string;
  options: AirflowOption[];
  noun: string;
  where: string;
}[] {
  const fan = airflowOptions(ctx.snapshot, null, "unit");
  return [
    {
      key: "terminalFlow",
      word: "Airflow slot",
      current: ctx.activeSlot,
      options: ctx.slots.map((s) => ({
        slot: s.slot,
        have: s.covered,
        of: s.total,
        label: s.slot,
      })),
      noun: "terminals",
      where: "in the document",
    },
    { key: "fanFlow", word: "Fan flow slot", ...fan, noun: "units", where: "on this fan's walk" },
  ];
}

/** Label, value, source, verb: one aligned list, as the network settings pane lines up. */
const ROWS =
  "grid grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,4.5rem)_auto] items-center gap-x-2 gap-y-1";
const SECTIONS: InputSection[] = ["units", "terminals", "parts", "rulings"];
const inWg = (v: number | null) => (v == null ? "—" : v.toFixed(4));

/** The history line: undo, redo, and what the last edit did to this fan's numbers. */
function HistoryLine({ history, refusal }: { history: InputsHistory; refusal: string | null }) {
  const last = history.last;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" data-inputs-history="">
      <Button
        kind="framed"
        icon={Undo2}
        label={history.undoLabel ? `Undo ${history.undoLabel}` : "Undo"}
        refusal={
          refusal ??
          (history.undoLabel ? null : "Nothing to undo: this page has made no edit since it loaded")
        }
        onPress={history.undo}
      >
        undo
      </Button>
      <Button
        kind="framed"
        icon={Redo2}
        label={history.redoLabel ? `Redo ${history.redoLabel}` : "Redo"}
        refusal={refusal ?? (history.redoLabel ? null : "Nothing to redo")}
        onPress={history.redo}
      >
        redo
      </Button>
      {last && (
        <span
          role="status"
          className="t-small min-w-0 basis-full break-words"
          data-inputs-effect=""
          data-tone={last.refusal ? "alarm" : undefined}
          title={`${last.label}: ${last.refusal ?? last.words}`}
        >
          {last.label}: <span className="face-mono">{last.refusal ?? last.words}</span>
        </span>
      )}
    </div>
  );
}

/** The verb column: clear a typed value, or restore what the last edit cleared on this row. */
function RowVerb({
  rowKey,
  clear,
  history,
  refusal,
  apply,
  label,
  was,
}: {
  rowKey: string;
  clear: DuctsSheetEdits | null;
  history: InputsHistory;
  refusal: string | null;
  apply: (edits: DuctsSheetEdits, meta: EditMeta) => void;
  label: string;
  was: string;
}) {
  if (history.cleared?.rowKey === rowKey)
    return (
      <Button
        label={`Restore ${history.cleared.was}`}
        reason={`Cleared ${history.cleared.was}; restore puts it back (the undo of the last edit)`}
        refusal={refusal}
        onPress={() => history.restore(history.cleared!.press)}
      >
        restore
      </Button>
    );
  if (!clear) return <span />;
  return (
    <Button
      label={`Clear ${label}`}
      reason="Return to the source underneath; restore stays offered until the next edit"
      refusal={refusal}
      onPress={() => apply(clear, { label: `clear ${label}`, rowKey, clear: true, was })}
    >
      clear
    </Button>
  );
}

function GroupPicker({
  group,
  doc,
  refusal,
  apply,
  act,
}: {
  group: FittingGroup;
  doc: DuctsRouteDocument | null;
  refusal: string | null;
  apply: (edits: DuctsSheetEdits, meta: EditMeta) => void;
  act?: CellAct;
}) {
  if (!group.choices.length)
    return <span className="face-mono text-right">{group.table ?? "—"}</span>;
  const name = group.key.slice(group.key.indexOf(":") + 1);
  // The Work cell a choice here writes: the rule's table, or the family's assigned rule.
  const path = group.kind === "rule" ? ["rules", name] : ["ruleAssignments", name];
  const cell = group.kind === "rule" ? doc?.rules[name] : doc?.ruleAssignments[name];
  const label = (key: string | undefined) =>
    group.choices.find((c) => c.key === key || c.key.startsWith(`${key}|`))?.label ?? key ?? "—";
  return (
    <ChoiceCell
      label={`Table for ${group.title}`}
      options={group.choices.map((c) => ({ key: c.key, label: c.label, description: c.sub }))}
      current={group.choices.find((c) => c.current)?.key ?? null}
      cell={cell}
      path={path}
      show={(v) =>
        label(
          group.kind === "rule"
            ? (v as { table?: string } | null)?.table?.toUpperCase()
            : (v as { rule?: string } | null)?.rule,
        )
      }
      refusal={refusal}
      pick={(key) => {
        const choice = group.choices.find((c) => c.key === key);
        if (!choice?.edits) return;
        apply(choice.edits, {
          label: `${group.title} → ${choice.label}`,
          rowKey: group.key,
          was: `${group.title} ${group.table ?? "not priced"}`,
        });
      }}
      act={act}
    />
  );
}

function FittingGroupRows({
  group,
  doc,
  history,
  refusal,
  apply,
  act,
}: {
  group: FittingGroup;
  doc: DuctsRouteDocument | null;
  history: InputsHistory;
  refusal: string | null;
  apply: (edits: DuctsSheetEdits, meta: EditMeta) => void;
  act?: CellAct;
}) {
  const [open, setOpen] = useState(group.unpriced > 0 || group.members.length <= 3);
  return (
    <div className="contents" data-fitting-group={group.key} data-fitting-source={group.source}>
      <span
        className="col-span-4 mt-1 min-w-0 border-t border-line pt-1"
        title={`${group.title}: a choice here applies to ${group.reach}`}
      >
        <span className="block font-semibold break-words">{group.title}</span>
        <span className="block t-small text-ink-2 break-words">
          {group.tableMeaning ?? (group.unpriced ? "no table prices these" : "")}
          {" · "}
          {group.reach}
        </span>
      </span>
      {group.members.length > 0 ? (
        <span className="flex min-w-0 items-baseline gap-2 t-small text-ink-2">
          <Button
            label={
              open
                ? `Hide the ${group.members.length} fittings`
                : `Show the ${group.members.length} fittings`
            }
            onPress={() => setOpen(!open)}
          >
            {open ? "▾" : "▸"} {group.members.length} on this fan
          </Button>
          <span className="face-mono">{group.lossInWg == null ? "" : inWg(group.lossInWg)}</span>
          {group.unpriced > 0 && <span data-tone="alarm">{group.unpriced} not priced</span>}
        </span>
      ) : (
        <span className="t-small text-ink-2">none on this fan</span>
      )}
      <GroupPicker group={group} doc={doc} refusal={refusal} apply={apply} act={act} />
      <span
        className="t-small min-w-0 truncate text-ink-2"
        data-input-source={group.source}
        title={group.source}
      >
        {group.source}
      </span>
      <RowVerb
        rowKey={group.key}
        clear={group.clear}
        history={history}
        refusal={refusal}
        apply={apply}
        label={`${group.title} choice`}
        was={`${group.title} ${group.table ?? ""}`.trim()}
      />
      {open &&
        group.members.map((m) => (
          <div key={m.key} className="contents" data-fitting={m.key}>
            <span className="min-w-0 truncate pl-4">
              <SubjectText text={m.subject} revit={m.ids} owner={`fitting:${m.key}`} />
            </span>
            <span className="face-mono text-right">{inWg(m.lossInWg)}</span>
            <span className="col-span-2 t-small min-w-0 truncate text-ink-2" title={m.note ?? ""}>
              {m.note ?? ""}
            </span>
          </div>
        ))}
    </div>
  );
}

function InputRowView({
  row,
  history,
  refusal,
  apply,
  nameOf,
  act,
}: {
  row: InputRow;
  history: InputsHistory;
  refusal: string | null;
  apply: (edits: DuctsSheetEdits, meta: EditMeta) => void | Promise<unknown>;
  nameOf: (id: number) => string | null;
  act?: CellAct;
}) {
  const who = row.title ?? row.ids.map((id) => nameOf(id) ?? String(id)).join(", ");
  const c = row.control;
  const was =
    c.kind === "number"
      ? `${row.label} ${who} ${c.value ?? "—"}${c.unit ? ` ${c.unit}` : ""} (${row.source})`
      : `${row.label} ${who} ${c.value} (${row.source})`;
  const meta = (label: string): EditMeta => ({ label, rowKey: row.key, was });
  const name: ReactNode = row.title ? (
    <>
      <span
        className="col-span-4 mt-1 min-w-0 break-words"
        title={`${row.title}: one ruling for every unit of this type`}
      >
        {row.title} <span className="text-ink-2">· {row.label}</span>
      </span>
      <span className="min-w-0 truncate pl-2">
        <SubjectText text={row.subject} revit={row.ids} owner={`inputs:${row.key}`} />
      </span>
    </>
  ) : (
    <span className="min-w-0 truncate">
      <SubjectText text={row.subject} revit={row.ids} owner={`inputs:${row.key}`} />
      <span className="text-ink-2"> · {row.label}</span>
    </span>
  );
  return (
    <div
      className="contents"
      data-input-field={row.key}
      data-input-typed={row.typed ? "" : undefined}
    >
      {name}
      {c.kind === "number" ? (
        <SheetCell
          label={`${row.label} ${c.unit}`}
          value={c.value}
          unit={{ label: c.unit, short: c.unit === "in-wg" ? "wg" : undefined }}
          digits={c.digits}
          source={row.source}
          cell={c.cell as WorkCell}
          refusal={refusal}
          positive={c.positive}
          clearable={row.clear != null}
          onValue={(value) =>
            value == null
              ? row.clear
                ? apply(row.clear, { ...meta(`clear ${row.label} ${who}`), clear: true })
                : undefined
              : apply(c.edit(value), meta(`${row.label} ${who} → ${value} ${c.unit}`))
          }
        />
      ) : c.kind === "kind" ? (
        <>
          <ChoiceCell
            label={`Unit kind of ${who}`}
            options={c.options.map((o) => ({
              key: o.kind,
              label: o.kind,
              description: o.meaning,
              ...(o.disabled ? { disabled: o.disabled } : {}),
            }))}
            current={c.value}
            cell={c.cell}
            path={c.cellKey ? ["kinds", c.cellKey] : null}
            show={(v) => (v as { kind?: string } | null)?.kind ?? "—"}
            refusal={refusal ?? (c.edit ? null : "Wait for the element snapshot")}
            pick={(kind) => {
              if (c.edit && kind !== c.value)
                apply(c.edit(kind as DuctUnitKind), meta(`unit kind ${who} → ${kind}`));
            }}
            act={act}
          />
          <span
            className="t-small min-w-0 truncate text-ink-2"
            data-input-source={row.source}
            title={row.source}
          >
            {row.source}
          </span>
        </>
      ) : (
        <>
          <span className="face-mono text-right">{c.value}</span>
          <span className="t-small min-w-0 truncate text-ink-2" data-input-source={row.source}>
            {row.source}
          </span>
        </>
      )}
      <RowVerb
        rowKey={row.key}
        clear={row.clear}
        history={history}
        refusal={refusal}
        apply={apply}
        label={`${row.label} ${who}`}
        was={was}
      />
      {c.kind === "kind" && (
        // Kind decides role and fan ports (an `other` unit is passive and walked through); the row
        // says what the standing kind does, so the coupling is never silent.
        <span className="col-span-4 pl-2 t-small text-ink-2 break-words" data-kind-meaning="">
          {(() => {
            const standing = c.options.find((o) => o.kind === c.value);
            return standing?.disabled
              ? `stale: ${standing.disabled}; clear it to return to the suggested kind`
              : standing?.meaning;
          })()}
        </span>
      )}
    </div>
  );
}

export function InputsSurface({
  ctx,
  busy,
  onSlot,
  apply,
  history,
  nameOf,
  act,
}: {
  ctx: InputContext;
  busy: boolean;
  elementName: string | null;
  onSlot: (key: "terminalFlow" | "fanFlow", slot: string) => void;
  /** One input edit through the open sheet, recorded for undo with what it was. */
  apply: (edits: DuctsSheetEdits, meta: EditMeta) => void | Promise<unknown>;
  history: InputsHistory;
  nameOf: (id: number) => string | null;
  /** Take or unsuggest a Pea suggestion on a choice's Work cell. */
  act?: CellAct;
}): JSX.Element {
  const [typedOnly, setTypedOnly] = useState(false);
  const fields = inputFields(ctx);
  const refusal = !ctx.sheet ? "Open a fan first" : busy ? "Wait for the current read" : null;
  const criteriaRefusal = refusal ?? (ctx.inputs ? null : "Wait for inputs");
  const changeInputs = (edits: DuctsSheetEdits) =>
    apply(edits, { label: `criteria ${Object.keys(edits.criteria ?? {}).join(", ")}` });
  const groups = fittingGroups(ctx.fittings, ctx.inputs, ctx.tableTitles ?? {});
  const typedCount = fields.rows.filter((r) => r.typed).length;
  const shown = fields.rows.filter(
    (r) => !typedOnly || r.typed || history.cleared?.rowKey === r.key,
  );
  const keys = new Set([...fields.rows.map((r) => r.key), ...groups.map((g) => g.key)]);
  // A cleared ruling leaves the list (Work was its only source); its restore stays offered here.
  const orphan =
    history.cleared && !keys.has(history.cleared.rowKey ?? "") ? history.cleared : null;
  return (
    <section aria-label="Sheet inputs" data-sheet-inputs="" className="flex flex-col gap-3 t-small">
      {refusal && (
        <p className="text-ink-2" role="status">
          {refusal}
        </p>
      )}
      <HistoryLine history={history} refusal={busy ? "Wait for the current read" : null} />
      <section aria-label="Criteria" data-inputs-group="criteria">
        <h3 className="t-head">Criteria</h3>
        {/* The firm file is named by its leaf; the full path is the title, never a wrapped line. */}
        <div className="flex min-w-0 items-baseline gap-1 text-ink-2" data-inputs-firm="">
          {ctx.firm ? (
            <>
              <span className="face-mono shrink-0">{ctx.firm.version}</span>
              <span className="face-mono min-w-0 truncate" title={ctx.firm.path}>
                · {ctx.firm.path.split(/[\\/]/).at(-1)}
              </span>
              {!ctx.firm.present && <span className="shrink-0">· missing, on the seed</span>}
            </>
          ) : (
            "Firm file detail pending"
          )}
        </div>
        {!ctx.inputs && <p className="text-ink-2">{criteriaRefusal}</p>}
        <div className={ROWS}>
          {fields.criteria.map((row) => (
            <div key={row.key} className="contents" data-input-field={row.key}>
              <span className="min-w-0 break-words text-ink-2">{row.label}</span>
              <CriterionControl
                row={row}
                refusal={criteriaRefusal}
                changeInputs={changeInputs}
                cell={ctx.doc?.criteria}
                act={act}
              />
              <span />
            </div>
          ))}
        </div>
      </section>
      <section aria-label="Protocol" data-inputs-group="protocol">
        <h3 className="t-head">Protocol</h3>
        <div className={ROWS}>
          {protocolPickers(ctx).map((p) => (
            <div key={p.key} className="contents" data-protocol-slot={p.key}>
              <span className="min-w-0 truncate text-ink-2">{p.word}</span>
              <ChoiceCell
                label={p.word}
                options={p.options.map((o) => ({
                  key: o.slot,
                  label: o.label,
                  description: `${o.have} of ${o.of} ${p.noun} ${p.where} carry it`,
                }))}
                current={p.current}
                cell={ctx.doc?.parameters[p.key]}
                path={["parameters", p.key]}
                show={(v) => String(v ?? "—")}
                refusal={refusal}
                pick={(slot) => slot !== p.current && onSlot(p.key, slot)}
                act={act}
              />
              <span className="t-small min-w-0 truncate text-ink-2">
                {p.options.find((o) => o.slot === p.current)
                  ? `${p.options.find((o) => o.slot === p.current)!.have}/${p.options.find((o) => o.slot === p.current)!.of}`
                  : ""}
              </span>
              <span />
            </div>
          ))}
        </div>
      </section>
      <section aria-label="Fittings" data-inputs-group="fittings">
        <h3 className="t-head">Fittings</h3>
        <p className="text-ink-2">
          Priced by rule. A table chosen on a rule applies to every fitting that rule matches in the
          document; a family no rule matches is priced as the rule you assign it.
        </p>
        <div className={ROWS}>
          {groups.map((group) => (
            <FittingGroupRows
              key={group.key}
              group={group}
              doc={ctx.doc}
              history={history}
              refusal={refusal}
              apply={apply}
              act={act}
            />
          ))}
          {groups.length === 0 && (
            <p className="col-span-4 text-ink-2">
              {ctx.inputs ? "No fittings on this sheet" : criteriaRefusal}
            </p>
          )}
        </div>
      </section>
      <section aria-label="Inputs" data-inputs-group="inputs">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="t-head">Inputs</h3>
          <Button
            pressed={typedOnly}
            label={typedOnly ? "Show every input" : "Show typed inputs only"}
            onPress={() => setTypedOnly(!typedOnly)}
          >
            typed only ({typedCount})
          </Button>
        </div>
        <p className="text-ink-2">
          Every value this fan reads, with where it comes from. Typing one overrides its source;
          clear returns the source underneath.
        </p>
        {orphan && (
          <p className="flex items-baseline gap-2" data-inputs-orphan="">
            <span className="min-w-0 truncate">cleared {orphan.was}</span>
            <Button
              label={`Restore ${orphan.was}`}
              refusal={refusal}
              onPress={() => history.restore(orphan.press)}
            >
              restore
            </Button>
          </p>
        )}
        {SECTIONS.map((section) => {
          const rows = shown.filter((r) => r.section === section);
          if (!rows.length) return null;
          return (
            <div key={section} data-inputs-section={section}>
              <h4 className="t-small text-ink-2">{SECTION_WORDS[section]}</h4>
              <div className={ROWS}>
                {rows.map((row) => (
                  <InputRowView
                    key={row.key}
                    row={row}
                    history={history}
                    refusal={refusal}
                    apply={apply}
                    nameOf={nameOf}
                    act={act}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {!fields.rows.length && (
          <p className="text-ink-2">{ctx.inputs ? "No inputs on this sheet" : criteriaRefusal}</p>
        )}
        {fields.rows.length > 0 && !shown.length && (
          <p className="text-ink-2">No typed inputs; show every input to type one.</p>
        )}
      </section>
    </section>
  );
}
