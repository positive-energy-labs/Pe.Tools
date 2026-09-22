import { settingsFieldPointer } from "@pe/agent-contracts";
import type { Column } from "#/components/master-table/model";
import { ReadCell } from "#/components/master-table/cells";
import { cellFromTrichotomy, type StateCellProps, stagedText } from "#/components/lang/cell";
import { PressContent } from "#/components/anatomy/press-content";
import { Press } from "#/components/lang/press";
import { NavStateCell } from "#/family/marks";
import { parameterText } from "#/family/family-model";
import {
  MARK_TITLE,
  agreementOf,
  bindingOf,
  draftValueAt,
  isFormula,
  isUnsavedAt,
  proposalCell,
  savedValueAt,
  type PRow,
} from "#/family/model";
import type { FamilyWorkspaceCore } from "#/family/workspace-core";

export function useFamilyTypeColumn(core: FamilyWorkspaceCore) {
  const {
    world,
    draft,
    overlay,
    setOverlay,
    saved,
    setDrillType,
    setStageType,
    proposalsAt,
    locate,
    transitionsAt,
    editOverride,
    editLiteral,
    parse,
  } = core;
  const typeColumn = (
    typeName: string,
    options: { header?: boolean; align?: "right" } = {},
  ): Column<PRow> => ({
    key: `type:${typeName}`,
    label: typeName,
    group: "PROFILE",
    width: "w-28",
    right: options.align === "right",
    header: options.header ? (
      <Press
        type="button"
        onClick={() => {
          setStageType(typeName);
          setDrillType(typeName);
          // The drill-in has its OWN live column and its own per-row crossings, so it is already a
          // two-substrate view. Carrying the overlay in would put Revit's number in two places at
          // once and make the type column read-only for no reason the drill-in explains.
          setOverlay("draft");
        }}
        title={`Drill into "${typeName}". The table pane swaps to the same table, narrowed to this one type and opened up with the spine and the crossing verbs. "← all types" in the pane header, or Esc, comes back.`}
        tone="quiet"
        size="label"
      >
        <PressContent geometry="block">
          {typeName} <span>⤢</span>
        </PressContent>
      </Press>
    ) : undefined,
    title: `What "${typeName}" overrides in the DRAFT. An empty cell INHERITS — the family value shows through as the grey placeholder, which is the only place the family level appears now that it has no column of its own. Typing creates the override; clearing hands the type back to the family. Under the ⇄ live and ⇄ saved overlays this same column shows Revit's number and the disk's number instead, read-only, in place.`,
    cell: (row) => {
      // ── the ghost's ONE merged cell ─────────────────────────────────────────────────────────
      // A frozen literal has no per-type spread, so it gets no per-type cells: it gets one cell
      // the width of all of them, left-aligned like every other value. Table cannot express
      // a colspan, so the anchor column renders it and its neighbours are SUPPRESSED — blank, but
      // blank WITH a reason, which is the same discipline every other refusal on this page keeps.
      if (row.kind === "ghost") {
        const slug = row.slug ?? "";
        const property = row.property ?? "";
        if (typeName !== world.mergeAnchor)
          return (
            <ReadCell
              value=""
              reason={`Suppressed — part of the ONE merged value cell for ${row.name}, which begins in the first type column and spans all of them. There is exactly one literal for the whole family, so it is drawn once. (Table has no spanning cell; this is the honest emulation of one.)`}
            />
          );
        const literal = bindingOf(world, draft, slug, property);
        const diskLiteral = saved.geom[slug]?.[property] ?? null;
        if (overlay === "live")
          return (
            <ReadCell
              value="unread — not a parameter"
              reason={`UNREAD, not absent. Revit's family certainly carries this number — it is in the solid — but a parameter read cannot report it, because it is not a parameter. Nothing here can be compared, and silence is not agreement. Binding it is what makes it readable at all.`}
            />
          );
        if (overlay === "saved")
          return (
            <ReadCell
              value={
                diskLiteral === null ? (
                  "not on disk"
                ) : (
                  <>
                    {diskLiteral}
                    {diskLiteral !== literal && <span className="ml-1">→</span>}
                  </>
                )
              }
              reason={
                diskLiteral === null
                  ? `${row.name} is not in the saved profile at all.`
                  : diskLiteral === literal
                    ? `The file already carries ${diskLiteral} for ${row.name}. Saving would write nothing here.`
                    : `The file carries ${diskLiteral}; saving writes ${literal} over it.`
              }
            />
          );
        // THE EDITABLE CELL (R8, families #6 discharged here): the grammar draws the caution
        // square + bold for the unsaved staged value and carries the refusal itself — returning
        // the reason from `editLiteral` restores the literal and shows the dismissible note,
        // without the row growing a pixel. The route-drawn RefusalNote this replaced is deleted.
        return (
          <NavStateCell
            {...cellFromTrichotomy(
              // A ghost has no proposal — pea cannot argue about a number nothing can reach — so
              // the reader draws it from the staged rung alone, exactly as it draws every other
              // cell. The hand-assembled `stage`/`stagedBy` pair this replaced was the same
              // derivation written a second time.
              proposalCell([], isUnsavedAt(world, draft, saved, row, typeName) ? literal : null),
              { value: literal },
              parameterText,
            )}
            note={`The literal itself, as ONE cell across every type — EDITABLE. Typing here rewrites the number frozen into the geometry; it does not make it reachable. That is what binding is for. Emptying it is refused out loud — a dimension with no number is not a state.${
              isUnsavedAt(world, draft, saved, row, typeName)
                ? ` UNSAVED — the file ${diskLiteral === null ? "does not carry this dimension at all" : `carries ${diskLiteral}`}; saving writes ${literal}.`
                : ""
            }`}
            onCommit={(next) => editLiteral(slug, property, stagedText(next))}
          />
        );
      }

      // ── live-only rows: they exist ONLY under the live overlay, so they only speak there ─────
      if (row.kind === "live-only") {
        const entry = draft.live[row.name]?.[typeName];
        return (
          <ReadCell
            value={entry?.value ?? "—"}
            reason={`${MARK_TITLE["only-live"]} The last read listed "${row.name}" as present in the family but reported no per-type value for it, so there is nothing here to compare — only the fact that the parameter exists and the profile does not claim it.`}
          />
        );
      }

      const authored = draft.authored[row.name] ?? "";
      const proposals = proposalsAt(row.name, typeName);
      const grounded = (world.grounding[row.name] ?? []).length > 0;
      const drifted = agreementOf(world, draft, row, typeName) === "drift";
      const diskValue = savedValueAt(saved, row, typeName);
      const draftValue = draftValueAt(world, draft, row, typeName);
      const unsaved = isUnsavedAt(world, draft, saved, row, typeName);
      const unsavedNote =
        unsaved && overlay === "draft"
          ? ` UNSAVED — ${
              diskValue === null
                ? `"${row.name}" is not in the file at all; saving adds it, resolving to ${draftValue} at ${typeName}.`
                : `the file resolves ${typeName} to ${diskValue}; saving writes ${draftValue}.`
            } The square sits opposite pea's fold so the two marks can never be confused.`
          : "";
      const groundedNote = grounded
        ? ` Grounded in ${(world.grounding[row.name] ?? []).join(", ")} of ${world.spec?.fileName ?? "the spec"}.`
        : "";

      /**
       * THE TRICHOTOMY AT THIS COORDINATE, read ONCE through the shared reader (ruled 2026-08-31)
       * — pea's standing proposal and the draft's unsaved value in, `StateCellProps` out. Every
       * branch below supplies only what is its own: which substrate's number it is showing, the
       * prose that explains it, and whether it can be typed into.
       *
       * The STAGED rung is a draft fact, so it only reads under the draft overlay: under ⇄ live
       * and ⇄ saved the number shown is not the draft's, and a caution square beside it would be
       * pointing at a value that is not there. The proposal FOLD survives every overlay, because
       * a proposal is a fact about the cell rather than about which reading is showing.
       *
       * `onLocate` is the cell's own: click the body and the card comes into the doc sidebar.
       * RESOLVED 2026-08-31 (was TODO(core-reader), critic verdict 14): on an editable cell the
       * input owns the content box, so the locate target IS the padding — and on a proposed cell
       * the padding is the marks. Measured here: 179×19 cell, input inset 10/14/2/3, and a hit
       * test at either the fold corner or the square corner resolves to the cell. The grammar now
       * says so out loud (`data-locate` + the cursor rule in `lang.css`); the "2px strip" the
       * critic measured was `--item-pad-x` on read-only cells, not this one.
       */
      const cell = (facts: StateCellProps) => (
        <NavStateCell
          {...cellFromTrichotomy(
            proposalCell(proposals, overlay === "draft" && unsaved ? draftValue : null),
            facts,
            parameterText,
          )}
          onLocate={proposals[0] ? () => locate(proposals[0]!) : undefined}
          transitions={transitionsAt(
            proposals[0]?.id ?? settingsFieldPointer(["types", typeName, row.name]),
          )}
        />
      );

      // ── ⇄ LIVE: Revit's number, in the cell it is a reading of ──────────────────────────────
      if (overlay === "live") {
        if (world.missingInRevit.has(row.name))
          return cell({
            value: "not in Revit",
            note: `${MARK_TITLE["only-profile"]}${groundedNote}`,
          });
        const entry = draft.live[row.name]?.[typeName];
        if (!entry)
          return cell({
            value: "·",
            note: `${MARK_TITLE.unread} Re-read the family before treating this dot as a match.${groundedNote}`,
          });
        return cell({
          value: entry.value,
          note: drifted
            ? `DRIFT — Revit carries ${entry.value} at ${typeName}; the draft resolves to ${draftValue}. ${MARK_TITLE.drift} Read-only here: editing a live number is not a thing that exists, which is why apply is the write path and its verbs are lit in this overlay.${groundedNote}`
            : `${typeName} — ${entry.value}. ${MARK_TITLE[agreementOf(world, draft, row, typeName)]}${groundedNote}`,
        });
      }

      // ── ⇄ SAVED: the disk's number, and what save would write over it ───────────────────────
      if (overlay === "saved") {
        if (diskValue === null)
          return cell({
            value: "new — not on disk",
            note: `"${row.name}" is not in the saved profile at all: this page created it. Saving adds the whole parameter, and this type will resolve to ${draftValue}.${groundedNote}`,
          });
        const willWrite = diskValue !== draftValue;
        return cell({
          value: (
            <>
              {diskValue || "—"}
              {willWrite && <span className="ml-1">→</span>}
            </>
          ),
          note: willWrite
            ? `The file resolves ${typeName} to ${diskValue || "nothing"}; saving writes ${draftValue} over it. The caution arrow is the direction of that write — it is a warning, not a drift: nothing about Revit is claimed here.${groundedNote}`
            : `The file already resolves ${typeName} to ${diskValue}. Saving writes nothing into this cell.${groundedNote}`,
        });
      }

      // ── DRAFT: the staged document, editable ────────────────────────────────────────────────
      //
      // MIGRATED onto the editable `StateCell` (2026-08-31, proposal-state demiurge). The two
      // reasons this cell stayed on `ProposedCell` + `TextCell` are both closed: the grammar's
      // editable slot HAS a placeholder now, so the inheritance can show through honestly, and
      // the fold LOCATES through the cell's own `onLocate` instead of a button improvised beside
      // it. `ProposedCell` was deleted rather than kept — it had nothing left to say.
      if (isFormula(authored))
        return (
          <ReadCell
            value="ƒ driven"
            reason={`LOCKED — the family level drives this with ${authored}, so a type cannot override its result. The formula is shown on the parameter's own cell; change what feeds it instead. Switch to ⇄ live to see the number Revit computes for it.`}
          />
        );
      const override = draft.types[typeName]?.[row.name];
      const displayUnit = world.live?.units?.[row.name];
      return cell({
        value: override ?? "",
        placeholder: authored,
        note: `${
          proposals.length > 0
            ? `Pea proposes ${proposals[0]!.proposed} here. Accept or deny it on the cell, or type your own value and the proposal is CLEARED on the spot. ${override === undefined ? `Until then the type inherits ${authored || "nothing"}.` : `The type currently overrides with ${override}.`}${groundedNote}`
            : override === undefined
              ? `"${typeName}" inherits ${authored || "nothing"} from the family — the grey number is the inheritance showing through, not a value this type holds. Type here to make it differ.${drifted ? ` The alarm underline says Revit disagrees; switch to ⇄ live to read its number in place.` : ""}${groundedNote}`
              : `"${typeName}" overrides the family value ${authored} with ${override}. Clear the cell to go back to inheriting.${drifted ? ` The alarm underline says Revit disagrees; switch to ⇄ live to read its number in place.` : ""}${groundedNote}`
        }${unsavedNote}`,
        // A family value is written in the unit grammar ("300 CFM"), so the measured kind's answer
        // IS the override: a bare number takes this document's own unit, typed text goes to Revit.
        ...(displayUnit
          ? { measured: { displayUnit, parse: (text: string) => parse(displayUnit, text) } }
          : {}),
        onCommit: (next) => editOverride(row.name, typeName, stagedText(next)),
      });
    },
  });

  // Every column carries a group, including the identity ones. A grouped table renders two
  // header rows; a column WITHOUT a group spans both, and a spanning cell distorts the first
  // row's measured height — which is exactly what the sticky offset is measured from, so the
  // group labels end up hidden under the leaf row. Uniform grouping keeps the two rows honest.
  /* The row's verdict rides the meaning band via the
     narrow tone union — `stateColumn` and its unconstrained CSS-string tone are gone). */
  return typeColumn;
}
