import type { Column } from "#/components/master-table/model";
import { ReadCell, TextCell } from "#/components/master-table/cells";
import { Press } from "#/components/lang/press";
import { NavStateCell, ProposedCell } from "#/family/marks";
import {
  MARK_TITLE,
  agreementOf,
  bindingOf,
  draftValueAt,
  isFormula,
  isUnsavedAt,
  savedValueAt,
  type PRow,
} from "#/family/model";
import { cn } from "#/lib/utils";
import type { FamilyWorkspaceCore } from "#/family/workspace-core";
import { PressContent } from "#/components/anatomy/press-content";

export function useFamilyTypeColumn(core: FamilyWorkspaceCore) {
  const {
    world,
    draft,
    overlay,
    setOverlay,
    saved,
    setDrillType,
    stageType,
    setStageType,
    proposalsAt,
    locate,
    editOverride,
    editLiteral,
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
    /* The column on stage is lit by a FILL, never a hue — `--pe-select` is literally the ground
       ladder's selection rung, so the law cannot be broken here by accident. */
    headerClassName: options.header && stageType === typeName ? "bg-select" : undefined,
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
          {typeName} <span className="opacity-60">⤢</span>
        </PressContent>
      </Press>
    ) : undefined,
    title: `What "${typeName}" overrides in the DRAFT. An empty cell INHERITS — the family value shows through as the grey placeholder, which is the only place the family level appears now that it has no column of its own. Typing creates the override; clearing hands the type back to the family. Under the ⇄ live and ⇄ saved overlays this same column shows Revit's number and the disk's number instead, read-only, in place.`,
    cell: (row) => {
      // ── the ghost's ONE merged cell ─────────────────────────────────────────────────────────
      // A frozen literal has no per-type spread, so it gets no per-type cells: it gets one cell
      // the width of all of them, left-aligned like every other value. MasterTable cannot express
      // a colspan, so the anchor column renders it and its neighbours are SUPPRESSED — blank, but
      // blank WITH a reason, which is the same discipline every other refusal on this page keeps.
      if (row.kind === "ghost") {
        const slug = row.slug ?? "";
        const property = row.property ?? "";
        if (typeName !== world.mergeAnchor)
          return (
            <ReadCell
              value=""
              reason={`Suppressed — part of the ONE merged value cell for ${row.name}, which begins in the first type column and spans all of them. There is exactly one literal for the whole family, so it is drawn once. (MasterTable has no spanning cell; this is the honest emulation of one.)`}
            />
          );
        const literal = bindingOf(world, draft, slug, property);
        const diskLiteral = saved.geom[slug]?.[property] ?? null;
        if (overlay === "live")
          return (
            <ReadCell
              className="text-ink-mute"
              value="unread — not a parameter"
              reason={`UNREAD, not absent. Revit's family certainly carries this number — it is in the solid — but a parameter read cannot report it, because it is not a parameter. Nothing here can be compared, and silence is not agreement. Binding it is what makes it readable at all.`}
            />
          );
        if (overlay === "saved")
          return (
            <ReadCell
              className={cn(
                diskLiteral === null
                  ? "italic text-caution"
                  : diskLiteral !== literal
                    ? "text-caution"
                    : "text-ink-2",
              )}
              value={
                diskLiteral === null ? (
                  "not on disk"
                ) : (
                  <>
                    {diskLiteral}
                    {diskLiteral !== literal && <span className="ml-1 text-caution">→</span>}
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
            value={literal}
            stage={isUnsavedAt(world, draft, saved, row, typeName) ? "staged" : "clean"}
            stagedBy="you"
            note={`The literal itself, as ONE cell across every type — EDITABLE. Typing here rewrites the number frozen into the geometry; it does not make it reachable. That is what binding is for. Emptying it is refused out loud — a dimension with no number is not a state.${
              isUnsavedAt(world, draft, saved, row, typeName)
                ? ` UNSAVED — the file ${diskLiteral === null ? "does not carry this dimension at all" : `carries ${diskLiteral}`}; saving writes ${literal}.`
                : ""
            }`}
            onCommit={(next) => editLiteral(slug, property, next)}
          />
        );
      }

      // ── live-only rows: they exist ONLY under the live overlay, so they only speak there ─────
      if (row.kind === "live-only") {
        const entry = draft.live[row.name]?.[typeName];
        return (
          <ReadCell
            className="text-ink-mute"
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
      // The two marks that are facts about the CELL rather than about the reading, so they are
      // applied identically in all three overlays. ONE DECORATION SLOT, RANKED — the language's
      // squiggle law: drift outranks the citation, because a cell that is both is more urgently
      // the first. The citation spends no meaning colour; it is a hairline.
      const underline = drifted
        ? "underline decoration-alarm decoration-dotted underline-offset-[3px]"
        : grounded
          ? "underline decoration-line-2 decoration-dotted underline-offset-[3px]"
          : undefined;
      const groundedNote = grounded
        ? ` Grounded in ${(world.grounding[row.name] ?? []).join(", ")} of ${world.spec?.fileName ?? "the spec"} — the hairline underline is that citation, and it stays put in every overlay unless drift outranks it.`
        : "";

      const marks = (inner: React.ReactNode) => (
        <ProposedCell
          proposals={proposals}
          onLocate={locate}
          where={`${row.name} at ${typeName}`}
          unsaved={
            overlay === "draft" && unsaved
              ? `UNSAVED — ${
                  diskValue === null
                    ? `"${row.name}" is not in the file at all; saving adds it, resolving to ${draftValue} at ${typeName}.`
                    : `the file resolves ${typeName} to ${diskValue}; saving writes ${draftValue}.`
                } The square sits opposite pea's fold so the two marks can never be confused.`
              : null
          }
        >
          {inner}
        </ProposedCell>
      );

      // ── ⇄ LIVE: Revit's number, in the cell it is a reading of ──────────────────────────────
      if (overlay === "live") {
        if (world.missingInRevit.has(row.name))
          return marks(
            <ReadCell
              className={cn("italic text-caution", underline)}
              value="not in Revit"
              reason={`${MARK_TITLE["only-profile"]}${groundedNote}`}
            />,
          );
        const entry = draft.live[row.name]?.[typeName];
        if (!entry)
          return marks(
            <ReadCell
              className={cn("text-ink-mute", underline)}
              value="·"
              reason={`${MARK_TITLE.unread} Re-read the family before treating this dot as a match.${groundedNote}`}
            />,
          );
        return marks(
          <ReadCell
            className={cn(
              drifted && "text-alarm",
              entry.readOnly && "italic text-ink-2",
              underline,
            )}
            value={entry.value}
            reason={
              drifted
                ? `DRIFT — Revit carries ${entry.value} at ${typeName}; the draft resolves to ${draftValue}. ${MARK_TITLE.drift} Read-only here: editing a live number is not a thing that exists, which is why apply is the write path and its verbs are lit in this overlay.${groundedNote}`
                : `${typeName} — ${entry.value}. ${MARK_TITLE[agreementOf(world, draft, row, typeName)]}${groundedNote}`
            }
          />,
        );
      }

      // ── ⇄ SAVED: the disk's number, and what save would write over it ───────────────────────
      if (overlay === "saved") {
        if (diskValue === null)
          return marks(
            <ReadCell
              className={cn("italic text-caution", underline)}
              value="new — not on disk"
              reason={`"${row.name}" is not in the saved profile at all: this page created it. Saving adds the whole parameter, and this type will resolve to ${draftValue}.${groundedNote}`}
            />,
          );
        const willWrite = diskValue !== draftValue;
        return marks(
          <ReadCell
            className={cn(willWrite ? "text-caution" : "text-ink-2", underline)}
            value={
              <>
                {diskValue || "—"}
                {willWrite && <span className="ml-1">→</span>}
              </>
            }
            reason={
              willWrite
                ? `The file resolves ${typeName} to ${diskValue || "nothing"}; saving writes ${draftValue} over it. The caution arrow is the direction of that write — it is a warning, not a drift: nothing about Revit is claimed here.${groundedNote}`
                : `The file already resolves ${typeName} to ${diskValue}. Saving writes nothing into this cell.${groundedNote}`
            }
          />,
        );
      }

      // ── DRAFT: the staged document, editable ────────────────────────────────────────────────
      //
      // NOT migrated onto the editable `StateCell` (adoption pass 2026-08-16, findings #13/#14):
      // an override-less type cell shows the FAMILY value as a placeholder — the inheritance
      // showing through, not a value the type holds — and the grammar's editable slot has no
      // placeholder, so an empty `StateCell` here would claim "no value" where the cell resolves
      // to the authored one. The fold also LOCATES here (the notch is a button); `StateCell`'s
      // fold is CSS. Both stay honest on `ProposedCell` + `TextCell` until the axes can say them.
      if (isFormula(authored))
        return (
          <ReadCell
            className={cn("italic text-ink-2", options.align === "right" && "text-right")}
            value="ƒ driven"
            reason={`LOCKED — the family level drives this with ${authored}, so a type cannot override its result. The formula is shown on the parameter's own cell; change what feeds it instead. Switch to ⇄ live to see the number Revit computes for it.`}
          />
        );
      const override = draft.types[typeName]?.[row.name];
      return marks(
        <TextCell
          value={override ?? ""}
          placeholder={authored}
          className={cn(
            "placeholder:text-ink-mute",
            proposals.length > 0 && "text-pea-ink",
            options.align === "right" && "text-right",
            underline,
          )}
          title={
            proposals.length > 0
              ? `Pea proposes ${proposals[0]!.proposed} here — but this cell is ORDINARY. Type your own value and the proposal is severed on the spot: no accept, no deny, the card settles to "superseded by your edit". ${override === undefined ? `Until then the type inherits ${authored || "nothing"}.` : `The type currently overrides with ${override}.`}${groundedNote}`
              : override === undefined
                ? `"${typeName}" inherits ${authored || "nothing"} from the family — the grey number is the inheritance showing through, not a value this type holds. Type here to make it differ.${drifted ? ` The alarm underline says Revit disagrees; switch to ⇄ live to read its number in place.` : ""}${groundedNote}`
                : `"${typeName}" overrides the family value ${authored} with ${override}. Clear the cell to go back to inheriting.${drifted ? ` The alarm underline says Revit disagrees; switch to ⇄ live to read its number in place.` : ""}${groundedNote}`
          }
          onCommit={(next) => editOverride(row.name, typeName, next)}
        />,
      );
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
