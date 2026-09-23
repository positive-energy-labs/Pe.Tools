import type { Column, TableState } from "#/components/master-table/model";
import { token } from "#/lib/token";
import { PressContent } from "#/components/anatomy/press-content";
import { Press } from "#/components/lang/press";
import {
  authoredText,
  bindingOf,
  isFormula,
  pinnedSort,
  sortDirOf,
  type PRow,
} from "#/family/model";
import type { FamilyWorkspaceCore } from "#/family/workspace-core";

export function useFamilyIdentityColumns(core: FamilyWorkspaceCore) {
  const { world, draft, setInspect, proposalsAt, proposalsOn, locate, consumers } = core;
  /**
   * THE VERDICT RAIL — a COUNT, not a control (ruled 2026-08-31, per-cell grounding). It used to
   * carry a 24px pea icon-press inside a 20px row, which was the locate affordance improvised
   * where the grammar had none. The grammar has one now: locate is the cell's own `onLocate`, so
   * the rail went back to what a rail is — one glance down the table saying WHERE pea has read,
   * readable without reading a single value, and deciding nothing.
   */
  const railColumn = (): Column<PRow> => ({
    key: "rail",
    label: "",
    // THE GROUP ROW CARRIES ONLY WHAT THE COLUMN ROW CANNOT (2026-08-31). The group label read
    // "PARAMETER" over columns already labelled "parameter" and "state" — the word said nothing
    // the leaf labels did not. The group is kept (every column must carry one: an ungrouped
    // column spans both header rows and distorts the measured height the sticky offset comes
    // from) but its LABEL is empty, so the identity block is grouped by its rule and named by its
    // leaves. "PROFILE" over the type columns stays: nothing at the leaf level says the three
    // type columns are one document.
    group: "",
    width: "w-6",
    title:
      "The proposal rail — the page's answer to 'where has pea read', readable top to bottom without reading a single value. A dot means one proposal on this row; a number means several. It decides nothing and locates nothing: click the CELL that wears the fold to bring its card into the sidebar, because that is the cell the proposal is about.",
    cell: (row) => {
      const standing = proposalsOn(row.name);
      if (standing.length === 0) return null;
      const where = standing
        .map(
          (entry) =>
            `${entry.typeName ?? "family value"}: ${entry.current ?? "—"} → ${entry.proposed}`,
        )
        .join(" · ");
      return (
        <span
          className="flex h-(--item-h) items-center justify-center t-small face-mono"
          data-tone="pea"
          title={
            standing.length === 1
              ? `One proposal standing on ${row.name} — ${where}. Click the cell that wears the fold to bring its card into the doc sidebar, where accept and deny sit beside the spec text.`
              : `${standing.length} proposals standing on ${row.name}, at different types — ${where}. The row is contested more than once; the folds in the cells say WHICH cells, and clicking one brings its card into view.`
          }
        >
          {standing.length > 1 ? standing.length : "●"}
        </span>
      );
    },
  });

  /**
   * The parameter's identity — and, since the family-value COLUMN is gone, the only place the
   * family level shows itself: a formula renders as a second line here, and a family-level
   * proposal wears its fold here. That is honest about where the value lives, where a fourth
   * value column pretending to be a fourth type was not.
   */
  const identityColumn = (state: TableState): Column<PRow> => ({
    key: "param",
    label: "parameter",
    group: "",
    width: "w-64",
    // Sorting NEVER lifts a ghost above a parameter — the rank rides in front of the name. See
    // pinnedSort: this is an emulation of a row-pinning primitive Table does not have.
    sort: (row) => pinnedSort(row, row.name, sortDirOf(state, "param")),
    search: (row) => `${row.name} ${row.dataType} ${row.group}`,
    title:
      "One row per parameter — the unit of the whole page. The marks after the name are the tight facts: instance binding, whether Revit has it at all, and which spec block grounds it. The second line carries the family level: a formula, and the geometry properties this parameter DRIVES. Click the name to open it in the inspector, where its family value is edited.",
    cell: (row) => {
      // GHOST — not a parameter, and it must never be mistakable for one. Muted, italic, named in
      // the geometry's vocabulary (slug.property, not Title Case). Its literal lives OUT of this
      // cell, in a single merged cell across the type columns, which is the honest shape of "one
      // number, no per-type spread".
      if (row.kind === "ghost") {
        const slug = row.slug ?? "";
        const property = row.property ?? "";
        const literal = bindingOf(world, draft, slug, property);
        const dim = world.geomBySlug.get(slug)?.dims.find((entry) => entry.property === property);
        return (
          <span className="flex h-(--item-h) min-w-0 items-center px-(--item-pad-x)">
            <Press
              type="button"
              onClick={() => setInspect({ kind: "part", slug })}
              // Row-specific facts only; what a geom row IS lives on the table's HelpTip.
              title={`${slug}.${property} — a bindable ${row.dataType} dimension that no parameter drives; it is ${literal} for every type. ${dim?.note ?? ""} Click to open ${slug} in the inspector.`}
              tone="quiet"
              size="caption"
            >
              <PressContent geometry="block">
                {row.name}
                <span className="ml-1">geom</span>
              </PressContent>
            </Press>
          </span>
        );
      }

      const authored = authoredText(draft.authored[row.name]) ?? "";
      const blocks = world.grounding[row.name] ?? [];
      const family = proposalsAt(row.name, null);
      const drives = consumers.get(row.name) ?? [];
      const reason = `${row.name} — ${row.dataType}, bound per ${
        row.isInstance
          ? "instance (a placed element may depart from it; the family still authors a default per type, which is what the type columns hold)"
          : "type"
      }.${isFormula(authored) ? ` Driven by the family-level formula ${authored}, so no type can override its result.` : ""}${
        world.missingInRevit.has(row.name)
          ? " ⊘ — the live family has no parameter by this name; apply moves values, not schema."
          : ""
      }${
        blocks.length > 0
          ? ` Grounded in ${blocks.join(", ")} of ${world.spec?.fileName ?? "the spec"} — hover the row to light it in the sidebar.`
          : " Ungrounded: nothing in the spec claims this number."
      }${family.length > 0 ? ` Pea proposes a FAMILY-LEVEL value here: ${family[0]!.current ?? "—"} → ${family[0]!.proposed}. Click this cell to bring the card into the sidebar; accepting it moves every type that does not override.` : ""}${
        drives.length > 0
          ? ` Drives ${drives.map((entry) => `${entry.slug}.${entry.property}`).join(", ")} — this row IS those dimensions, which is why they have no rows of their own.`
          : row.kind === "profile"
            ? " No direct form or connector dimension binding. Other declarations and formulas may still use this parameter."
            : ""
      }`;
      // TODO(core-reader): a FAMILY-LEVEL proposal has no value cell of its own — the family-value
      // column is gone, and this identity cell is two lines, so it cannot be a row-scale
      // `StateCell`. It therefore draws the fold and takes the locate click itself, with the
      // grammar's own guard (a click on an inner Press belongs to that Press). The reader has no
      // way to hand `StateCellProps` to a non-`StateCell` cell; that is the gap.
      return (
        <span
          className="flex min-h-(--item-h) w-full items-center"
          style={family[0] ? { boxShadow: `inset 0 -1.5px 0 0 ${token("pea")}` } : undefined}
          onClick={
            family[0]
              ? (event) => {
                  if ((event.target as HTMLElement).closest("input,button") != null) return;
                  locate(family[0]!);
                }
              : undefined
          }
        >
          <span className="min-w-0 flex-1 px-(--item-pad-x)" title={reason}>
            <span>
              {row.kind === "live-only" ? (
                <span>{row.name}</span>
              ) : (
                <Press
                  type="button"
                  onClick={() => setInspect({ kind: "param", name: row.name })}
                  title={`Open ${row.name} in the inspector below the spec — where its FAMILY-LEVEL value is edited, along with its formula, its consumers, and its citation. The type columns on this row only ever hold overrides; the value they inherit lives there.`}
                  tone="nav"
                >
                  {row.name}
                </Press>
              )}
              {row.isInstance && <span className="ml-1">inst</span>}
              {world.missingInRevit.has(row.name) && <span className="ml-1">⊘</span>}
              {blocks.length > 0 && <span className="ml-1">{blocks.join(" ")}</span>}
            </span>
            {/* The family level, on ONE line: the formula, and what the parameter DRIVES. A bound
                geometry dim has no row of its own — it is represented by this parameter — so this
                mark is the only place the representation is visible. Several consumers join here,
                and that join is the point: editing this row moves all of them at once.

                DERIVED SPENDS NO COLOUR: the language has no role for "a formula
                computed this", and the leading `=` already says it. Italic carries the rest. */}
            {(isFormula(authored) || drives.length > 0) && (
              <span>
                {isFormula(authored) && <span>{authored}</span>}
                {isFormula(authored) && drives.length > 0 && <span> · </span>}
                {drives.length > 0 && <span>→ </span>}
                {drives.map((entry, index) => (
                  <Press
                    key={`${entry.slug}.${entry.property}`}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setInspect({ kind: "part", slug: entry.slug })}
                    title={`${row.name} drives ${entry.slug}.${entry.property}. Click to open ${entry.slug} in the inspector — its non-bindable metadata (direction, system type, where its frame sits) lives there, because no parameter can drive those.`}
                    tone="quiet"
                  >
                    {index > 0 && <span>, </span>}
                    {entry.slug}.{entry.property}
                  </Press>
                ))}
              </span>
            )}
          </span>
        </span>
      );
    },
  });

  /** One type's overrides. Identical in the cross-type table and in the drill-in — except
   * alignment: the drill-in right-aligns this column so the profile's number and Revit's meet
   * at the spine and the eye reads one diff, not two lists. */
  return { railColumn, identityColumn };
}
