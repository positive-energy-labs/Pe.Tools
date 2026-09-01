import type { ReactNode } from "react";
import { Check, RotateCcw, X } from "lucide-react";

import { stagedEntries } from "@pe/agent-contracts";

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
  const stagedCount = stagedEntries(cells).length;
  // Staging IS the human's approval (ruled 2026-08-31): no review gate stands between it and commit.
  const canCommit = stagedCount > 0;

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
      ])
      .catch(() => undefined);
  const deny = (key: string) =>
    void state.apply([{ path: [segment, key, "proposal"] }]).catch(() => undefined);
  const undo = (key: string) =>
    void state.apply([{ path: [segment, key, "staged"] }]).catch(() => undefined);

  return (
    <div className="mt-1.5 w-full">
      <div className="max-h-64 overflow-y-auto">
        {items.map(([key, cell]) => {
          const staged = cell.staged != null;
          return (
            <div key={key} className="flex min-h-12 items-center gap-2 py-1.5">
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
        <span className="min-w-0 truncate">{state.failure?.message ?? reviewHint}</span>

        <Verb
          tone="commit"
          label={commitLabel(stagedCount)}
          icon={Check}
          disabled={!canCommit || state.busy != null}
          reason={
            !canCommit
              ? "Nothing staged yet — approve a proposal first"
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
