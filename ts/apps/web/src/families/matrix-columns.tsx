import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  familyCellAddress,
  familyCellKey,
  showFamilyCell,
  type FamilyCellState,
  type FamilyCellValue,
  type MeasuredDisplayUnit,
} from "@pe/agent-contracts";
import { reviewTransitions, type CellWire } from "#/components/lang/band";
import { ReadCell } from "#/components/master-table/cells";
import { useCellNavigation } from "#/components/master-table/cell-navigation";
import {
  cellFromTrichotomy,
  StateCell,
  type CellRefusal,
  type CellTransition,
} from "#/components/lang/cell";
import type { MeasuredAnswer } from "#/host/measured-parse";
import { CellListSelect } from "#/components/lang/list-popup";
import { Press } from "#/components/lang/press";
import type { FamilyParameterSnapshot } from "#/host/loaded-families-view";
import type { FamiliesStore } from "#/families/store";
import { cn } from "#/lib/utils";

export interface TypeRow {
  key: string;
  familyId: number;
  familyName: string;
  categoryName: string;
  typeName: string;
  typeCount: number;
  values: Record<string, string>;
  scopes: Record<string, FamilyParameterSnapshot["scope"]>;
  formulas: Record<string, FamilyParameterSnapshot["formulaState"]>;
  storageTypes: Record<string, FamilyCellValue["storageType"] | undefined>;
  displayUnits?: Record<string, MeasuredDisplayUnit | null>;
  yesNos?: Record<string, boolean>;
}

export interface ParamColumn {
  key: string;
  name: string;
  kind: FamilyParameterSnapshot["kind"];
  isInstance: boolean;
  isBuiltIn: boolean;
  isProjectOnly: boolean;
  familyCount: number;
  /** A Yes/No parameter: a closed choice, never free text. */
  yesNo?: boolean;
  /**
   * That the parameter measures something, and the unit the PROJECT renders it in (the matrix reads
   * the project, so the project's units are what these cells show and stage).
   */
  displayUnit?: MeasuredDisplayUnit | null;
}

/** Revit's Yes/No spec (`autodesk.spec:spec.bool-1.0.0`), read off the definition's data type. */
export const isYesNo = (dataTypeId: string | null | undefined) =>
  dataTypeId?.startsWith("autodesk.spec:spec.bool") === true;

const YES_NO = ["Yes", "No"] as const;
const unitLock = (unit: MeasuredDisplayUnit | null | undefined): string | null =>
  unit && (!unit.typeId || unit.refusal)
    ? (unit.refusal ??
      "Revit did not report this measured parameter's display unit, so this cell cannot be staged.")
    : null;

/**
 * Whether a patch can express a change to this cell — the one thing that decides if it is editable.
 * A patch writes `types.<typeName>.<parameter>` on the family document, so an unresolved parameter
 * (not on this family), a project binding (the value lives on instances, not in the family) and a
 * formula-driven parameter (the family computes it) are all outside what a patch can say.
 */
function patchable(row: TypeRow, key: string): boolean {
  const scope = row.scopes[key];
  const storageType = row.storageTypes[key];
  return (
    Boolean(scope) &&
    (storageType === "String" || storageType === "Integer" || storageType === "Double") &&
    scope !== "Unresolved" &&
    scope !== "ProjectBindingOnly" &&
    row.formulas[key] !== "Present"
  );
}

/**
 * The families lock facts: a cell a patch cannot write (unresolved, project-bound, formula-driven)
 * is locked, and its reason is the one the matrix already says. Unknown addresses are not locked.
 */
export const familiesLockOf =
  (rows: readonly TypeRow[], params: readonly ParamColumn[]) =>
  (key: string): string | null => {
    const { familyName, typeName, parameter } = familyCellAddress(key);
    const row = rows.find((r) => r.familyName === familyName && r.typeName === typeName);
    const param = params.find((p) => p.name === parameter);
    if (!row || !param) return null;
    if (!patchable(row, param.key)) return cellReason(row, param.key, param.isInstance);
    return unitLock(row.displayUnits ? row.displayUnits[param.key] : param.displayUnit);
  };

/** What a cell's value MEANS — the title text, so a read-only cell still explains itself. */
function cellReason(row: TypeRow, key: string, instance: boolean): string {
  const scope = row.scopes[key];
  if (!scope || scope === "Unresolved")
    return "This parameter does not exist on this family, so there is nothing to read and nothing a profile could change here.";
  if (scope === "ProjectBindingOnly")
    return "Bound at the PROJECT, not owned by the family. The value lives on placed instances; editing the family will not move it.";
  if (row.formulas[key] === "Present")
    return "Driven by a formula inside the family — the number shown is what the formula resolved to for this type, not an authored value.";
  if (row.storageTypes[key] === "ElementId")
    return "This value refers to a Revit element. A typed name or ID cannot safely select that element here.";
  if (!row.storageTypes[key] || row.storageTypes[key] === "None")
    return "This parameter has no declared writable storage type.";
  const what = instance
    ? `the INSTANCE DEFAULT this type hands every instance placed from it`
    : `this type's authored value`;
  const observed = row.values[key] ? ` — ${row.values[key]}` : " — blank";
  return `Type "${row.typeName}" of ${row.familyName}: ${what}${observed} currently. Type to stage your value; Pea's proposal waits for stage or deny in Review edits. Plan generates the spec from staged values only.`;
}

/**
 * A drawn pivot cell subscribes to its Work key. A Work change redraws the affected cells without
 * rebuilding the type grid's row and column windows.
 */
export interface LiveCells {
  cells: Record<string, FamilyCellState>;
  wire: CellWire;
  listeners: Set<() => void>;
}

export function useLiveCells(cells: Record<string, FamilyCellState>, wire: CellWire): LiveCells {
  const live = useRef<LiveCells>({ cells, wire, listeners: new Set() }).current;
  live.cells = cells;
  live.wire = wire;
  useLayoutEffect(() => {
    for (const notify of live.listeners) notify();
  }, [live, cells, wire]);
  return live;
}

function useCellAt(live: LiveCells, key: string): FamilyCellState | undefined {
  return useSyncExternalStore(
    (notify) => {
      live.listeners.add(notify);
      return () => void live.listeners.delete(notify);
    },
    () => live.cells[key],
  );
}

/** One parameter cell: subscribed to its own key, so a Work change redraws it and nothing else. */
export function ParamCell({
  row,
  col,
  live,
  propose,
  parse,
}: {
  row: TypeRow;
  col: ParamColumn;
  live: LiveCells;
  propose: FamiliesStore["actions"]["propose"];
  parse?: (unit: MeasuredDisplayUnit | null | undefined, text: string) => Promise<MeasuredAnswer>;
}) {
  // Identity by NAME (ruling, msg-authority-family-identity): a cell keys on the family's
  // name, never its element id, which Revit reissues on every reload.
  const address = { familyName: row.familyName, typeName: row.typeName, parameter: col.name };
  const key = familyCellKey(address);
  const cell = useCellAt(live, key);
  const scopeOf = row.scopes[col.key];
  const value = row.values[col.key] ?? "";
  const unresolved = !scopeOf || scopeOf === "Unresolved";
  const reason = cellReason(row, col.key, col.isInstance);
  // Every drawn trichotomy cell carries exactly the contract's transitions. A Pea proposal
  // on a cell a patch cannot write draws locked, where the contract leaves deny only.
  const transitions = cell ? reviewTransitions(live.wire, key, cell) : undefined;
  const yesNo = row.yesNos ? row.yesNos[col.key] : col.yesNo;
  const displayUnit = row.displayUnits ? row.displayUnits[col.key] : col.displayUnit;
  const noUnit = unitLock(displayUnit);
  if (patchable(row, col.key) && noUnit)
    return (
      <ProposalCell
        current={value}
        reason={reason}
        cell={cell}
        transitions={transitions}
        lock={noUnit}
      />
    );
  if (patchable(row, col.key) && yesNo) {
    return (
      <YesNoCell
        name={col.name}
        current={value}
        cell={cell}
        reason={reason}
        onPick={(choice) =>
          propose(address, { value: choice, storageType: row.storageTypes[col.key]! }, value)
        }
      />
    );
  }
  if (patchable(row, col.key)) {
    return (
      <ProposalCell
        current={value}
        reason={reason}
        cell={cell}
        transitions={transitions}
        // A refused write puts the cell back and says why on it (25 item 3).
        measured={
          displayUnit && parse
            ? {
                displayUnit,
                parse: (text) => parse(displayUnit, text),
              }
            : undefined
        }
        onCommit={(next) => {
          const storageType = row.storageTypes[col.key]!;
          if (next.unit === undefined && storageType !== "String") {
            const text = next.value.trim();
            const number = Number(text);
            const valid =
              storageType === "Integer"
                ? /^[+-]?\d+$/.test(text) &&
                  Number.isInteger(number) &&
                  number >= -2147483648 &&
                  number <= 2147483647
                : text !== "" && Number.isFinite(number);
            if (!valid)
              return Promise.resolve({
                message:
                  storageType === "Integer"
                    ? "Enter a whole number within the Revit integer range."
                    : "Enter a finite number.",
              });
          }
          return propose(address, { ...next, storageType }, value).then(
            (refusal) => refusal ?? null,
          );
        }}
      />
    );
  }
  if (cell?.proposal != null || cell?.staged != null)
    return (
      <ProposalCell
        current={value}
        reason={reason}
        cell={cell}
        transitions={transitions}
        lock={reason}
      />
    );
  return (
    <ReadCell
      value={unresolved ? "" : value || "—"}
      reason={reason}
      /* A project binding and a formula are FACTS about where a value lives, not
                 alarms — they get quiet ink and spend no meaning role. Formula-driven was
                 `--cat-lichen`, a TAXONOMY colour carrying a value fact; the language has no
                 "derived" role to move it to, so it drops to the ink ladder
                 and separates from a project binding by italic rather than by hue. */
      className={cn(
        scopeOf === "ProjectBindingOnly" && "italic text-ink-mute",
        row.formulas[col.key] === "Present" && "text-ink-2",
      )}
      data-tone={value === "Positive Energy" ? "pea" : undefined}
    />
  );
}

/** A Yes/No parameter is a closed choice; its Work refusal stays on the same cell. */
function YesNoCell({
  name,
  current,
  cell,
  reason,
  onPick,
}: {
  name: string;
  current: string;
  cell: FamilyCellState | undefined;
  reason: string;
  onPick: (choice: string) => ReturnType<FamiliesStore["actions"]["propose"]>;
}) {
  const [refused, setRefused] = useState<string | undefined>();
  const rung = cell?.staged ?? cell?.proposal;
  const shown = rung ? showFamilyCell(rung.value) : current;
  return (
    <span className="relative block w-full min-w-0">
      <CellListSelect<string>
        aria-label={`${name} (Yes/No)`}
        value={shown}
        invalid={refused != null}
        display={
          <StateCell
            {...cellFromTrichotomy(
              cell ?? { proposal: null, staged: null },
              { value: shown, currentValue: current || "(blank)", note: reason, scale: "row" },
              showFamilyCell,
            )}
          />
        }
        title={`${name} is Yes/No: pick Yes or No`}
        items={[...YES_NO]}
        keyOf={(choice) => choice}
        labelOf={(choice) => choice}
        row={(choice) => ({ label: choice })}
        select="single"
        selected={[shown]}
        empty="no choices"
        onPick={(choice) => {
          void onPick(choice)
            .then((refusal) => setRefused(refusal?.message))
            .catch((error: unknown) =>
              setRefused(error instanceof Error ? error.message : String(error)),
            );
        }}
      />
      {refused ? (
        <span
          className="absolute inset-y-px right-px z-5 flex max-w-[75%] items-center overflow-hidden px-1"
          data-tone="caution"
          data-wash=""
        >
          <Press
            type="button"
            tone="neutral"
            size="caption"
            hover="bare"
            title={`${refused} — click to dismiss`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setRefused(undefined)}
          >
            <span className="truncate italic" data-tone="caution">
              {refused}
            </span>
          </Press>
        </span>
      ) : null}
    </span>
  );
}

/**
 * One editable parameter cell in the house proposal language: the proposal on the cell is the
 * trichotomy's `proposal` (Pea's or a person's, told apart by `by`) and the person's accept is
 * its `staged`, read through the one reader `cellFromTrichotomy`. At row scale the prior value and
 * the author ride the title; accept and deny sit in Review edits beside the table.
 */
function ProposalCell({
  current,
  reason,
  cell,
  transitions,
  lock,
  onCommit,
  measured,
}: {
  current: string;
  reason: string;
  cell: FamilyCellState | undefined;
  /** The cell's own verbs: exactly `availableTransitions`, over the families wire. */
  transitions?: readonly CellTransition[];
  /** Why a patch cannot write this cell; present, the cell draws locked and takes no typing. */
  lock?: string;
  /** Resolves to the write's refusal, if any: the kit then restores the drawn value and says it. */
  onCommit?: (value: Omit<FamilyCellValue, "storageType">) => Promise<CellRefusal | null>;
  /**
   * The measured kind, minus its staging door: what Revit answered stages as `{ value, unit }`
   * through the same `onCommit` as typed text, and the patch carries that object.
   */
  measured?: { displayUnit: MeasuredDisplayUnit; parse: (text: string) => Promise<MeasuredAnswer> };
}) {
  const move = useCellNavigation();
  const proposal = cell?.proposal;
  const staged = cell?.staged;
  const stagedText = staged ? showFamilyCell(staged.value) : undefined;
  const proposedText = proposal ? showFamilyCell(proposal.value) : undefined;
  const shown = stagedText ?? proposedText ?? current;
  const note = proposal
    ? `Pea proposed ${current || "(blank)"} → ${proposedText}${
        stagedText === proposedText
          ? "; staged — plan will include it"
          : staged
            ? `; you staged ${stagedText}, so Pea's value is a counter-proposal`
            : "; open — accept (a) or deny (d) it on this cell"
      }. Nothing has reached Revit.`
    : staged
      ? `You staged ${current || "(blank)"} → ${stagedText}. Nothing has reached Revit.`
      : reason;
  return (
    <span data-proposal={proposal ? "pea" : undefined} data-staged={staged ? "" : undefined}>
      <StateCell
        {...cellFromTrichotomy(
          cell ?? { proposal: null, staged: null },
          { value: shown, currentValue: current || "(blank)", note, scale: "row" },
          showFamilyCell,
        )}
        cap={lock ? "locked" : "editable"}
        capReason={lock}
        transitions={transitions}
        placeholder={proposal || staged ? current : undefined}
        {...(lock || !onCommit
          ? {}
          : measured
            ? { measured: { ...measured, stage: onCommit } }
            : { onCommit: (text: string) => onCommit({ value: text }) })}
        onNavigate={(direction) => move?.(direction) ?? false}
      />
    </span>
  );
}
