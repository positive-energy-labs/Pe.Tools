import { splitScheduleCellKey } from "@pe/agent-contracts";
import { ReviewRow, type CellWire } from "#/components/lang/band";
import { FactChip } from "#/components/lang/chip";
import { StateCell } from "#/components/lang/cell";
import { HelpTip } from "#/components/lang/help";
import { Section } from "#/components/lang/section";
import { ValueDiff } from "#/components/lang/value-diff";
import { Press } from "#/components/lang/press";
import type { ScheduleGridDocument } from "@pe/agent-contracts";

type CellState = NonNullable<ScheduleGridDocument["cells"][string]>;

/** Every open diff on the schedule, one ReviewRow each: the grid cell's own verbs, findable. */
export function PendingStrip({
  pending,
  proposalCount,
  stagedCount,
  wire,
  columnHeader,
  currentText,
  locate,
}: {
  pending: [string, CellState][];
  proposalCount: number;
  stagedCount: number;
  wire: CellWire;
  columnHeader: (columnNumber: number) => string;
  currentText: (key: string) => string | null;
  locate: (key: string) => void;
}) {
  return (
    <div className="shrink-0 px-3 py-1.5">
      <Section
        label="pending"
        help={
          <HelpTip>
            Every open diff on this schedule, one line each, with the same verbs as its grid cell.
            Pea proposes; accepting stages; typing over a proposed cell severs the proposal and
            stages your value instead.
          </HelpTip>
        }
        aside={
          <>
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
          </>
        }
      >
        <div className="max-h-36 overflow-y-auto px-3" aria-label="pending cells" role="list">
          {pending.map(([key, cell]) => {
            const { rowNumber, columnNumber } = splitScheduleCellKey(key);
            const next =
              cell.staged != null ? cell.staged.value : String(cell.proposal?.value ?? "");
            const lock = wire.lockOf?.(key) ?? null;
            return (
              <div key={key} role="listitem">
                <ReviewRow
                  wire={wire}
                  address={key}
                  cell={cell}
                  label={
                    <Press
                      type="button"
                      tone="quiet"
                      title="Highlight this cell's row in the grid and scroll it into view."
                      onClick={() => locate(key)}
                    >
                      <StateCell scale="row" value={columnHeader(columnNumber)} />
                      <StateCell scale="row" value={`r${rowNumber}`} />
                    </Press>
                  }
                  facts={{
                    value: <ValueDiff from={currentText(key)} to={next} />,
                    cap: lock ? "locked" : "editable",
                    capReason: lock ?? undefined,
                  }}
                />
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
