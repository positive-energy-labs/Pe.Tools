/** /design-system/band — one proposal language over a Families matrix: every verb is the cell's. */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ActionButton } from "#/components/lang/action-button";
import { fanOutWord, WorkSentence, workSummary, type FanOutOutcome } from "#/components/lang/band";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Section } from "#/components/lang/section";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { useTableState } from "#/components/master-table/view";
import { applyPatches, MATRIX, MATRIX_CELLS } from "#/design-system/band-matrix";
import {
  ChatScale,
  BandGaps,
  acceptVoltage,
  MATRIX_COLUMNS,
  matrixRows,
  matrixGroupOf,
  matrixWire,
  TypeForm,
  type Ask,
  type Matrix,
} from "#/design-system/band-specimen";
import { StaleSection } from "#/design-system/stale-specimen";
import { SituationCell } from "#/route/situation-marks";

export const Route = createFileRoute("/design-system_/band")({ component: BandRoute });

function BandRoute() {
  const [tableState, setTableState] = useTableState();
  const [cells, setCells] = useState(MATRIX_CELLS);
  const [picked, setPicked] = useState("HP-2");
  const [ask, setAsk] = useState<Ask>("live");
  const [said, say] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<FanOutOutcome | null>(null);
  const wire = useMemo(
    () =>
      matrixWire(async (patches) => {
        setOutcome(null);
        setCells((current) => applyPatches(current, patches));
        return null;
      }),
    [],
  );
  const matrix: Matrix = { cells, wire, outcome };
  const aggregate = (run: Promise<FanOutOutcome>) => void run.then(setOutcome);
  const rows = useMemo(() => matrixRows(matrix), [cells, outcome]);
  const view = {
    rows,
    columns: MATRIX_COLUMNS,
    rowKey: (r: (typeof rows)[number]) => r.key,
    label: "family types",
    state: tableState,
    onStateChange: setTableState,
  };
  const staged = Object.values(cells).filter((cell) => cell.staged != null).length;
  const row = MATRIX.find((r) => r.key === picked) ?? MATRIX[0]!;

  return (
    <div className="min-h-screen">
      <header className="sticky z-sticky">
        <div className="flex items-center justify-between py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link to="/design-system">← design system</Link>
            <span>band</span>
            <span>approve and deny are the cell&apos;s own transitions, at every scale</span>
            <FactChip
              dashed
              title="Families demo seeds grown to 6×3×8; a live families matrix reading replaces it."
            >
              fixture
            </FactChip>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-col gap-10 pt-8 pb-16">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-8">
            <Section label="01 · route scale · the matrix">
              <p className="t-prose text-ink-2">
                Reviewing Mechanical Equipment in{" "}
                <SituationCell io="rw">MEP Coordination.rvt</SituationCell>. Hover or focus a cell
                for its verbs; on a focused cell <b>a</b> accepts, <b>d</b> denies, <b>u</b>{" "}
                unstages, typing stages.
              </p>
              <WorkSentence
                summary={workSummary(cells, { groupOf: matrixGroupOf }, ["parameter", "family"])}
                cells={cells}
                wire={wire}
                commit={
                  <ActionButton
                    label="plan · SIMULATED"
                    reason="Plan the staged cells; the fixture writes nothing"
                    onClick={() => say(`SIMULATED · plan of ${staged} staged cells`)}
                  />
                }
              />
              <div className="h-[26rem]">
                <TableFrame
                  {...view}
                  searchPlaceholder="search families, types, values…"
                  actions={
                    <ActionButton
                      tone="agent"
                      label="accept all · Voltage"
                      reason="Accept every standing Voltage proposal in one write; your own staged values are skipped"
                      onClick={() => aggregate(acceptVoltage(matrix))}
                    />
                  }
                >
                  <Table {...view} activeKey={picked} onRowClick={(r) => setPicked(r.key)} />
                </TableFrame>
              </div>
              {outcome ? (
                <OutcomeLine
                  kind={outcome.refusal ? "refused" : "receipt"}
                  label={fanOutWord(outcome)}
                  says="one write through fanOut"
                />
              ) : null}
              {said ? (
                <OutcomeLine kind="advisory" label={said} says="the fixture writes nothing" />
              ) : null}
            </Section>
            <StaleSection say={say} />
            <Section label="03 · form field · the same cells at card scale">
              <p className="t-prose text-ink-2">
                The picked table row as a spec-editor form. Its verbs are the same transitions over
                the same addresses: accept here and the table cell changes.
              </p>
              <TypeForm row={row} matrix={matrix} />
            </Section>
          </div>

          <ChatScale ask={ask} setAsk={setAsk} matrix={matrix} say={say} />
        </div>

        <BandGaps />
      </main>
    </div>
  );
}
