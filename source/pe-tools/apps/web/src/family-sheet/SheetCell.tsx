import { Check, Lock, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CellReview, CellState } from "@pe/agent-contracts";

import { useFamilySheet } from "#/family-sheet/store";
import { cn } from "#/lib/utils";

/** Cycle order for the tiny review toggle: none → good → attention → none. */
const NEXT_REVIEW: Record<CellReview, CellReview> = {
  none: "good",
  good: "attention",
  attention: "none",
};

export interface CellFocus {
  key: string;
  pinned: boolean;
}

/**
 * One worksheet cell. Renders the snapshot value, then layers the worksheet
 * trichotomy (proposal → staged → pushed) plus an orthogonal review mark.
 * Read-only / formula-determined cells drop edit affordances but still show
 * proposals (pea can propose a formula change).
 */
export function SheetCell({
  cellKey,
  snapshotValue,
  cell,
  readOnly,
  focused,
  onFocus,
  onBlur,
  onPin,
}: {
  cellKey: string;
  snapshotValue: string;
  cell: CellState | undefined;
  readOnly: boolean;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  onPin: () => void;
}) {
  const store = useFamilySheet();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const proposal = cell?.proposal ?? null;
  const staged = cell?.staged ?? null;
  const review = cell?.review ?? "none";
  const hasOpenProposal = proposal != null && staged == null;
  const isStaged = staged != null;
  const groundable = proposal?.source != null;

  // display value: staged wins, else open-proposal value, else snapshot
  const display = isStaged ? staged : hasOpenProposal ? proposal.value : snapshotValue;
  const showOld = (hasOpenProposal || isStaged) && snapshotValue && snapshotValue !== display;

  const commitEdit = () => {
    setEditing(false);
    if (draft !== staged) store.stageEdit(cellKey, draft);
  };

  return (
    <td
      className={cn(
        "group/cell relative h-8 border-b border-[var(--line-soft)] border-l border-l-[var(--line-soft)] px-2 align-middle",
        groundable && "cursor-pointer",
      )}
      onMouseEnter={groundable ? onFocus : undefined}
      onMouseLeave={groundable ? onBlur : undefined}
      onClick={() => {
        if (groundable) onPin();
      }}
      style={cellBackground(review, hasOpenProposal, isStaged, focused)}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={cellBorder(review, hasOpenProposal, isStaged, focused)}
      />

      <div className="relative flex items-center gap-1.5">
        {readOnly && (
          <Lock className="size-2.5 shrink-0 text-muted-foreground/60" aria-label="read-only" />
        )}

        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              else if (e.key === "Escape") setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded-sm border border-[var(--pea-line)] bg-card px-1 py-0.5 text-[12px] tabular-nums outline-none focus:border-[var(--pe-green)]"
          />
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate whitespace-nowrap text-[12px] tabular-nums",
              readOnly && !hasOpenProposal && "text-muted-foreground",
              !display && "text-muted-foreground/40",
            )}
            title={display || undefined}
            onClick={(e) => {
              // clicking a staged cell opens inline edit
              if (isStaged && !readOnly) {
                e.stopPropagation();
                setDraft(staged);
                setEditing(true);
              }
            }}
          >
            {showOld && (
              <span className="mr-1 text-[10px] text-muted-foreground/60 line-through">
                {snapshotValue}
              </span>
            )}
            {display || "—"}
          </span>
        )}

        {/* low-confidence clay dot on open proposals */}
        {hasOpenProposal && proposal.confidence === "low" && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-[var(--cat-clay)]"
            title={proposal.note ?? "low confidence"}
          />
        )}

        {/* review corner mark */}
        <ReviewMark review={review} onCycle={() => store.setReview(cellKey, NEXT_REVIEW[review])} />

        {/* accept / reject affordances — hover only, open proposals only */}
        {hasOpenProposal && !editing && (
          <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover/cell:flex">
            <button
              type="button"
              title="accept"
              onClick={(e) => {
                e.stopPropagation();
                store.acceptProposal(cellKey);
              }}
              className="grid size-4 place-items-center rounded-sm text-[var(--cat-green)] hover:bg-[var(--pea-tint)]"
            >
              <Check className="size-3" />
            </button>
            <button
              type="button"
              title="reject"
              onClick={(e) => {
                e.stopPropagation();
                store.rejectProposal(cellKey);
              }}
              className="grid size-4 place-items-center rounded-sm text-[var(--cat-clay)] hover:bg-[color-mix(in_srgb,var(--cat-clay)_14%,transparent)]"
            >
              <X className="size-3" />
            </button>
          </span>
        )}

        {/* staged: a clear affordance to unstage */}
        {isStaged && !editing && (
          <button
            type="button"
            title="unstage"
            onClick={(e) => {
              e.stopPropagation();
              store.clearStaged(cellKey);
            }}
            className="ml-auto hidden size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-muted group-hover/cell:grid"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
    </td>
  );
}

function ReviewMark({ review, onCycle }: { review: CellReview; onCycle: () => void }) {
  if (review === "none") {
    // invisible until hover — a quiet handle to start reviewing
    return (
      <button
        type="button"
        title="mark reviewed"
        onClick={(e) => {
          e.stopPropagation();
          onCycle();
        }}
        className="hidden size-2.5 shrink-0 rounded-full border border-[var(--line-2)] group-hover/cell:block"
      />
    );
  }
  const good = review === "good";
  return (
    <button
      type="button"
      title={good ? "reviewed · good (click to flag)" : "needs attention (click to clear)"}
      onClick={(e) => {
        e.stopPropagation();
        onCycle();
      }}
      className="grid size-3.5 shrink-0 place-items-center rounded-full"
      style={{
        background: good
          ? "color-mix(in srgb, var(--cat-green) 22%, transparent)"
          : "color-mix(in srgb, var(--cat-clay) 26%, transparent)",
        color: good ? "var(--cat-green)" : "var(--cat-clay)",
      }}
    >
      {good ? <Check className="size-2.5" /> : <span className="text-[9px] font-bold">!</span>}
    </button>
  );
}

/* ── visual layering ──────────────────────────────────────────────────────── */

function cellBackground(
  review: CellReview,
  openProposal: boolean,
  staged: boolean,
  focused: boolean,
): React.CSSProperties {
  if (review === "attention") {
    return { background: "color-mix(in srgb, var(--cat-clay) 12%, transparent)" };
  }
  if (focused) return { background: "color-mix(in srgb, var(--pe-blue) 10%, transparent)" };
  if (staged) return { background: "color-mix(in srgb, var(--pe-green) 8%, transparent)" };
  if (openProposal) return { background: "var(--pea-tint)" };
  return {};
}

function cellBorder(
  review: CellReview,
  openProposal: boolean,
  staged: boolean,
  focused: boolean,
): React.CSSProperties {
  if (review === "attention") {
    return { boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--cat-clay) 55%, transparent)" };
  }
  if (staged) {
    return { boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--pe-green) 70%, transparent)" };
  }
  if (openProposal) {
    // dashed pea-line — an outline element so we can dash it
    return {
      border: "1.5px dashed var(--pea-line)",
      borderRadius: 2,
    };
  }
  if (focused) {
    return { boxShadow: "inset 0 0 0 1.5px color-mix(in srgb, var(--pe-blue) 40%, transparent)" };
  }
  return {};
}
