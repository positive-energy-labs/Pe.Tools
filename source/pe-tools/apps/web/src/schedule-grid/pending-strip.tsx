import { splitScheduleCellKey } from "@pe/agent-contracts";
import { FactChip } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { Verb } from "#/components/lang/verb";
import { ValueDiff } from "#/components/ui/value-diff";
import { Press } from "#/components/lang/press";
import type { CellState } from "#/schedule-grid/route";

export function PendingStrip({
  pending,
  proposalCount,
  stagedCount,
  attention,
  columnHeader,
  currentText,
  stageValue,
  deny,
  undo,
  locate,
}: {
  pending: [string, CellState][];
  proposalCount: number;
  stagedCount: number;
  attention: number;
  columnHeader: (columnNumber: number) => string;
  currentText: (key: string) => string | null;
  stageValue: (key: string, value: string) => void;
  deny: (key: string) => void;
  undo: (key: string) => void;
  locate: (key: string) => void;
}) {
  return (
    <div className="shrink-0 border-t border-line">
      <div className="flex items-baseline gap-2 border-b border-line px-3 py-1.5">
        <span className="t-caption t-upper text-ink-2">pending</span>

        <HelpTip>
          Every open diff on this schedule, one line each. Pea proposes; approving stages; typing
          over a proposed cell severs the proposal and stages your value instead.
        </HelpTip>
        <FactChip
          tone={proposalCount > 0 ? "pea" : "meta"}
          title="Open pea proposals awaiting your review."
        >
          {proposalCount} proposed
        </FactChip>
        <FactChip
          tone={stagedCount > 0 ? "caution" : "meta"}
          title="Cells staged for the next push."
        >
          {stagedCount} staged
        </FactChip>
        {attention > 0 ? (
          <FactChip tone="caution" title="Flagged staged cells — push refuses while any remain.">
            {attention} need review
          </FactChip>
        ) : null}
      </div>
      <div className="max-h-36 overflow-y-auto">
        {pending.map(([key, cell]) => {
          const { rowNumber, columnNumber } = splitScheduleCellKey(key);
          const isStaged = cell.staged != null;
          const next = isStaged ? (cell.staged?.value ?? "") : String(cell.proposal?.value ?? "");
          return (
            <div
              key={key}
              className="flex items-center gap-3 border-b border-line px-3 py-1 last:border-b-0"
            >
              <Press
                type="button"
                className="flex min-w-0 shrink-0 items-baseline gap-1.5 rounded-sm px-0.5 text-left hover:veil"
                title="Highlight this cell's row in the grid and scroll it into view."
                onClick={() => locate(key)}
              >
                <span className="t-label max-w-44 truncate text-ink">
                  {columnHeader(columnNumber)}
                </span>
                <span className="face-mono t-caption text-ink-2">r{rowNumber}</span>
              </Press>
              <ValueDiff
                from={currentText(key)}
                to={next}
                className={
                  isStaged
                    ? "min-w-0 flex-1 truncate font-bold text-caution"
                    : "min-w-0 flex-1 truncate text-pea-ink"
                }
              />
              {!isStaged && cell.proposal?.note && (
                <span className="t-label hidden max-w-56 truncate text-ink-2 sm:block">
                  {cell.proposal.note}
                </span>
              )}
              <span className="flex shrink-0 items-center gap-1.5">
                {isStaged ? (
                  <Verb
                    label="unstage"
                    reason="Return this cell to its snapshot value. A proposal it was approved from is restored to the open list."
                    onClick={() => undo(key)}
                  />
                ) : (
                  <>
                    <Verb
                      label="deny"
                      reason="Clear pea's proposal for this cell — the snapshot value stands."
                      onClick={() => deny(key)}
                    />
                    <Verb
                      label="approve"
                      reason={`Approve and stage "${String(cell.proposal?.value ?? "")}" for the next push.`}
                      onClick={() => stageValue(key, String(cell.proposal?.value ?? ""))}
                    />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
