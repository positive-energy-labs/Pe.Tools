import { ActionButton } from "#/components/lang/action-button";
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
 *   the row is contested; the folds say WHICH cells in it are. Neither covers a value, neither
 *   changes the table's geometry, and neither carries a verdict.
 *
 *   CARDS = DECIDABLE. Accept and deny live only on the sidebar cards, next to the spec text that
 *   justifies them. Clicking the CELL brings its card into view (`StateCell`'s own `onLocate`);
 *   nothing pops over the table, so the evidence and the decision are never hidden by the
 *   affordance that reached them. The rail counts and points; it decides and locates nothing.
 *
 *   ONE LIFECYCLE, TWO RUNGS (ruled 2026-08-31). A cell holds pea's PROPOSAL and the draft's
 *   STAGED value, and nothing else. Accept stages pea's value and leaves the proposal standing
 *   behind it, which is how the square is known to be pea's ink. Deny CLEARS the proposal — there
 *   is no denied state to draw, the cell simply shows the real value again. Re-open puts it back.
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
 * ── WHAT IS AND IS NOT WIRED (phase B, 2026-08-17) ──────────────────────────────────────────
 * TWO LANES, ONE SHAPE. The family store answers the only question that separates them — is a
 * family document open in `route:settings`? — and the page below it renders ONE `FamilyModel` either
 * way. Nothing in this file asks whether a host exists.
 *
 *   LIVE     — a real `family.json`, parsed and projected. The document slot lists what the bound
 *              session can see and picking one runs settings `open`; `save profile` diffs the
 *              draft into staged field patches and runs settings `save`, whose refusal (a version
 *              conflict, a schema failure, a field still flagged for attention) is surfaced
 *              VERBATIM on the same receipt channel every other verb uses.
 *   FIXTURE  — no document. `EMPTY_FAMILY_MODEL`, wearing the dashed seam chip, save page-local. Not a
 *              fallback: a DECLARED lane, and the chip says what replaces it.
 *
 * ── THE TWO HOST CROSSINGS (phase D, 2026-08-17) ────────────────────────────────────────────
 * The table pane header's last two verbs are the only two on this page that talk to Revit, and they
 * are the two directions evidence travels:
 *
 *   capture live   `route:family` `capture_evidence` → `revit.detail.family-model`. A READ. Its
 *                  result lands in the evidence slice, the projection turns it into the live half,
 *                  and the ⇄ live overlay, the drift marks and the freshness chip are all readings
 *                  OF it. Refuses in the host's own words when no family document is active in
 *                  Revit. It moves nothing into the profile — `capture all` does that, under the
 *                  overlay, once there is a reading to move.
 *   build .rfa     `route:family` `build_evidence` → `family.build`. A WRITE, and the
 *                  only one that leaves both the page and the document: it re-opens the SAVED
 *                  family.json host-side and materializes a timestamped .rfa. Because it reads the
 *                  file rather than the table, it is armed rather than pressed — the ceremony, its
 *                  refusal predicates and its receipt live in `#/family/build`.
 *
 * The targeting header runs native familyfoundry Plan/Apply against the saved composed JSON,
 * guarded by the reviewed plan hash. Bulk/per-type cell apply simulates only in the explicit
 * fixture lane; native callers are directed to that header. Proposals remain page-local
 * with their accept/deny (they need `route:settings` field
 * proposals, which the projection deliberately does not invent), and the doc pane's parse.
 */
import type { FamilyStore } from "#/family/store";
import { FamilyWorkspaceProvider } from "#/family/workspace-context";
import { FamilyWorkspaceView } from "#/family/workspace-view";
import { useFamilyWorkspaceCore } from "#/family/workspace-core";
import { useFamilyColumns } from "#/family/workspace-columns";

function useFamilyWorkspaceModel(store: FamilyStore) {
  const core = useFamilyWorkspaceCore(store);
  const columnModel = useFamilyColumns(core);
  return { ...core, ...columnModel, picker: store.picker };
}

export type FamilyWorkspaceModel = ReturnType<typeof useFamilyWorkspaceModel>;

export function FamilyWorkspace({ store }: { store: FamilyStore }) {
  const model = useFamilyWorkspaceModel(store);
  const { readings } = store;
  return (
    <FamilyWorkspaceProvider value={model}>
      {store.editFailure && (
        <div role="alert">
          <span>{store.editFailure.message} Your input is retained for this file.</span>
          <ActionButton
            label="retry staging"
            reason="Retry the retained input against its original Work revision"
            onClick={() => void store.actions.flush().catch(() => undefined)}
          />
        </div>
      )}
      {readings.length > 0 && (
        <details>
          <summary>Saved Family readings</summary>
          {readings.map((capture) => (
            <p key={capture.id}>
              <a href={`/family/readings?id=${capture.id}`}>
                {capture.reading.kind} captured {capture.capturedAt} ({capture.provenance.kind})
              </a>
            </p>
          ))}
        </details>
      )}
      <FamilyWorkspaceView />
    </FamilyWorkspaceProvider>
  );
}

/** A constituent the profile names in prose but declares no structured geometry for. */
