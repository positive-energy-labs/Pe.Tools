import type { ReactNode } from "react";
import { Check, RotateCcw, X } from "lucide-react";

import { type CellReview, cellSummary, stagedEntries } from "@pe/agent-contracts";

import { Verb } from "#/components/lang/verb";
import type { RouteStateHandle } from "./route-state";

export interface ReviewerCell {
  proposal?: {
    value?: unknown;
    delete?: true;
    confidence?: "high" | "low" | null;
    note?: string | null;
  } | null;
  staged?: { value?: unknown; delete?: true } | null;
  review: CellReview;
}

export interface CellTrichotomyReviewerProps {
  state: RouteStateHandle<unknown>;
  segment: string;
  cells: Record<string, ReviewerCell>;
  commitCommand: string;
  commitLabel: (stagedCount: number) => string;
  reviewHint: string;
  renderLabel: (key: string, cell: ReviewerCell) => ReactNode;
  renderValue?: (value: unknown, key: string, cell: ReviewerCell) => ReactNode;
}

export function CellTrichotomyReviewer({
  state,
  segment,
  cells,
  commitCommand,
  commitLabel,
  reviewHint,
  renderLabel,
  renderValue = defaultRenderValue,
}: CellTrichotomyReviewerProps) {
  const items = Object.entries(cells).filter(
    ([, cell]) => cell.proposal != null || cell.staged != null,
  );
  const summary = cellSummary(cells);
  const stagedCount = stagedEntries(cells).length;
  const canCommit =
    stagedCount > 0 && stagedEntries(cells).every(([, cell]) => cell.review !== "attention");

  const approve = (key: string, cell: ReviewerCell) =>
    void state
      .apply([
        {
          path: [segment, key, "staged"],
          value:
            cell.proposal != null && "delete" in cell.proposal && cell.proposal.delete === true
              ? { delete: true }
              : { value: cell.proposal?.value },
        },
        { path: [segment, key, "review"], value: "good" },
      ])
      .catch(() => undefined);
  const deny = (key: string) =>
    void state
      .apply([
        { path: [segment, key, "proposal"] },
        { path: [segment, key, "review"], value: "none" },
      ])
      .catch(() => undefined);
  const undo = (key: string) =>
    void state
      .apply([
        { path: [segment, key, "staged"] },
        { path: [segment, key, "review"], value: "none" },
      ])
      .catch(() => undefined);

  return (
    <div className="mt-1.5 w-full">
      <div className="max-h-64 overflow-y-auto">
        {items.map(([key, cell]) => {
          const staged = cell.staged != null;
          return (
            <div key={key} className="flex min-h-12 items-center gap-2 py-1.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="truncate">{renderLabel(key, cell)}</div>
                <div className="truncate">
                  {renderValue(staged ? cell.staged?.value : cell.proposal?.value, key, cell)}
                </div>

                {!staged && (cell.proposal?.confidence || cell.proposal?.note) ? (
                  <div className="truncate">
                    {[cell.proposal.confidence, cell.proposal.note].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
              </div>
              {staged ? (
                <Verb
                  label="Undo"
                  icon={RotateCcw}
                  disabled={state.busy != null}
                  reason="Unstage this value and reopen pea's proposal for review"
                  onClick={() => undo(key)}
                />
              ) : (
                <div className="flex shrink-0 gap-1">
                  <Verb
                    label="Deny"
                    icon={X}
                    disabled={state.busy != null}
                    reason="Drop pea's proposal — the current value stands"
                    onClick={() => deny(key)}
                  />
                  <Verb
                    label="Approve"
                    icon={Check}
                    disabled={state.busy != null || !cell.proposal}
                    reason="Stage pea's proposal — nothing leaves the page until you commit"
                    onClick={() => approve(key, cell)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-1.5">
        <span className="min-w-0 truncate">
          {state.failure?.message ??
            (summary.attention > 0
              ? `${summary.attention} value${summary.attention === 1 ? " needs" : "s need"} review`
              : reviewHint)}
        </span>

        <Verb
          tone="commit"
          label={commitLabel(stagedCount)}
          icon={Check}
          disabled={!canCommit || state.busy != null}
          reason={
            !canCommit
              ? stagedCount === 0
                ? "Nothing staged yet — approve a proposal first"
                : "Blocked: staged values still need review"
              : "Write every staged value through — this leaves the page"
          }
          onClick={() => void state.command(commitCommand).catch(() => undefined)}
        />
      </div>
    </div>
  );
}

function defaultRenderValue(value: unknown): ReactNode {
  return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
}
