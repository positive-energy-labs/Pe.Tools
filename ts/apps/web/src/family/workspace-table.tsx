import { EmptyState } from "#/components/lang/empty";
import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { Switcher } from "#/components/lang/switcher";
import { ActionButton } from "#/components/lang/action-button";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { Pane } from "#/components/lang/pane";
import { BuildStrip, BUILD_ACTION, buildOutputPath } from "#/family/build";
import { OVERLAY_LABEL, OVERLAY_TITLE, type PRow } from "#/family/model";
import { useFamilyWorkspace } from "#/family/workspace-context";
import { cn } from "#/lib/utils";

export function FamilyWorkspaceTable() {
  const {
    store,
    lane,
    world,
    overlay,
    setOverlay,
    tableState,
    setTableState,
    drillState,
    setDrillState,
    drillType,
    setDrillType,
    setFocus,
    focusedParts,
    focusedParams,
    pinnedParam,
    rows,
    ghostCount,
    driftCells,
    unsavedCount,
    openProposals,
    captureAll,
    capturing,
    armedBuild,
    building,
    buildFacts,
    buildOutcome,
    columns,
    firstGhostKey,
    drillColumns,
  } = useFamilyWorkspace();
  const captureRefusal = store.handle.actions.capture.refusal;
  const prepareBuildRefusal = store.handle.actions["prepare-build"].refusal;

  const rowTint = (row: PRow) => {
    const focused =
      row.kind === "ghost"
        ? focusedParts.has(row.slug ?? "")
        : focusedParams.has(row.name) || pinnedParam === row.name;
    return cn(
      // TODO(design): Keep the directional caution gradient until data-tone wash can express it.
      row.kind === "ghost" && "caution-wash-artifact",
      row.key === firstGhostKey && "[&>td]:hairline-t-2",
      // TODO(design): Keep on-select until the selection state selector also propagates --pe-on.
      focused && "on-select",
    );
  };

  // A ghost row's focus is its CONSTITUENT — it has no parameter to light, and lighting nothing
  // would make the bottom of the table feel disconnected from the drawing it came out of.
  const hoverRow = (row: PRow | null) =>
    setFocus(
      row == null
        ? null
        : row.kind === "ghost"
          ? { kind: "part", id: row.slug ?? "" }
          : { kind: "param", id: row.name },
    );

  const tableModes = !drillType ? (
    <Switcher
      ariaLabel="value overlay"
      value={overlay}
      onChange={setOverlay}
      options={(["draft", "live", "saved"] as const).map((choice) => ({
        value: choice,
        label: OVERLAY_LABEL[choice],
        title: OVERLAY_TITLE[choice],
      }))}
    />
  ) : undefined;

  const tableActions = drillType ? (
    <>
      <ActionButton
        label="all types"
        tone="nav"
        direction="back"
        onClick={() => setDrillType(null)}
        reason="Leave the drill-in and return to the cross-type table. Nothing is decided by leaving — every mark you did not settle is still standing. Esc does the same."
      />
      <ActionButton
        label={`capture ${drillType}`}
        disabled={driftCells.every((cell) => cell.typeName !== drillType)}
        onClick={() => captureAll([drillType])}
        reason={
          driftCells.some((cell) => cell.typeName === drillType)
            ? `Let Revit win on every drifting parameter of the ${drillType} type. Each live value is written into the profile as a ${drillType} override; the model is not touched, so this stays a safe verb.`
            : `Nothing is drifting at ${drillType}, so there is nothing to pull back.`
        }
      />
    </>
  ) : (
    <>
      <ActionButton
        label="capture all"
        disabled={overlay !== "live" || driftCells.length === 0}
        onClick={() => captureAll(world.typeNames)}
        reason={
          overlay !== "live"
            ? "Switch to the ⇄ live overlay first. Capture rewrites the profile with Revit's numbers in bulk, and this is the one view where those numbers are on screen — pressing it from here would be a write you cannot see the far side of."
            : driftCells.length === 0
              ? "Nothing is drifting anywhere, so there is nothing to pull back. Capture only ever moves values the two sides disagree about."
              : `Let Revit win on all ${driftCells.length} drifting cells, across every type — every alarm cell you can see right now. Each live value lands in the profile as that type's override; Revit is not touched.`
        }
      />
      <ActionButton
        label="capture live"
        busy={capturing}
        disabled={lane.document == null || capturing || captureRefusal != null}
        onClick={() => void store.actions.capture().catch(() => undefined)}
        reason={
          captureRefusal ??
          (lane.document == null
            ? "The fixture lane has no session behind it — its live readings are checked into `src/family/world.ts`. Open a real family.json to read Revit."
            : "Re-read the family open in Revit and re-stamp the evidence — this is what the ⇄ live overlay and the drift marks are readings OF. It moves nothing into the profile: that is capture all, under the overlay. Refuses in Revit's own words if no family document is active there.")
        }
      />
      <ActionButton
        label={BUILD_ACTION}
        tone="commit"
        busy={building}
        disabled={lane.document == null || building || prepareBuildRefusal != null}
        onClick={store.actions.armBuild}
        reason={
          prepareBuildRefusal ??
          (lane.document == null
            ? "Nothing to build — this page is reading its declared fixture, which has no file behind it. Pick a document in the sentence first."
            : `Materialize ${lane.document.relativePath} into a real .rfa inside Revit, at ${buildOutputPath(lane.document.relativePath)}. Pressing this arms the ceremony above the table — it does not build. The strip states which family, from which revision, to which path, and refuses out loud if the file on disk is not the file this table is showing.`)
        }
      />
    </>
  );

  const crossType = (
    <TableFrame
      label="parameters"
      rows={rows}
      columns={columns}
      rowKey={(row) => row.key}
      state={tableState}
      onStateChange={setTableState}
      summary={
        <span className="inline-flex flex-wrap items-center gap-1">
          <span className="t-small face-mono text-ink-2">
            {Object.keys(world.grounding).length} grounded · {openProposals.length} open ·{" "}
            {world.typeNames.length} types
          </span>
          <FactChip
            tone={ghostCount > 0 ? "caution" : undefined}
            title="Geometry rows without a parameter binding."
          >
            {ghostCount} unbound
          </FactChip>
          <FactChip
            tone={unsavedCount > 0 ? "caution" : undefined}
            title="Cells the next profile save would write."
          >
            {unsavedCount} unsaved
          </FactChip>
          <FactChip
            tone={driftCells.length > 0 ? "alarm" : undefined}
            title="Cells where Revit disagrees with the draft."
          >
            {driftCells.length} drift
          </FactChip>
          {/* Region orientation: how to read the counts, what an unbound geom row is, and what
              each of the two bind choices does. Every ghost row's title defers to this. */}
          <HelpTip>
            <p>
              Read left to right: how much of this profile the spec backs, what pea still wants, how
              many geometry dimensions nothing can reach, how many cells save would write, and where
              Revit disagrees. The one alarm is spent on drift and nothing else; unbound and unsaved
              wear caution, because a gap and a pending write are warnings rather than conflicts.
            </p>
            <p className="mt-1.5">
              An <b>unbound</b> row (marked <i>geom</i>) is a bindable dimension that NO parameter
              drives. Its literal is the same for every type of this family, forever: no type can
              differ, no schedule can read it, no formula can reach it. That is why its value sits
              in the ONE merged cell spanning every type column — because there is exactly one of
              it. Clicking its name opens the constituent in the inspector.
            </p>
            <p className="mt-1.5">
              Binding one (<i>bind…</i> in the state column) is a choice of two. Binding to an{" "}
              <b>existing</b> parameter DISCARDS the literal and the dimension starts reading that
              row instead — check the row says what you want before you pick. Binding to a{" "}
              <b>new</b> parameter KEEPS the literal as that parameter&rsquo;s family value, so the
              geometry does not move at all and only its reachability changes.
            </p>
          </HelpTip>
        </span>
      }
      searchPlaceholder="parameter"
      modes={tableModes}
      actions={tableActions}
    >
      <Table
        rows={rows}
        columns={columns}
        rowKey={(row) => row.key}
        label="parameters"
        state={tableState}
        onStateChange={setTableState}
        onRowHover={hoverRow}
        rowClassName={rowTint}
        // THE OWED MARKER (fit reviews, ruled 2026-08-16): a ghost row owes exactly one human
        // decision — its bind crossing. Count is always 1; the caution ink matches the band the
        // ghost section already wears.
        gutter={(row) =>
          row.kind === "ghost"
            ? {
                count: 1,
                tone: "caution" as const,
                title: `${row.slug ?? ""}.${row.property ?? ""} is unbound — a bind decision is owed: give it a parameter (its one crossing) or it stays a number nothing can reach`,
              }
            : null
        }
        empty={
          // §4's two kinds of empty, told apart: the fixture profile always has rows, so a bare
          // table is almost always the table's OWN narrowing — but the claim is derived, not
          // assumed, so each story renders only when it is true.
          rows.length === 0 ? (
            <EmptyState story="scope" exit="author a parameter, or promote a geometry literal">
              no parameters in this profile — nothing to audit
            </EmptyState>
          ) : (
            <EmptyState story="filter" exit="clear a query chip">
              the narrowing hid all {rows.length} rows
            </EmptyState>
          )
        }
      />
    </TableFrame>
  );

  /** The drill-in is the SAME primitive with a narrower column set — that is the whole claim. */
  const drillIn = drillType ? (
    <TableFrame
      label={`${drillType} · parameters`}
      rows={rows.filter((row) => row.kind === "profile")}
      columns={drillColumns}
      rowKey={(row) => row.key}
      state={drillState}
      onStateChange={setDrillState}
      summary={
        <span title="What this one type is asking of you. The same counts as the cross-type table, narrowed to this column of it.">
          {openProposals.filter((entry) => (entry.typeName ?? null) === drillType).length} open ·{" "}
          <FactChip
            tone={driftCells.some((cell) => cell.typeName === drillType) ? "alarm" : undefined}
            title="Cells where Revit disagrees with this type's draft."
          >
            {driftCells.filter((cell) => cell.typeName === drillType).length} drift
          </FactChip>
        </span>
      }
      searchPlaceholder="parameter"
      actions={tableActions}
    >
      <Table
        // Ghosts and live-only rows stay OUT of the drill-in: it is a view of one type's profile
        // against Revit, and neither of those rows has a per-type value to reconcile. A ghost here
        // would be three refusals wide in a table two columns narrow.
        rows={rows.filter((row) => row.kind === "profile")}
        columns={drillColumns}
        rowKey={(row) => row.key}
        label={`${drillType} · parameters`}
        state={drillState}
        onStateChange={setDrillState}
        onRowHover={hoverRow}
        rowClassName={rowTint}
        empty={
          rows.some((row) => row.kind === "profile") ? (
            <EmptyState story="filter" exit="clear a query chip">
              the narrowing hid every parameter at this type
            </EmptyState>
          ) : (
            <EmptyState story="scope" exit="author a parameter in the profile first">
              no parameters to reconcile at this type — the profile authors none, so there is
              nothing for Revit to agree or disagree with
            </EmptyState>
          )
        }
      />
    </TableFrame>
  ) : null;

  const tablePane = (
    <Pane
      kind="content"
      flush
      scroll="clip"
      headerless
      // The type's own NAME is the title while drilled in — a pane whose title still said
      // "parameters × types" would be claiming to show something it is not.
      title={drillType ?? "parameters × types"}
      meta={
        drillType
          ? "one type"
          : overlay === "live"
            ? "live overlay"
            : overlay === "saved"
              ? "saved overlay"
              : "all types"
      }
      help={
        drillType
          ? "One type, the same table — profile, spine and live side by side for the type you drilled into."
          : overlay === "live"
            ? "LIVE OVERLAY — Revit's numbers in place, read-only. The alarm is where the document disagrees with the profile."
            : overlay === "saved"
              ? "SAVED OVERLAY — what is on disk, read-only. Caution marks what a save would overwrite."
              : "Every type side by side — the spread across types is the audit."
      }
    >
      {/* THE CEREMONY SLOT. It sits inside the pane that owns the crossing, above the table it is
          about, and it is EMPTY until the verb arms it — "never hover-height" (settled law)
          means the reason, the refusals and the receipt all get room at strip scale. The build is a
          whole-family write, so the slot is the same in the drill-in: no type is on the plan. */}
      <BuildStrip
        className="mx-2 mt-2"
        armed={armedBuild}
        building={building}
        said={buildOutcome}
        refusal={store.handle.actions.build.refusal}
        facts={buildFacts}
        familyName={world.familyName}
        count={world.paramRows.length}
        onReasonChange={store.actions.setBuildReason}
        onCommit={() => void store.actions.build().catch(() => undefined)}
        onCancel={store.actions.cancelBuild}
        onReplan={store.actions.armBuild}
      />
      {drillIn ?? crossType}
    </Pane>
  );

  // ── the inspector: the doc pane's LOWER HALF ──────────────────────────────────────────────────
  //
  // Two subjects, one slot, because they are the same question: what is true of this THING, rather
  // than of it at some type. A constituent's non-bindable metadata has no honest column — it does
  // not vary by type, half of it is not a number, and half of THAT cannot be edited at all. A
  // parameter's family-level value has no column either, since the one that was pretending to be a
  // fourth type was removed. Both land here, and the pane keeps the spec above them so a citation
  // never leaves the screen while you edit the number it justifies.

  return tablePane;
}
