import type { Column, MasterTableState } from "#/components/master-table/model";
import { ReadCell } from "#/components/master-table/cells";
import { PressContent } from "#/components/anatomy/press-content";
import { Press } from "#/components/lang/press";
import { ProposedCell } from "#/family/marks";
import { bindingOf, isFormula, pinnedSort, sortDirOf, type PRow } from "#/family/model";
import type { FamilyWorkspaceCore } from "#/family/workspace-core";

export function useFamilyIdentityColumns(core: FamilyWorkspaceCore) {
  const { world, draft, setInspect, verdictOf, proposalsAt, proposalsOn, locate, consumers } = core;
  const railColumn = (): Column<PRow> => ({
    key: "rail",
    label: "",
    group: "PARAMETER",
    width: "w-6",
    title:
      "The verdict rail — the page's answer to 'where do proposals live', readable top to bottom without reading a single value. A dot means one proposal on this row; a counted chip means several. Clicking either LOCATES them in the sidebar; it never decides anything, because a verdict belongs next to the spec text that justifies it.",
    cell: (row) => {
      const open = proposalsOn(row.name);
      const accepted = world.proposals.filter(
        (entry) => entry.param === row.name && verdictOf(entry.id) === "accepted",
      );
      if (open.length === 0)
        return accepted.length > 0 ? (
          <ReadCell
            value="✓"
            reason="Every proposal on this row is settled, and at least one was accepted — the value is in the profile, and its citation is still live in the sidebar."
          />
        ) : null;

      const where = open
        .map(
          (entry) =>
            `${entry.typeName ?? "family value"}: ${entry.current ?? "—"} → ${entry.proposed}`,
        )
        .join(" · ");
      return (
        <span className="flex h-7 items-center justify-center">
          <Press
            type="button"
            onClick={() => locate(open[0]!)}
            size={open.length === 1 ? "icon" : "caption"}
            tone="agent"
            aria-label={`locate ${open.length} proposal(s) on ${row.name}`}
            title={
              open.length === 1
                ? `One open proposal on ${row.name} — ${where}. Click to bring its card into view in the doc sidebar, where accept and deny sit beside the spec text. Nothing pops over the table.`
                : `${open.length} open proposals on ${row.name}, at different types — ${where}. The row is contested more than once; the corner folds in the cells say WHICH cells. Click to bring the cards into view.`
            }
            /* Pea's identity, never the commit colour: a MARK takes `--pe-pea` (the display rung),
               a counted chip is text and takes pea's ink. */
          >
            {open.length > 1 ? open.length : null}
          </Press>
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
  const identityColumn = (state: MasterTableState): Column<PRow> => ({
    key: "param",
    label: "parameter",
    group: "PARAMETER",
    width: "w-64",
    // Sorting NEVER lifts a ghost above a parameter — the rank rides in front of the name. See
    // pinnedSort: this is an emulation of a row-pinning primitive MasterTable does not have.
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
          <span className="flex h-7 min-w-0 items-center px-1.5">
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

      const authored = draft.authored[row.name] ?? "";
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
      }${family.length > 0 ? ` Pea proposes a FAMILY-LEVEL value here: ${family[0]!.current ?? "—"} → ${family[0]!.proposed}. Accepting it moves every type that does not override.` : ""}${
        drives.length > 0
          ? ` Drives ${drives.map((entry) => `${entry.slug}.${entry.property}`).join(", ")} — this row IS those dimensions, which is why they have no rows of their own.`
          : row.kind === "profile"
            ? " Drives no geometry the profile declares — it is schedule data, or it is dead."
            : ""
      }`;
      return (
        <ProposedCell
          proposals={family}
          onLocate={locate}
          where={`the family value of ${row.name}`}
        >
          <span className="min-w-0 flex-1 px-1.5" title={reason}>
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
        </ProposedCell>
      );
    },
  });

  /** One type's overrides. Identical in the cross-type table and in the drill-in — except
   * alignment: the drill-in right-aligns this column so the profile's number and Revit's meet
   * at the spine and the eye reads one diff, not two lists. */
  return { railColumn, identityColumn };
}
