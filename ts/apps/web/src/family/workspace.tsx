/**
 * /family — THE surface for ONE family.
 *
 * Promoted 2026-08-16 out of the clean room: this was `?variant=e`, the converged survivor of a
 * five-way rebuild, and the ruling was that it IS the product. It is now the route. The four
 * rivals live on snapshot branch `proto/family-variants-2026-08`; the surface it replaced — the
 * authored/live two-lane workspace — is in git at `0af4260`.
 *
 *   THE TABLE IS THE INTERFACE. One row per parameter, one column per TYPE, and the cross-type
 *   spread is never hidden — the whole point of a family is that its types disagree on purpose,
 *   and the only way to audit that is to see them side by side. Spreadsheet discipline: a cell is
 *   either editable or properly disabled WITH a reason. Nothing is greyed out mysteriously.
 *
 *   A-MODE DRILL-IN. Clicking a type's column header swaps the table pane — not the page — into
 *   an aligned profile | spine | live reconciler for that one type. Esc comes back.
 *
 *   THE DOC PANE IS A SIDEBAR ON THE TABLE, like takeoff's. One pane, two modes: the OCR'd text
 *   blocks, or a stand-in for the real page camera. Proposals dock on top of it as annotation
 *   cards. Hovering a grounded row lights its citation in whichever mode is showing; the citation
 *   comes from WORLD.grounding, so it survives its proposal being accepted.
 *
 *   THE ANATOMY IS A COLLAPSIBLE VISUAL PANE over the table, drawn from the profile's own
 *   parameter values. Hovering a solid lights the parameters it consumes and vice versa — one
 *   focus, two views, never two independent highlights.
 *
 *   RAIL = SCANNABLE. A narrow gutter left of every row. Blank when nothing is proposed; one dot
 *   in pea's ink when one proposal lands on the row; a counted chip when several do. It answers
 *   exactly one question, top to bottom, without reading a single value: WHERE do proposals live.
 *
 *   CELLS = LOCATABLE. Each proposed cell wears a small corner fold in pea's ink. The rail says
 *   the row is contested; the folds say WHICH cells in it are. Neither covers a value, and neither
 *   changes the table's geometry.
 *
 *   THE CELL DECIDES. Accept and deny are the cell's own contract transitions (verdict
 *   2026-09-18), drawn on the table cell, the inspector's family value and the sidebar card alike;
 *   the card is the same Work field as a `ReviewRow`, beside the spec text that justifies it.
 *   Clicking the CELL brings its card into view (`StateCell`'s own `onLocate`). The rail counts
 *   and points; it decides nothing.
 *
 *   ONE LIFECYCLE, TWO RUNGS (ruled 2026-08-31). A cell holds pea's PROPOSAL and the draft's
 *   STAGED value, and nothing else. Accept stages pea's value and leaves the proposal standing
 *   behind it, which is how the square is known to be pea's ink. Deny CLEARS the proposal — there
 *   is no denied state to draw, the cell simply shows the real value again.
 *
 *   TYPING BEATS PROPOSING. A proposed cell is an ordinary editable cell. The moment you commit
 *   your own value into it the proposal is CLEARED — the same outcome as a denial, because the
 *   proposal has nothing left to argue for. `superseded` was a fourth state for that and it is
 *   deleted. Grounding is untouched: a citation is a fact about where a number came from, not a
 *   fact about pea.
 *
 * THE GHOST-ROW LAW, in the user's words:
 *
 *   "Everything on a geom property that is bindable to a param should be visible in the table as
 *    a ghost row, but still editable. If it's unbound in the profile it's sorted to bottom. If it
 *    is bound, it's represented by that param. Non-bindable properties live somewhere else."
 *
 * Which resolves the one thing the table could not previously say. A family's numbers do not all
 * live in its parameters: a dimension frozen into the geometry is a number no type can differ on,
 * no schedule can read, and no formula can reach — and until now the surface showed it NOWHERE, so
 * the difference between "the bore is 3in because a parameter says so" and "the bore is 3in
 * forever" was invisible. The law puts both in the same table and distinguishes them by SHAPE:
 * bound dims are already there, wearing their parameter's row; unbound ones fall to the bottom as
 * ghosts. The bottom of the table becomes the list of numbers nothing can reach, and each ghost
 * carries exactly one verb — bind — which is its one crossing out of that condition.
 *
 * NON-BINDABLE metadata (a connector's direction, its system type, a normal) lives in the doc
 * pane's lower half instead, which is also where a PARAMETER's family-level value lives.
 *
 * THE CELL-STATE LAW, in the user's words:
 *
 *   "For each param value there are three dimensions, in order of importance: parameter name,
 *    family type, and proposed/grounded/live/saved (pseudo-dimension). These states are cell
 *    states or togglable overlays on the value cells."
 *
 * Which kills the LIVE COLUMN. A column is the second dimension — a family type — and Revit was
 * never a fourth type; it was a fourth reading of the same three. Now those readings go exactly
 * where they belong — INTO the three cells they are readings of — under an overlay you switch.
 * The grid is parameter × type and nothing else, forever.
 *
 *   THE OVERLAY IS THE PSEUDO-DIMENSION. `draft` shows the page-state values, editable. `⇄ live`
 *   swaps every value cell to what Revit carries, read-only, alarm where it differs. `⇄ saved`
 *   swaps them to what is on disk, read-only, caution where it differs. Nothing moves: the row
 *   set, the column set, and every row height are identical in all three.
 *
 *   THE MARKS SURVIVE THE OVERLAY. A proposal's fold and a grounded cell's hairline underline are
 *   facts about the CELL, not about which reading is showing, so they persist across all three.
 *
 *   THE LIVE OVERLAY IS THE RECONCILE ROOM. capture-all and apply-all are dark in `draft` and lit
 *   under `⇄ live`, because a bulk crossing you cannot see the far side of is a bulk crossing made
 *   blind (SURFACE-PHILOSOPHY §2). Per-cell capture/apply stay in the drill-in.
 *
 * ── WHERE IT SITS (2026-09-17) ─────────────────────────────────────────────────────────────
 * This is the AUDIT of the `/family` entity route. The kernel draws the Situation (document, pod,
 * spec), owns capture and apply (apply confirms the host's plan first), and opens the shared spec
 * editor beside this body. The body edits the open member through its Settings Work: authored
 * edits stage as field patches, Pea proposals dock on the doc pane, and `build .rfa` is the one
 * crossing this body arms itself.
 *
 *   capture live   the kernel's `family.capture` workflow. It files the open family as a NEW
 *                  member, the page lands on it, and the capture's evidence (coverage, the
 *                  unmodeled ledger) is a log row and feeds the ⇄ live overlay.
 *   build .rfa     `family.build`. A WRITE that leaves the page and
 *                  the document: it composes the SAVED member host-side and materializes an .rfa.
 *                  Because it reads the saved bytes rather than the table, it is armed rather than
 *                  pressed — the ceremony, its refusals and its receipt live in `#/family/build`.
 */
import { useEffect } from "react";

import { ActionButton } from "#/components/lang/action-button";
import { Code, stringify } from "#/components/lang/code";
import { PaneSplit } from "#/components/lang/pane";
import { buildReceiptSummary } from "#/family/build";
import type { FamilyStore } from "#/family/store";
import { FamilyWorkspaceAnatomy } from "#/family/workspace-anatomy";
import { FamilyWorkspaceDocPane } from "#/family/workspace-doc-pane";
import { FamilyWorkspaceTable } from "#/family/workspace-table";
import { FamilyWorkspaceProvider, useFamilyWorkspace } from "#/family/workspace-context";
import { useFamilyWorkspaceCore } from "#/family/workspace-core";
import { useFamilyColumns } from "#/family/workspace-columns";

function useFamilyWorkspaceModel(store: FamilyStore) {
  const core = useFamilyWorkspaceCore(store);
  const columnModel = useFamilyColumns(core);
  return { ...core, ...columnModel, picker: store.picker };
}

export type FamilyWorkspaceModel = ReturnType<typeof useFamilyWorkspaceModel>;

const noun = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The audit body: anatomy and table beside the doc. What it learns is log rows, never bands. */
export function FamilyWorkspace({ store }: { store: FamilyStore }) {
  const model = useFamilyWorkspaceModel(store);
  useFamilyLog(store);
  return (
    <FamilyWorkspaceProvider value={model}>
      <div className="flex size-full min-h-0 min-w-0 flex-col">
        {store.editFailure && (
          <div role="alert">
            <span>{store.editFailure.message} Your input is retained for this member.</span>
            <ActionButton
              label="retry staging"
              reason="Retry the retained input against its original Work revision"
              onClick={() => void store.actions.flush().catch(() => undefined)}
            />
          </div>
        )}
        <FamilyAuditPanes />
      </div>
    </FamilyWorkspaceProvider>
  );
}

/**
 * N3/N6: what the audit learns lands in the route's one log, once per new fact. A draft that will
 * not parse is a refusal row. The latest capture is a row whose hover says what it saw and when,
 * linked to its unmodeled facts, and each of its issues is a row. Each saved Family Reading is a
 * row that opens its JSON. `handle.note` is a fresh closure every render, so it is not a dep.
 */
function useFamilyLog(store: FamilyStore) {
  const { handle } = store;
  const parseError = store.lane.parseError;
  useEffect(() => {
    if (parseError != null) handle.note("model", `will not parse: ${parseError}`, true);
  }, [parseError]); // eslint-disable-line react-hooks/exhaustive-deps
  const { captured } = store;
  const evidence = captured && "modelJson" in captured.evidence ? captured.evidence : null;
  const capturedKey =
    evidence && `${captured!.member.pod}:${captured!.member.path}:${evidence.observedAt}`;
  useEffect(() => {
    if (!captured || !evidence) return;
    const { member } = captured;
    const coverage = Object.entries(evidence.coverage).map(
      ([section, state]) => `${section}: ${state}`,
    );
    // The facts themselves are the run's `unmodeled.json`, never the member (law 12).
    handle.note(
      `captured ${evidence.familyName}`,
      [
        `into ${member.pod} · ${member.path}`,
        ...coverage,
        noun(evidence.unmodeledCount, "unmodeled fact"),
        `observed ${evidence.observedAt}`,
      ].join(" · "),
      false,
      evidence.run
        ? { kind: "member", id: JSON.stringify([member.pod, `${evidence.run}/unmodeled.json`]) }
        : undefined,
      { at: evidence.observedAt, key: `capture:${capturedKey}` },
    );
    for (const [index, issue] of evidence.issues.entries())
      handle.note(issue.code, issue.message, issue.severity === "Error", undefined, {
        at: evidence.observedAt,
        key: `capture:${capturedKey}:issue:${index}`,
      });
  }, [capturedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    for (const reading of store.readings)
      handle.note(
        `saved ${reading.reading.kind} reading`,
        `captured ${reading.capturedAt} (${reading.provenance.kind})`,
        false,
        { kind: "reading", id: reading.id },
        { at: reading.capturedAt, key: `reading:${reading.id}` },
      );
  }, [store.readings]); // eslint-disable-line react-hooks/exhaustive-deps
}

function FamilyAuditPanes() {
  const { anatomyCollapsed, setAnatomyCollapsed } = useFamilyWorkspace();
  return (
    <PaneSplit
      axis="horizontal"
      grow
      resize={{ target: "end", defaultSize: 340, minSize: 260, minOtherSize: 560 }}
      start={
        <PaneSplit
          axis="vertical"
          grow
          resize={{
            target: "start",
            defaultSize: 220,
            minSize: 34,
            collapse: {
              collapsed: anatomyCollapsed,
              onCollapsedChange: setAnatomyCollapsed,
              collapsedSize: 34,
              collapseBelow: 90,
            },
          }}
          start={<FamilyWorkspaceAnatomy />}
          end={<FamilyWorkspaceTable />}
        />
      }
      end={<FamilyWorkspaceDocPane />}
    />
  );
}

/** The ledger lines the audit adds to the kernel's Situation. */
export function familyFacts(store: FamilyStore) {
  const { lane, snapshot, sharedEdit, evidence } = store;
  const file = lane.document?.relativePath ?? store.profile;
  const validation = snapshot?.validation;
  return [
    [
      "model",
      lane.parseError != null
        ? `${file} · will not parse: ${lane.parseError}`
        : validation
          ? validation.isValid
            ? `${file} · valid`
            : `${file} · ${noun(validation.issues.length, "issue")}: ${validation.issues
                .map((issue) => issue.message)
                .join(" · ")}`
          : file || "none",
    ],
    [
      "coverage",
      evidence && "modelJson" in evidence
        ? `${Object.entries(evidence.coverage)
            .map(([key, value]) => `${key}: ${value}`)
            .join(" / ")} / ${evidence.unmodeledCount} unmodeled`
        : "not captured",
    ],
    ...(store.buildReceipt ? [["build", buildReceiptSummary(store.buildReceipt)] as const] : []),
    ...(evidence && "modelJson" in evidence
      ? [
          [
            "capture",
            <details key="capture">
              <summary className="cursor-pointer">native capture</summary>
              <Code
                code={`${stringify(evidence.coverage)}\n${evidence.modelJson}`}
                lang="json"
                title="native capture"
              />
            </details>,
          ] as const,
        ]
      : []),
    ...(sharedEdit
      ? [
          [
            "shared",
            `${sharedEdit.pointer} · no local edit was staged; open the referenced source below`,
          ] as const,
        ]
      : []),
    ...(snapshot?.dependencies ?? []).map(
      (dependency) =>
        [
          "depends",
          <a
            key={`${dependency.id}:${dependency.path}`}
            href={`/pods?${new URLSearchParams({ pod: dependency.id, path: dependency.path })}`}
            title="Edit the shared source JSON in its pod. Changes affect every member that includes it."
          >
            {sharedEdit?.directives.some((directive) => directive.endsWith(dependency.path))
              ? "open referenced source "
              : "edit shared "}
            @{dependency.id}/{dependency.path}
          </a>,
        ] as const,
    ),
  ] as const;
}
