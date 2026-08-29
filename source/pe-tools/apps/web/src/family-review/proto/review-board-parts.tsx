/**
 * The review board's staged state, verdict controls, tally, refusal, and library rail.
 */
import { useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import {
  AGREEMENT_LABEL,
  AGREEMENT_TONE,
  EMPTY_SCENE,
  VERDICT_LABEL,
  actualScene,
  authoredScene,
  constituents,
  reviewRows,
  sceneHalfSpan,
  stageEdit,
  tally,
  type Agreement,
  type BoardFamily,
  type EditBook,
  type ReviewRow,
  type Verdict,
} from "#/family-review/model";
import { Triptych } from "#/family-review/proto/views";
import { token } from "#/lib/token";

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
export function VerdictStrip({
  value,
  onPick,
}: {
  value: Verdict;
  onPick: (verdict: Verdict) => void;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="verdict">
      {VERDICT_KEYS.map((verdict) => (
        <Press
          key={verdict}
          type="button"
          tone="bordered"
          size="sm"
          state={value === verdict ? "selected" : "rest"}
          onClick={() => onPick(verdict)}
          title={`Record "${VERDICT_LABEL[verdict]}" for this family and type. Prototype: in memory only — the chrome says where a verdict would go, which is nowhere yet.`}
        >
          {VERDICT_LABEL[verdict]}
        </Press>
      ))}
    </div>
  );
}

export function AgreementWord({ agreement }: { agreement: Agreement }) {
  return <span style={{ color: AGREEMENT_TONE[agreement] }}>{AGREEMENT_LABEL[agreement]}</span>;
}

export function TallyChips({ rows }: { rows: ReviewRow[] }) {
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
export function RefusalPanel({ family, size }: { family: BoardFamily; size: number }) {
  return (
    <div
      className="flex flex-col justify-center gap-1 p-3"
      style={{ width: size * 3 + 16, borderRadius: "var(--radius)", borderColor: token("alarm") }}
    >
      <span style={{ color: token("alarm") }}>{family.refusal?.code ?? "refused"}</span>
      <p className="m-0">{family.refusal?.detail}</p>
      <span>
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
export function FamilySidebar({ stage }: { stage: Stage }) {
  const probe = stage.family.probes[stage.typeName];
  const predicted = probe ? authoredScene(probe) : EMPTY_SCENE;
  const actual = probe ? actualScene(probe) : EMPTY_SCENE;
  const halfSpan = sceneHalfSpan([predicted, actual]);

  return (
    <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
      {probe ? (
        <>
          <div className="flex flex-col gap-0.5">
            <span>family.json · oracle prediction</span>
            <Triptych size={SIDEBAR_PANEL} halfSpan={halfSpan} ink={predicted} captions="short" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span>Revit · runtime probe</span>
            <Triptych size={SIDEBAR_PANEL} halfSpan={halfSpan} ink={actual} captions="short" />
          </div>
        </>
      ) : (
        <span>
          nothing was built, so there is nothing to draw — what the document declares, below, is the
          whole content
        </span>
      )}

      <dl className="m-0 flex flex-col gap-1">
        {constituents(stage.family).map((group) => (
          <div key={group.kind} className="flex flex-col">
            <dt>
              {group.kind} <span>{group.count}</span>
            </dt>
            <dd className="m-0">{group.names.join(" · ")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
