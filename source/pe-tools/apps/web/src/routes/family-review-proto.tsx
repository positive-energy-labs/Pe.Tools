import { RouteShell, emptyManifest } from "#/route";
import { token } from "#/lib/token";
/**
 * /family-review-proto — THROWAWAY. find-the-product for the FAMILY REVIEW BOARD, round 2.
 *
 * A "looks good" board over portable `family.json` files: what the portable document predicts
 * against what Revit actually built, per-claim agreement, and a human verdict — because on
 * geometry the eyeball is the last oracle and the assertions are only the first.
 *
 * ROUND 1 CLOSED and this route lost its switcher with it. One layout survives (the overlay), so
 * `?variant=` is gone: a switcher over one choice is chrome that lies about the state of the
 * question. Round 2 builds ON the winner instead of beside it.
 *
 * SUB-SHAPE B (a new route), still deliberately: `/family` is THE one-family surface and
 * `/families` is the live fleet audit. A cross-family, cross-run, portable-vs-Revit board is
 * neither's mode. If a later round rules that it IS a mode of one of them, this route dies and the
 * winner folds in.
 *
 * THE CHROME IS THE POINT OF THIS HEADER. Source-of-truth law (ledger, 2026-08-19): a
 * `family.json` may be materialized into many documents across many years, and this surface must
 * NEVER imply it can sync a json to everywhere it has gone. So the header names its ONE reading
 * and says out loud that it writes nowhere — and where a verdict or an edit WOULD go is stated as
 * the open question it is, not left for a reader to assume.
 *
 * Dies with the round. Promote the winner into a real surface; the losers go to the throwaway
 * branch, never into main.
 */
import { createFileRoute } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { Pane } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { RUN_SOURCE, loadBoard } from "#/family-review/proto/board";
import { ReviewBoard, boardCases, useEdits, useVerdicts } from "#/family-review/proto/review-board";

/** Not cut over yet: an empty manifest is a legal manifest and the shell renders one. */
export const manifest = emptyManifest("family-review-proto", "Family Review Proto");

function RouteShelledFamilyReviewProto() {
  return (
    <RouteShell manifest={manifest}>
      <FamilyReviewProto />
    </RouteShell>
  );
}

export const Route = createFileRoute("/family-review-proto")({
  component: RouteShelledFamilyReviewProto,
});

function FamilyReviewProto() {
  const families = loadBoard();
  const board = boardCases(families);
  const verdicts = useVerdicts();
  const edits = useEdits();
  const staged = Object.keys(edits.book).length;

  return (
    <Surface>
      <>
        <Pane kind="content" title="family review" scroll="clip">
          <header className="flex flex-col gap-1 px-3 py-2" style={{ borderColor: token("line") }}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span>FAMILY REVIEW</span>
              <span>
                {families.length} portable families · {board.length} family × type
              </span>
            </div>

            {/* READS FROM — one run, one year, one lane, and a document named per family in the pane. */}
            <div className="flex flex-wrap items-baseline gap-2">
              <span>reads from</span>
              <FactChip
                tone="caution"
                dashed
                title={`A checked-in copy of the run artifacts under .artifacts/runs/${RUN_SOURCE.run}/. A shipping board reads a run directory and says how old it is; this one is a fixture and says so.`}
              >
                {RUN_SOURCE.kind} · {RUN_SOURCE.run}
              </FactChip>
              <FactChip
                tone="meta"
                title={`Run date ${RUN_SOURCE.date}, Revit ${RUN_SOURCE.year}, ${RUN_SOURCE.lane} lane (a Revit process started for the run and killed after it). Suite: ${RUN_SOURCE.suite}.`}
              >
                {RUN_SOURCE.date} · {RUN_SOURCE.year} · {RUN_SOURCE.lane} lane
              </FactChip>
              <FactChip
                tone="meta"
                title="Both sides of every drawing come from the same run artifact: FamilyModelEvaluatorOracle.Predict and FamilyFoundryRuntimeProbe. The web is a projection, never a second predictor."
              >
                one renderer · two feeds
              </FactChip>
            </div>

            {/* WRITES TO — nothing, and the two open questions that is standing in for. */}
            <div className="flex flex-wrap items-baseline gap-2">
              <span>writes to</span>
              <FactChip
                tone="caution"
                title="Where an edit or a verdict on this board would land: nowhere, by scope. The three unanswered questions behind that are stated in full beside the strip."
              >
                nothing
              </FactChip>
              <FactChip
                tone="caution"
                dashed
                title="OPEN QUESTION for kaitpw — a verdict has no home in the repo yet. Stated in full beside the strip."
              >
                a verdict would go — open
              </FactChip>
              <FactChip
                tone="caution"
                dashed
                title="OPEN QUESTION for kaitpw — an edit's destination is unruled. Stated in full beside the strip."
              >
                an edit would go — open
              </FactChip>
              {/* The strip's three claims in full; the chips above carry only the short fact. */}
              <HelpTip>
                <p>
                  <b>nothing.</b> Not the family.json, not the document above, not any other
                  document this json has been materialized into. A family.json may be materialized
                  into many documents across many years and NOTHING here can sync them — that is out
                  of scope by law, not by omission.
                </p>
                <p className="mt-1.5">
                  <b>a verdict would go — OPEN QUESTION for kaitpw.</b> A verdict is a human fact
                  about a family AT A RUN — not about the json, which outlives the run, and not
                  about the document, which is one materialization of many. Nothing in the repo has
                  a home for that fact yet, so this board keeps verdicts in memory for the length of
                  a page view.
                </p>
                <p className="mt-1.5">
                  <b>an edit would go — OPEN QUESTION for kaitpw.</b> An edit here changes the
                  PORTABLE DOCUMENT, whose prior materializations this board cannot reach and must
                  never appear to reach. Writing back to the family.json on disk is one answer;
                  staging a change for the next materialization is another. Until one is ruled,
                  edits stage in memory and go nowhere.
                </p>
              </HelpTip>
              {staged > 0 ? (
                <FactChip
                  tone="caution"
                  title={`${staged} unsaved edit(s) staged on claim cells. They are in memory only and have no destination — see the open question beside this chip. A page reload discards them.`}
                >
                  {staged} staged · unsaved
                </FactChip>
              ) : null}
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            <ReviewBoard board={board} verdicts={verdicts} edits={edits} />
          </div>
        </Pane>
      </>
    </Surface>
  );
}
