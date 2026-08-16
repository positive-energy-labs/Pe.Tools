/**
 * THE MATRIX — /family's content surface: parameters × types, and geometry × types beneath it.
 *
 * TYPE MATRIX: one row per authored parameter, one column per type, plus the definition
 * columns (identity, formula) and — in the authored lane only — the family-level default every
 * type inherits. Each value cell is field-state aware: it consults route:settings by JSON
 * Pointer, so a pea proposal (dashed pe-blue), a staged edit (lichen — the settings
 * trichotomy's own vocabulary for "pending, not written"), and an attention mark (clay, and
 * clay alone blocks the save) all render in place. Both tables carry ONE header row: the type
 * on stage is the tinted column, and clicking its header is the same act as the toolbar tab.
 *
 * ONE COLUMN OF NUMBERS, ONE EDGE. Values are right-aligned and never displaced; the ✓/✕, the
 * ¶N citation badge, and the review dot live in a hover/focus overlay at the cell's left edge.
 * See `CellValue`.
 *
 * GEOMETRY TABLE: the same columns over the authored constituents, READ-ONLY. A geometry cell
 * is a view of whatever the constituent references; the parameter row above is where it is
 * edited, and "—" means the reference resolves to nothing rather than to zero.
 *
 * FOCUS: hovering a parameter label lights that parameter everywhere; hovering a VALUE cell
 * additionally names the type, which is what narrows the doc pane's citations to that one
 * cell's sources. Highlights are asked of `#/family/focus` — this module compares no ids.
 *
 * ponytail: sibling table, not a row group. MasterTable has no row-group seam and inventing
 * one for a second consumer would be the wrong surgery; cut the real seam in MasterTable when
 * a third consumer appears.
 */
import { useMemo, useState } from "react";

import type { SettingsProposalSource } from "@pe/agent-contracts";
import { settingsFieldPointer } from "@pe/agent-contracts";

import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import { EditableValue } from "#/family/editable";
import { focusHitsCell, focusHitsConstituent, focusHitsParam, type Focus } from "#/family/focus";
import { authoredFormulaParams, validateFormula, type FormulaProblem } from "#/family/formula";
import { geometryRows, type GeometryRow } from "#/family/geometry-rows";
import {
  addType,
  setOverride,
  setParamFormula,
  setParamValue,
  type FamilyModel,
  type ParamSpec,
  type Update,
} from "#/family/model";
import type { FieldState } from "#/family/store";
import { cn } from "#/lib/utils";

/** The quiet hit vocabulary — a wash on the row. The 0.3-opacity dim stays the drawing's alone. */
const HIT_ROW = "bg-[var(--pe-blue)]/5";

export interface CiteContext {
  label: string;
  sources: SettingsProposalSource[];
}

interface TypeMatrixRow {
  key: string;
  origin: string;
  section: "familyParameters" | "sharedParameters";
  name: string;
  spec: ParamSpec;
}

export function TypeMatrix({
  model,
  typeName,
  onType,
  update,
  fields,
  laneKind,
  advisory,
  onFormulaCheck,
  onCite,
  onPin,
  onReview,
  onReviewMark,
  selectedParam,
  onSelectParam,
  focus,
  onFocus,
}: {
  model: FamilyModel;
  typeName: string;
  onType: (name: string) => void;
  update: Update;
  fields: Record<string, FieldState>;
  laneKind: "authored" | "live";
  /** LIVE lane: the host's own dryRun verdict for one parameter's formula, or null. */
  advisory: (name: string) => string | null;
  /** LIVE lane: ask the host to dry-run a committed formula. No-op in the authored lane. */
  onFormulaCheck: (name: string, formula: string) => void;
  onCite: (context: CiteContext | null) => void;
  onPin: (context: CiteContext | null) => void;
  onReview: (pointer: string, action: "approve" | "deny") => void;
  onReviewMark: (pointer: string, next: ReviewMarkState) => void;
  selectedParam: string | null;
  onSelectParam: (name: string | null) => void;
  focus: Focus;
  onFocus: (focus: Focus) => void;
}) {
  const [newType, setNewType] = useState("");
  const typeNames = useMemo(() => Object.keys(model.types), [model.types]);
  const groups = useMemo<Array<[string, Record<string, ParamSpec>]>>(
    () => [
      ...groupParameters("family", model.familyParameters),
      ...(model.sharedParameters ? groupParameters("shared", model.sharedParameters) : []),
    ],
    [model.familyParameters, model.sharedParameters],
  );
  const rows = useMemo<TypeMatrixRow[]>(
    () =>
      groups.flatMap(([origin, specs]) =>
        Object.entries(specs).map(([name, spec]) => ({
          key: `${origin}:${name}`,
          origin,
          section: origin.startsWith("shared") ? "sharedParameters" : "familyParameters",
          name,
          spec,
        })),
      ),
    [groups],
  );
  // ONE parameter source for every formula cell in the matrix — the authored model.
  const formulaParams = useMemo(
    () => authoredFormulaParams(model.familyParameters, model.sharedParameters),
    [model.familyParameters, model.sharedParameters],
  );

  const columns = useMemo<Column<TypeMatrixRow>[]>(() => {
    const definition: Column<TypeMatrixRow>[] = [
      {
        key: "parameter",
        label: "parameter",
        width: "min-w-52",
        sort: (row) => row.name,
        facet: (row) => row.origin,
        search: (row) => `${row.name} ${row.origin}`,
        all: "any group",
        title:
          "Every parameter this family owns. Family-owned is the quiet default; shared parameters carry a marker line. Each row's tooltip names its Revit properties group.",
        cell: (row) => {
          const pinned = selectedParam === row.name;
          return (
            <div className="px-1.5">
              {row.origin.startsWith("shared") && (
                <span className="tele-label block truncate text-[9px] text-muted-foreground">
                  {row.origin}
                </span>
              )}
              <button
                type="button"
                onClick={() => onSelectParam(pinned ? null : row.name)}
                title={
                  pinned
                    ? `${row.name} is PINNED: the drawing, its chips, and the spec pane stay on it while the pointer moves. Click to unpin (Esc also steps back through the pins).`
                    : `${row.name} is a ${row.spec.dataType}${row.spec.isInstance ? " bound per instance" : ""}. Click to pin it — the inspector opens and every surface holds the highlight.`
                }
                className={cn(
                  "max-w-full truncate text-left",
                  pinned ? "font-semibold text-[var(--pe-blue)]" : "hover:text-[var(--pe-blue)]",
                )}
              >
                {row.name}
              </button>
              {row.spec.formula != null && <span className="tele ml-1 text-[var(--kiln)]">ƒ</span>}
            </div>
          );
        },
      },
      {
        key: "formula",
        label: "= formula",
        width: "min-w-40",
        search: (row) => row.spec.formula ?? "",
        title:
          "A formula is first-class: authoring one locks the value cells because a parameter holds a value or a formula, never both.",
        cell: (row) => (
          <div className="flex h-7 items-center px-1.5">
            <FormulaCell
              paramName={row.name}
              formula={row.spec.formula}
              readOnly={row.spec.readOnly === true}
              hasTypeValues={typeNames.some((type) => model.types[type]?.[row.name] != null)}
              cell={cellField(fields, [row.section, row.name, "formula"])}
              params={formulaParams}
              advisory={advisory(row.name)}
              onCommit={(next) => {
                update((current) => setParamFormula(current, row.name, next));
                onFormulaCheck(row.name, next);
              }}
              onReviewMark={onReviewMark}
            />
          </div>
        ),
      },
    ];

    const familyValue: Column<TypeMatrixRow>[] =
      laneKind === "authored"
        ? [
            {
              key: "family-value",
              label: "family value",
              right: true,
              width: "min-w-28",
              title:
                "The family-level default. Every type inherits it unless that type overrides it.",
              cell: (row) => (
                <div className="group/cell relative flex h-7 items-center justify-end px-1.5 text-right">
                  {row.spec.formula != null ? (
                    <span
                      className="tele text-[var(--kiln)]/60"
                      title={`${row.name} carries a formula; clear it before authoring a family value.`}
                    >
                      locked
                    </span>
                  ) : (
                    <CellValue
                      value={row.spec.value ?? "—"}
                      cell={cellField(fields, [row.section, row.name, "value"])}
                      label={`${row.name} · family value`}
                      onCommit={(next) =>
                        update((current) => setParamValue(current, row.name, next))
                      }
                      onCite={onCite}
                      onPin={onPin}
                      onReview={onReview}
                      onReviewMark={onReviewMark}
                    />
                  )}
                </div>
              ),
            },
          ]
        : [];

    const typeValues: Column<TypeMatrixRow>[] = typeNames.map((name) => {
      const overrides = Object.keys(model.types[name] ?? {}).length;
      const selected = name === typeName;
      return {
        key: `type:${name}`,
        label: name,
        right: true,
        width: "min-w-28",
        /* The type on stage is tinted in the header too, so the toolbar's choice and the
           column it lights are visibly the same fact. */
        headerClassName: selected ? "bg-[var(--pe-blue)]/[0.08]" : undefined,
        header: (
          <button
            type="button"
            onClick={() => onType(name)}
            title={
              selected
                ? `"${name}" is the type on stage: the drawing, every card chip, and every geometry cell resolve as it. It overrides ${overrides} parameter${overrides === 1 ? "" : "s"}; everything else inherits.`
                : `Resolve the drawing, every card chip, and every geometry cell as "${name}" — clicking this header switches the type on stage, exactly like the toolbar tabs. It overrides ${overrides} parameter${overrides === 1 ? "" : "s"}; everything else inherits.`
            }
            className={selected ? "text-[var(--pe-blue)]" : "text-[var(--clay-ink)]"}
          >
            {name}
            <span className="ml-1 font-normal text-[var(--slate)]">
              {overrides > 0 ? overrides : "∅"}
            </span>
          </button>
        ),
        cell: (row) => {
          const override = model.types[name]?.[row.name];
          /* Two washes, deliberately different weights: the flexed type's column is a faint
             standing tint (where you are), the focused cell is the stronger one (what is
             under the pointer or pinned). */
          const tint = cn(
            selected && "bg-[var(--pe-blue)]/[0.04]",
            focusHitsCell(focus, model, row.name, name) && "bg-[var(--pe-blue)]/[0.11]",
          );
          const box = cn(
            "group/cell relative flex h-7 items-center justify-end px-1.5 text-right",
            tint,
          );
          const hover = {
            onMouseEnter: () => onFocus({ kind: "param", name: row.name, typeName: name }),
            onMouseLeave: () => onFocus({ kind: "param", name: row.name }),
          };
          if (row.spec.formula != null)
            return (
              <div
                className={box}
                {...hover}
                title={`Computed from ${row.name}'s formula for this type, not authored.`}
              >
                <span className="tele text-[var(--kiln)]/60">
                  {row.spec.resolvedValues?.[name] ?? "locked"}
                </span>
              </div>
            );
          if (row.spec.readOnly)
            return (
              <div
                className={box}
                {...hover}
                title={`Revit reports ${row.name} read-only on this family, so this value can be seen but never written from here.`}
              >
                <span className="tele text-[var(--slate)]/60">{override ?? "—"}</span>
              </div>
            );

          const cell = cellField(fields, ["types", name, row.name]);
          return (
            <div className={box} {...hover}>
              {override != null ? (
                /* The × sits LEFT of the value and shows on hover, so the value's right edge
                 * never moves — the number column stays tabular whether or not a drop
                 * affordance exists. */
                <span className="inline-flex items-center gap-1">
                  {laneKind === "authored" && (
                    <button
                      type="button"
                      title={`Drop this type's override of "${row.name}" so it inherits the family value again.`}
                      className="text-[var(--slate)] opacity-0 transition-opacity focus-visible:opacity-100 group-hover/cell:opacity-100 hover:text-[var(--clay)]"
                      onClick={() =>
                        update((current) => setOverride(current, name, row.name, null))
                      }
                    >
                      ×
                    </button>
                  )}
                  <CellValue
                    value={override}
                    cell={cell}
                    label={`${row.name} · ${name}`}
                    onCommit={(next) =>
                      update((current) => setOverride(current, name, row.name, next))
                    }
                    onCite={onCite}
                    onPin={onPin}
                    onReview={onReview}
                    onReviewMark={onReviewMark}
                    strong
                  />
                </span>
              ) : cell.proposal != null ? (
                <CellValue
                  value={
                    typeof cell.proposal.value === "string"
                      ? cell.proposal.value
                      : JSON.stringify(cell.proposal.value) || "—"
                  }
                  cell={cell}
                  label={`${row.name} · ${name}`}
                  onCommit={(next) =>
                    update((current) => setOverride(current, name, row.name, next))
                  }
                  onCite={onCite}
                  onPin={onPin}
                  onReview={onReview}
                  onReviewMark={onReviewMark}
                />
              ) : (
                <button
                  type="button"
                  title={`Inherited: "${name}" follows the family value for ${row.name}. Click to give this type an override.`}
                  className="tele rounded-[2px] border border-dashed border-transparent px-0.5 text-[var(--slate)]/70 hover:border-[var(--line-2)]"
                  onClick={() =>
                    update((current) => setOverride(current, name, row.name, row.spec.value ?? ""))
                  }
                >
                  {row.spec.value ?? "—"}
                </button>
              )}
            </div>
          );
        },
      };
    });

    return [...definition, ...familyValue, ...typeValues];
  }, [
    advisory,
    fields,
    focus,
    formulaParams,
    laneKind,
    model,
    onCite,
    onFocus,
    onFormulaCheck,
    onPin,
    onReview,
    onReviewMark,
    onSelectParam,
    onType,
    selectedParam,
    typeName,
    typeNames,
    update,
  ]);

  return (
    <div className="flex size-full min-h-0 flex-col">
      <MasterTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        scopeLabel="parameters"
        searchPlaceholder="find parameter…"
        summary={`${rows.length} parameters · ${typeNames.length} types`}
        empty={
          laneKind === "live"
            ? "This family exposes no editable parameters — Revit reported none on the open family. Press refresh above if you have just added some in the family editor."
            : "This document declares no parameters yet. Add them under familyParameters, or ask pea to draft them from the spec sheet in the pane on the right."
        }
        activeKey={rows.find((row) => row.name === selectedParam)?.key ?? null}
        onRowClick={(row) => onSelectParam(row.name === selectedParam ? null : row.name)}
        rowClassName={(row) => (focusHitsParam(focus, model, row.name) ? HIT_ROW : undefined)}
        onRowHover={(row) => onFocus(row ? { kind: "param", name: row.name } : null)}
      />
      {/* Adding a type authors the DOCUMENT; the live lane edits an open family, whose type
          roster is Revit's to change. */}
      {laneKind === "authored" && (
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--line-soft)] px-2 py-1.5">
          <input
            value={newType}
            onChange={(event) => setNewType(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && newType.trim()) {
                update((current) => addType(current, newType.trim()));
                setNewType("");
              }
            }}
            placeholder="new type name…"
            title="Add a type to this family. It starts with no overrides, so it inherits every family value until you override one — and an empty type is kept, never pruned."
            className="tele h-6 w-40 rounded-[2px] border border-[var(--line-2)] bg-transparent px-1.5 outline-none focus:border-[var(--pe-blue)]"
          />
          <span className="text-xs text-muted-foreground">
            Enter adds an empty type — empty types stay visible and preserved, by design.
          </span>
        </div>
      )}
    </div>
  );
}

// ── the geometry half ───────────────────────────────────────────────────────────────────────────

export function GeometryTable({
  model,
  typeName,
  focus,
  onFocus,
  onPinConstituent,
}: {
  model: FamilyModel;
  typeName: string;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  onPinConstituent: (id: string) => void;
}) {
  const rows = useMemo(() => geometryRows(model), [model]);
  const typeNames = useMemo(() => Object.keys(model.types), [model.types]);

  const columns = useMemo<Column<GeometryRow>[]>(() => {
    const definition: Column<GeometryRow>[] = [
      {
        key: "constituent",
        label: "constituent",
        width: "min-w-52",
        sort: (row) => `${row.label} ${row.field}`,
        facet: (row) => row.origin,
        search: (row) => `${row.label} ${row.field} ${row.origin}`,
        all: "any constituent kind",
        title:
          "Every authored dimension in the model, one row per constituent field. These are drawings, not parameters — the value shown is whatever the reference beside it resolves to for that type. The kind of constituent is the filter above, not a second line on every row.",
        cell: (row) => (
          <div className="flex h-7 items-center px-1.5">
            <button
              type="button"
              onClick={() => onPinConstituent(row.id)}
              title={`${row.label} · ${row.field} — a ${row.origin}. Click to hold the focus on this constituent: the drawing, its card, and every parameter it reads light up together and stay lit while the pointer moves.`}
              className="tele max-w-full truncate text-left hover:text-[var(--pe-blue)]"
            >
              {row.label} <span className="text-[var(--slate)]">· {row.field}</span>
            </button>
          </div>
        ),
      },
      {
        key: "authored",
        label: "authored",
        width: "min-w-40",
        search: (row) => row.authored,
        title:
          "What this dimension is authored AGAINST: the parameter it reads, or a portable literal when no parameter drives it. It is the only editable truth behind the resolved columns, and it is edited in the register card or the parameter row — never here.",
        cell: (row) => (
          <div className="flex h-7 items-center px-1.5">
            <span
              className="tele truncate text-[var(--slate)]"
              title={`Authored verbatim as "${row.authored}".`}
            >
              {row.authored.replace(/^param:/, "")}
            </span>
          </div>
        ),
      },
    ];

    const perType: Column<GeometryRow>[] = typeNames.map((name) => ({
      key: `type:${name}`,
      label: name,
      right: true,
      width: "min-w-28",
      headerClassName: name === typeName ? "bg-[var(--pe-blue)]/[0.08]" : undefined,
      title: `What this dimension resolves to for type "${name}", formula-resolved values included. Read-only: "—" means the reference resolves to nothing, which is not the same as zero.`,
      cell: (row) => (
        <div
          className={cn(
            "flex h-7 items-center justify-end px-1.5 text-right",
            name === typeName && "bg-[var(--pe-blue)]/[0.04]",
          )}
        >
          <span className="tele text-[var(--slate)]">{row.resolve(name)}</span>
        </div>
      ),
    }));

    return [...definition, ...perType];
  }, [onPinConstituent, typeName, typeNames]);

  return (
    <div className="flex size-full min-h-0 flex-col">
      <MasterTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        scopeLabel="geometry"
        searchPlaceholder="find dimension…"
        summary={`${rows.length} dimensions · read-only`}
        empty="This document authors no solids, connectors, planes, or arrays yet — capture a real family, or add them to the JSON, and the drawing above fills in with them."
        rowClassName={(row) => (focusHitsConstituent(focus, model, row.id) ? HIT_ROW : undefined)}
        onRowHover={(row) => onFocus(row ? { kind: "constituent", id: row.id } : null)}
      />
    </div>
  );
}

// ── field decoration ────────────────────────────────────────────────────────────────────────────

function groupParameters(
  origin: string,
  specs: Record<string, ParamSpec>,
): Array<[string, Record<string, ParamSpec>]> {
  const grouped = new Map<string, Record<string, ParamSpec>>();
  for (const [name, spec] of Object.entries(specs)) {
    const label = spec.propertiesGroup?.trim() || "Other";
    grouped.set(label, { ...grouped.get(label), [name]: spec });
  }
  return [...grouped].map(([label, entries]) => [`${origin} · ${label}`, entries]);
}

/** One matrix cell's field decorations, derived from route:settings field state. */
export function cellField(fields: Record<string, FieldState>, segments: string[]) {
  const pointer = settingsFieldPointer(segments);
  const field = fields[pointer];
  const staged = field?.staged != null;
  const proposal = !staged && field?.proposal != null ? field.proposal : null;
  const sources = (proposal?.sources ?? []) as SettingsProposalSource[];
  return { pointer, field, staged, proposal, sources, attention: field?.review === "attention" };
}

/**
 * A value cell with trichotomy decoration: staged (lichen), open proposal (dashed pe-blue),
 * attention (clay). HOVER grounds the citation in the doc pane; CLICKING the citation badge
 * PINS it there (Esc steps back out).
 *
 * THE NUMBER NEVER MOVES. A column of values is read by scanning it, so nothing may push a
 * value sideways: the value is the cell's only static content, right-aligned, and every
 * affordance it carries — the ¶N citation badge, the review dot, ✓/✕ on an open proposal —
 * lives in an overlay pinned to the cell's LEFT edge, revealed on hover or keyboard
 * focus-within over a backdrop. State is therefore signalled by COLOUR and BORDER alone
 * (dashed pe-blue = proposed, lichen = staged, clay = flagged), never by width.
 *
 * The overlay positions against the cell box, which is why every box wrapping a CellValue
 * carries `group/cell relative`.
 */
function CellValue({
  value,
  cell,
  label,
  onCommit,
  onCite,
  onPin,
  onReview,
  onReviewMark,
  strong,
}: {
  value: string;
  cell: ReturnType<typeof cellField>;
  label: string;
  onCommit: (next: string) => void;
  onCite: (context: CiteContext | null) => void;
  onPin: (context: CiteContext | null) => void;
  onReview: (pointer: string, action: "approve" | "deny") => void;
  onReviewMark: (pointer: string, next: ReviewMarkState) => void;
  strong?: boolean;
}) {
  /* Colour budget: clay is the alarm and nothing else wears it, so a flagged cell is the one
     thing on the page asking for a human. Lichen carries STAGED (pending, not done); green is
     reserved for what actually landed, which only the save receipt can claim. */
  const tone = cell.attention
    ? "text-[var(--clay)]"
    : cell.staged
      ? "text-[var(--lichen)] font-semibold"
      : cell.proposal
        ? "text-[var(--pe-blue)]"
        : strong
          ? "text-[var(--pe-blue)] font-semibold"
          : "";
  const wrap = cell.proposal
    ? "rounded-[2px] border border-dashed border-[var(--pe-blue)] bg-[var(--pe-blue)]/5 px-0.5"
    : cell.staged
      ? "rounded-[2px] border border-[var(--lichen)]/60 bg-[var(--lichen)]/5 px-0.5"
      : "";
  return (
    <span
      className={cn("inline-flex h-7 items-center", wrap)}
      onMouseEnter={() =>
        cell.sources.length > 0
          ? onCite({ label: `${label} → ${value}`, sources: cell.sources })
          : null
      }
      onMouseLeave={() => (cell.sources.length > 0 ? onCite(null) : null)}
    >
      <EditableValue
        value={value}
        title={
          cell.staged
            ? `${label} — edited but NOT written yet. It lives in staging until you save; discard throws it away.`
            : cell.proposal
              ? `${label} — pea proposed this value and is waiting on you. Accept (✓) stages it, reject (✕) drops it; typing over it counts as accepting your own version.${cell.proposal.note ? ` Pea's reasoning: ${cell.proposal.note}` : ""}`
              : `${label} — click to edit. Edits stage first and are never written straight through.`
        }
        onCommit={onCommit}
        className={cn("tele", tone)}
      />
      {/* The affordance overlay: off to the left, over a backdrop, and out of the value's way.
          `focus-within` is what keeps ✓/✕ reachable by keyboard — they are transparent, never
          hidden, so they stay in the tab order and reveal themselves when focused. */}
      <span className="absolute inset-y-0 left-0 z-10 flex items-center gap-1 rounded-[2px] bg-background/90 px-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/cell:opacity-100">
        {cell.sources.length > 0 && (
          <button
            type="button"
            className="tele text-[10px] text-[var(--pe-blue)] hover:font-bold"
            title={`This value is traceable to ${cell.sources.length} region${cell.sources.length === 1 ? "" : "s"} of the spec document. Hovering the cell already highlights them in the pane; click to PIN that highlight so it survives the pointer leaving, and press Esc to unpin.`}
            onClick={() => onPin({ label: `${label} → ${value}`, sources: cell.sources })}
          >
            ¶{cell.sources.length}
          </button>
        )}
        <ReviewMark
          review={reviewState(cell.field)}
          onCycle={(next) => onReviewMark(cell.pointer, next)}
        />
        {cell.proposal && (
          <>
            <button
              type="button"
              title="Accept pea's proposal: stage this value as if you had typed it. Staging is not saving — it still has to pass the save gate."
              className="text-[var(--lichen)] hover:font-bold"
              onClick={() => onReview(cell.pointer, "approve")}
            >
              ✓
            </button>
            <button
              type="button"
              title="Reject pea's proposal and clear it from this cell. The current value is left exactly as it is."
              className="text-[var(--slate)] hover:text-[var(--clay)]"
              onClick={() => onReview(cell.pointer, "deny")}
            >
              ✕
            </button>
          </>
        )}
      </span>
    </span>
  );
}

/* ── review mark: an orthogonal per-field tri-state, cycled by one click ──────────────────────── */

export type ReviewMarkState = "none" | "good" | "attention";

const NEXT_REVIEW: Record<ReviewMarkState, ReviewMarkState> = {
  none: "good",
  good: "attention",
  attention: "none",
};

function reviewState(field: FieldState | undefined): ReviewMarkState {
  return field?.review === "good" || field?.review === "attention" ? field.review : "none";
}

/** none → good → attention → none. A human edit auto-writes "good"; this demotes it. */
function ReviewMark({
  review,
  onCycle,
}: {
  review: ReviewMarkState;
  onCycle: (next: ReviewMarkState) => void;
}) {
  const cycle = () => onCycle(NEXT_REVIEW[review]);
  if (review === "none")
    return (
      <button
        type="button"
        title="Unreviewed. Click to mark this field as checked by a human — your own edits mark themselves, so this is for values you inherited or accepted from pea."
        onClick={cycle}
        className="size-2 shrink-0 rounded-full border border-[var(--line-2)] opacity-60 transition-opacity hover:opacity-100 focus:opacity-100"
      />
    );
  const good = review === "good";
  return (
    <button
      type="button"
      title={
        good
          ? "Reviewed and accepted. Click to flag it instead — a flagged field BLOCKS the save until it is resolved, which is how you park a doubtful value without losing it."
          : "Flagged for attention, and this alone is enough to block the save. Click to clear the flag once you have settled the value."
      }
      onClick={cycle}
      className="tele grid size-3 shrink-0 place-items-center rounded-full text-[8px] font-bold"
      style={{
        background: good
          ? "color-mix(in srgb, var(--lichen) 24%, transparent)"
          : "color-mix(in srgb, var(--clay) 24%, transparent)",
        color: good ? "var(--lichen)" : "var(--clay)",
      }}
    >
      {good ? "✓" : "!"}
    </button>
  );
}

/* ── the formula as a first-class cell ───────────────────────────────────────────────────────── */

/**
 * A formula-backed parameter's per-type value cells are locked (an authoring-time error in the
 * schema), but its FORMULA is always editable — this is the only cell that can lift the lock.
 * Client validation is ADVISORY: invalid-ref, cycle (with the draft spliced into the graph),
 * and type-refs-instance render as a clay dot whose tooltip carries the problem text. Nothing
 * here blocks staging; the host's validate/save is the final word.
 *
 * In the LIVE lane the same dot also carries the host's verdict: committing a formula fires
 * `family.editor.apply {dryRun:true}` for that one edit and the message comes back as
 * `advisory`. Advisory means advisory — it never blocks staging either.
 */
function FormulaCell({
  paramName,
  formula,
  readOnly,
  hasTypeValues,
  cell,
  params,
  advisory,
  onCommit,
  onReviewMark,
}: {
  paramName: string;
  formula: string | undefined;
  readOnly?: boolean;
  hasTypeValues: boolean;
  cell: ReturnType<typeof cellField>;
  params: ReturnType<typeof authoredFormulaParams>;
  advisory: string | null;
  onCommit: (next: string) => void;
  onReviewMark: (pointer: string, next: ReviewMarkState) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = formula ?? "";
  const problems: FormulaProblem[] = useMemo(() => {
    const subject = draft ?? text;
    const found = subject.trim() ? validateFormula({ paramName, draft: subject, params }) : [];
    const extra: FormulaProblem[] = [];
    if (subject.trim() && hasTypeValues)
      extra.push({
        kind: "invalid-ref",
        message: `"${paramName}" still carries per-type values — a formula-driven parameter cannot, so the host will reject one of them`,
      });
    if (advisory) extra.push({ kind: "invalid-ref", message: `Revit: ${advisory}` });
    return [...found, ...extra];
  }, [draft, text, paramName, params, hasTypeValues, advisory]);

  if (readOnly)
    return (
      <span
        className="tele text-[var(--slate)]/50"
        title="Revit reports this parameter read-only, so it accepts no formula. Editing it here would only produce a refusal at apply time."
      >
        {formula ? `= ${formula}` : "—"}
      </span>
    );

  const tone = cell.staged
    ? "text-[var(--lichen)] font-semibold"
    : formula
      ? "text-[var(--kiln)]"
      : "text-[var(--slate)]/50";

  return (
    <span className="inline-flex items-center gap-1">
      {draft == null ? (
        <button
          type="button"
          title={
            formula
              ? `${paramName} is driven by this formula, which is why its per-type value cells are locked. This cell is the only one that can lift that lock — clear the formula and the values become editable again.`
              : `${paramName} has no formula. Author one here and every type inherits the computed value; the per-type cells lock, because a parameter carries a value or a formula, never both.`
          }
          onClick={() => setDraft(text)}
          className={cn("tele cursor-text rounded-[2px] px-0.5 hover:bg-[var(--kiln)]/10", tone)}
        >
          {formula ? `= ${formula}` : "= …"}
        </button>
      ) : (
        <input
          autoFocus
          value={draft}
          size={Math.max(8, draft.length)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft.trim() !== text.trim()) onCommit(draft);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(null);
          }}
          placeholder="Width + 2in"
          title="Author a formula for this parameter. Validation is advisory — an invalid draft still stages, and the dot beside the cell says why it is doubtful."
          className="tele h-7 border-0 bg-transparent px-0.5 outline-none focus:bg-[var(--pe-blue)]/5"
        />
      )}
      {/* The client validator's problems and the host's own dryRun verdict share ONE mark,
          because both are advisory and neither blocks staging. */}
      {problems.length > 0 && (
        <span
          className="size-1.5 shrink-0 rounded-full bg-[var(--clay)]"
          title={`${problems.length} problem${problems.length === 1 ? "" : "s"} with this formula. Advisory only — it will still stage, and Revit's own validate/save is the final word:\n\n${problems.map((problem) => `· ${problem.message}`).join("\n")}`}
        />
      )}
      {(formula != null || cell.staged) && (
        <ReviewMark
          review={reviewState(cell.field)}
          onCycle={(next) => onReviewMark(cell.pointer, next)}
        />
      )}
    </span>
  );
}
