import { token } from "#/lib/token";

/**
 * PROTOTYPE (round 2) — THE FAMILY REVIEW BOARD, one layout.
 *
 * Round 1 ran three boards against each other and closed (ledger, 2026-08-19): variant C — the
 * OVERLAY — won, variant A survives DEMOTED to an expand sidebar, and variant B (one MasterTable
 * over every claim in every family) is retired as the wrong model for the surface. B's code is
 * deleted rather than parked; the round is the record.
 *
 * WHAT THE BOARD IS, after round 1:
 *   the rail  — the LIBRARY. Which portable `family.json` files do I have, and what is in each.
 *   expanded  — A's content at sidebar scale: six small drawings (the predicted triptych above
 *               the actual one) plus a plain constituent count. Enough to recognise a family
 *               without opening it, never enough to judge one — judging happens in the overlay.
 *               It hangs off the row to the RIGHT and never reflows the list (ruled 2026-08-19),
 *               and all six drawings are visible at once — the panel is for SCANNING.
 *   the pane  — C's overlay: ONE triptych per family, the portable document's prediction drawn as
 *               a thin ghost UNDER the ink Revit built. Daylight between them IS the
 *               disagreement, and no hue carries the verdict.
 *   the table — compact mode, and EDITABLE. The claims that are not a plain agreement, plus every
 *               writable settings key. Edits stage in memory and go nowhere; where they WOULD go
 *               is stated in the chrome as the open question it is.
 *
 * Verdicts and edits are both MOCKED — in memory for the length of a page view. That is not a
 * shortcut, it is the finding: a verdict is a human fact about a family AT A RUN, an edit is a
 * change to a json that may already be materialized into many documents, and nothing in the repo
 * has a home for either.
 */
import { useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import {
  AGREEMENT_LABEL,
  AGREEMENT_TONE,
  EMPTY_SCENE,
  VERDICT_LABEL,
  actualScene,
  authoredScene,
  claimEdit,
  constituents,
  editKey,
  feet,
  headline,
  reviewRows,
  sceneHalfSpan,
  stageEdit,
  stagedValue,
  tally,
  uneditableReason,
  type Agreement,
  type BoardFamily,
  type EditBook,
  type ReviewRow,
  type Verdict,
} from "#/family-review/model";
import { CompactTable, type CompactColumn } from "#/family-review/proto/compact-table";
import { ScaleNote, Triptych } from "#/family-review/proto/views";
import { cn } from "#/lib/utils";
import { Press } from "#/components/lang/press";

/** One family at one type — the unit the board judges. */
export interface Stage {
  family: BoardFamily;
  typeName: string;
  rows: ReviewRow[];
  key: string;
}

export function stages(families: BoardFamily[]): Stage[] {
  return families.flatMap((family) => {
    const typeNames = Object.keys(family.probes);
    // A refused family still stages: the refusal IS its content, not an error to hide.
    const staged = typeNames.length ? typeNames : [Object.keys(family.model.types)[0] ?? "Default"];
    return staged.map((typeName) => ({
      family,
      typeName,
      key: `${family.slug}::${typeName}`,
      rows: reviewRows(family, typeName),
    }));
  });
}

export interface VerdictBook {
  get: (key: string) => Verdict;
  set: (key: string, verdict: Verdict) => void;
}

export function useVerdicts(): VerdictBook {
  const [book, setBook] = useState<Record<string, Verdict>>({});
  return {
    get: (key) => book[key] ?? "unjudged",
    set: (key, verdict) =>
      setBook((prev) => ({ ...prev, [key]: prev[key] === verdict ? "unjudged" : verdict })),
  };
}

export interface EditDesk {
  book: EditBook;
  /** Returns a refusal reason, or nothing when the edit staged. The `StateCell` contract. */
  stage: (stageKey: string, row: ReviewRow, text: string) => string | void;
}

export function useEdits(): EditDesk {
  const [book, setBook] = useState<EditBook>({});
  return {
    book,
    stage: (stageKey, row, text) => {
      // Validation is a pure function in `model.ts`, so the rule a cell enforces is the rule a
      // test pins — without a DOM.
      const next = stageEdit(book, stageKey, row, text);
      if (typeof next === "string") return next;
      setBook(next);
    },
  };
}

const VERDICT_KEYS: Verdict[] = ["good", "unsure", "wrong"];

/**
 * The human's call. Three buttons, no confirm — nothing leaves the page, so no ceremony is owed.
 *
 * GAP: a raw button element rather than a primitive. `lang/Verb` is a verb (it acts); this is a
 * three-way EXCLUSIVE CHOICE that must also express "not judged yet". `ui/toggle-group` is the
 * right shape and cannot be used: it carries shadcn chrome (`rounded-lg`, `border-line`,
 * `bg-recess/40`) instead of role tokens and the 2px radius, and it has no empty member. Owed as
 * one line in the design-system ledger, naming this route.
 */
function VerdictStrip({ value, onPick }: { value: Verdict; onPick: (verdict: Verdict) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="verdict">
      {VERDICT_KEYS.map((verdict) => (
        <Press
          key={verdict}
          type="button"
          onClick={() => onPick(verdict)}
          title={`Record "${VERDICT_LABEL[verdict]}" for this family and type. Prototype: in memory only — the chrome says where a verdict would go, which is nowhere yet.`}
          className={cn(
            "border px-2.5 py-1 face-mono t-value",
            value === verdict ? "text-ink" : "text-ink-mute",
          )}
          style={{
            borderRadius: 2,
            borderColor: value === verdict ? token("line-2") : token("line"),
            background: value === verdict ? token("select") : "transparent",
          }}
        >
          {VERDICT_LABEL[verdict]}
        </Press>
      ))}
    </div>
  );
}

function AgreementWord({ agreement }: { agreement: Agreement }) {
  return (
    <span className="face-mono t-label" style={{ color: AGREEMENT_TONE[agreement] }}>
      {AGREEMENT_LABEL[agreement]}
    </span>
  );
}

function TallyChips({ rows }: { rows: ReviewRow[] }) {
  const counts = tally(rows);
  return (
    <span className="flex flex-wrap gap-1">
      {(Object.keys(counts) as Agreement[])
        .filter((agreement) => counts[agreement] > 0)
        .map((agreement) => (
          <FactChip
            key={agreement}
            tone={
              agreement === "differs" || agreement === "refused"
                ? "alarm"
                : agreement === "authored-only" || agreement === "revit-only"
                  ? "caution"
                  : "meta"
            }
            title={`${counts[agreement]} claim(s) ${AGREEMENT_LABEL[agreement]} between the portable document and Revit.`}
          >
            {counts[agreement]} {AGREEMENT_LABEL[agreement]}
          </FactChip>
        ))}
    </span>
  );
}

/** The refusal, as board CONTENT. A refused family has an authored side and nothing else. */
function RefusalPanel({ family, size }: { family: BoardFamily; size: number }) {
  return (
    <div
      className="flex flex-col justify-center gap-1 border p-3"
      style={{ width: size * 3 + 16, borderRadius: 2, borderColor: token("alarm") }}
    >
      <span className="face-mono t-label" style={{ color: token("alarm") }}>
        {family.refusal?.code ?? "refused"}
      </span>
      <p className="m-0 t-label leading-4 text-ink-2">{family.refusal?.detail}</p>
      <span className="t-caption text-ink-mute">
        Revit never built this family, so there is no drawing to compare. That is the finding, not a
        gap in the board.
      </span>
    </div>
  );
}

// ── the rail: the library, and A demoted into it ────────────────────────────────────────────────

const SIDEBAR_PANEL = 80;

/**
 * Variant A, at sidebar scale — the demotion round 1 ruled.
 *
 * A's full card put a 132px predicted triptych BESIDE a 132px actual one with a whole row table
 * underneath, which made it a second place to judge a family and put it in competition with the
 * overlay. What survives is A's CONTENT: the two triptychs, stacked and small, and a count of what
 * the document declares. Six drawings you can recognise a family by, and a list you can check a
 * json against — neither of them a verdict surface.
 */
function FamilySidebar({ stage }: { stage: Stage }) {
  const probe = stage.family.probes[stage.typeName];
  const predicted = probe ? authoredScene(probe) : EMPTY_SCENE;
  const actual = probe ? actualScene(probe) : EMPTY_SCENE;
  const halfSpan = sceneHalfSpan([predicted, actual]);

  return (
    <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
      {probe ? (
        <>
          <div className="flex flex-col gap-0.5">
            <span className="face-mono t-caption text-ink-mute">
              family.json · oracle prediction
            </span>
            <Triptych size={SIDEBAR_PANEL} halfSpan={halfSpan} ink={predicted} captions="short" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="face-mono t-caption text-ink-mute">Revit · runtime probe</span>
            <Triptych size={SIDEBAR_PANEL} halfSpan={halfSpan} ink={actual} captions="short" />
          </div>
        </>
      ) : (
        <span className="t-caption leading-4 text-ink-2">
          nothing was built, so there is nothing to draw — what the document declares, below, is the
          whole content
        </span>
      )}

      <dl className="m-0 flex flex-col gap-1">
        {constituents(stage.family).map((group) => (
          <div key={group.kind} className="flex flex-col">
            <dt className="face-mono t-label">
              {group.kind} <span className="tabular-nums text-ink-2">{group.count}</span>
            </dt>
            <dd className="m-0 face-mono t-caption leading-4 text-ink-2">
              {group.names.join(" · ")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── the board ───────────────────────────────────────────────────────────────────────────────────

const PANEL = 240;

export function ReviewBoard({
  board,
  verdicts,
  edits,
}: {
  board: Stage[];
  verdicts: VerdictBook;
  edits: EditDesk;
}) {
  const [selected, setSelected] = useState(board[0]?.key ?? "");
  const [expanded, setExpanded] = useState<string | null>(null);
  const stage = board.find((entry) => entry.key === selected) ?? board[0];
  if (!stage)
    return (
      <EmptyState
        story="scope"
        exit="run the roundtrip suite and point the board at its run directory"
      >
        no families staged
      </EmptyState>
    );

  const probe = stage.family.probes[stage.typeName];
  const predicted = probe ? authoredScene(probe) : EMPTY_SCENE;
  const actual = probe ? actualScene(probe) : EMPTY_SCENE;
  const halfSpan = sceneHalfSpan([predicted, actual]);
  // C shrinks the table to what is not a plain agreement. Writable keys are the exception: a
  // settings key that agrees is still the one thing on this board a person can change, and a table
  // that hid it would make the compact mode read-only in practice.
  const shown = stage.rows.filter((row) => row.agreement !== "agrees" || claimEdit(row) != null);

  const columns: CompactColumn<ReviewRow>[] = [
    {
      key: "kind",
      label: "kind",
      width: "w-[84px]",
      cell: (row) => <span className="text-ink-mute">{row.kind}</span>,
    },
    {
      key: "claim",
      label: "claim",
      width: "w-[168px]",
      cell: (row) => (
        <span>
          {row.label} <AgreementWord agreement={row.agreement} />
        </span>
      ),
    },
    {
      key: "authored",
      label: "family.json says",
      cell: (row) => <span className="text-ink-2">{row.authored}</span>,
      edit: (row) => {
        const writable = claimEdit(row) != null;
        return {
          value: stagedValue(edits.book, stage.key, row),
          onCommit: writable ? (text) => edits.stage(stage.key, row, text) : undefined,
          capReason: writable ? undefined : uneditableReason(row),
          staged: edits.book[editKey(stage.key, row.key)] != null,
        };
      },
    },
    {
      key: "actual",
      label: "Revit reports",
      cell: (row) => <span className="text-ink-2">{row.actual}</span>,
    },
    {
      key: "delta",
      label: "worst Δ",
      width: "w-[92px]",
      right: true,
      cell: (row) =>
        row.deviation == null ? (
          <span className="text-ink-mute">—</span>
        ) : row.deviation <= 1e-6 ? (
          <span className="text-ink-mute">·</span>
        ) : (
          <span className="tabular-nums" style={{ color: token("alarm") }}>
            {feet(row.deviation)}
          </span>
        ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1">
      {/* THE LIST NEVER REFLOWS (ruled 2026-08-19). The expanded preview is an overlay hung off
          the row's RIGHT edge, not a block inserted under it: opening one family used to push
          every family below it down the page, which is the one thing a library rail may not do —
          you lose your place in the list you were scanning. */}
      <nav
        className="w-72 shrink-0 overflow-y-auto overflow-x-visible border-r"
        style={{ borderColor: token("line") }}
      >
        {board.map((entry) => (
          <div key={entry.key} className="relative border-b" style={{ borderColor: token("line") }}>
            <div className="flex items-start">
              <Press
                type="button"
                onClick={() => setSelected(entry.key)}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2 py-1.5 text-left",
                  entry.key === selected ? "bg-select" : "",
                )}
                style={{ borderRadius: 2 }}
              >
                <span className="face-mono t-label">{entry.family.name}</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="face-mono t-caption text-ink-2">{entry.typeName}</span>
                  <AgreementWord agreement={headline(entry.rows)} />
                  {verdicts.get(entry.key) !== "unjudged" ? (
                    <span className="t-caption text-ink-mute">
                      {VERDICT_LABEL[verdicts.get(entry.key)]}
                    </span>
                  ) : null}
                </span>
              </Press>
              <Press
                type="button"
                aria-expanded={expanded === entry.key}
                onClick={() => setExpanded(expanded === entry.key ? null : entry.key)}
                title="Show what this family.json declares, and six small drawings of it. For recognising a family, not judging one — judging is the overlay on the right."
                className="shrink-0 px-2 py-1.5 face-mono t-caption text-ink-mute"
              >
                {expanded === entry.key ? "hide" : "open"}
              </Press>
            </div>
            {expanded === entry.key ? (
              <div
                className="absolute left-full top-0 z-20 w-64"
                style={{
                  background: token("artifact"),
                  border: `0.5px solid ${token("line-2")}`,
                  borderRadius: 2,
                  boxShadow: `0 2px 8px color-mix(in srgb, ${token("ink")} 10%, transparent)`,
                }}
              >
                <FamilySidebar stage={entry} />
              </div>
            ) : null}
          </div>
        ))}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <header className="flex flex-wrap items-baseline gap-3">
          <span className="face-mono t-prose font-semibold">{stage.family.name}</span>
          <span className="face-mono t-label text-ink-2">{stage.typeName}</span>
          <TallyChips rows={stage.rows} />
          <span className="ml-auto">
            <VerdictStrip
              value={verdicts.get(stage.key)}
              onPick={(verdict) => verdicts.set(stage.key, verdict)}
            />
          </span>
        </header>

        {/* THE READING, named on the family it belongs to: one document, from one run. */}
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="face-mono t-caption text-ink-mute">this reading came from</span>
          <FactChip
            tone="meta"
            dashed
            title="The Revit document this family's reading was probed in. A family.json may be materialized into many documents across many years; this board read exactly this one and can say nothing about the others."
          >
            {stage.family.documentName ?? "no document — never built"}
          </FactChip>
        </div>

        {probe ? (
          <>
            <Triptych size={PANEL} halfSpan={halfSpan} ink={actual} ghost={predicted} labelPlanes />
            <div className="flex items-center gap-4">
              <ScaleNote halfSpan={halfSpan} size={PANEL} />
              <span className="face-mono t-caption text-ink-mute">
                thin outline = the portable document&apos;s prediction · filled ink = what Revit
                built · dashed = void. Daylight between them IS the disagreement.
              </span>
            </div>
          </>
        ) : (
          <RefusalPanel family={stage.family} size={PANEL} />
        )}

        <div className="flex flex-col gap-1">
          <span className="face-mono t-caption text-ink-mute">
            {shown.length} of {stage.rows.length} claims — everything that is not a plain agreement,
            plus every writable settings key. A cell that refuses the caret says why in its title.
          </span>
          <CompactTable
            rows={shown}
            columns={columns}
            rowKey={(row) => row.key}
            rowTitle={(row) => row.note}
            empty={{
              story: "filter",
              exit: "nothing to reconcile and nothing to write on this family and type",
              children: "every claim agrees and no key is writable",
            }}
          />
        </div>
      </div>
    </div>
  );
}
