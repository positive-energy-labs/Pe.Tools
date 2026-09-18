/** /design-system/band — one proposal language over a Families matrix: every verb is the cell's. */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ActionButton } from "#/components/lang/action-button";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { reviewCommit, WorkBand } from "#/components/lang/band";
import { FactChip } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Section } from "#/components/lang/section";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { MasterTable } from "#/components/master-table/master-table";
import { applyPatches, MATRIX, MATRIX_CELLS } from "#/design-system/band-matrix";
import {
  AskHead,
  BandGaps,
  discardAll,
  matrixColumns,
  matrixRows,
  TypeForm,
  type Ask,
  type Write,
} from "#/design-system/band-specimen";
import { Gap } from "#/design-system/exhibit";
import { SituationCell } from "#/route/situation";

export const Route = createFileRoute("/design-system_/band")({ component: BandRoute });

function BandRoute() {
  const [cells, setCells] = useState(MATRIX_CELLS);
  const [picked, setPicked] = useState("HP-2");
  const [ask, setAsk] = useState<Ask>("live");
  const [planned, setPlanned] = useState<number | null>(null);
  const write: Write = async (patches) => {
    setCells((current) => applyPatches(current, patches));
    return null;
  };
  const columns = useMemo(() => matrixColumns(write), []);
  const rows = useMemo(() => matrixRows(cells), [cells]);
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
              <WorkBand
                count={staged}
                noun="cell"
                revision={null}
                visible
                discard={() => void discardAll(cells, write)}
                commit={reviewCommit(`plan ${staged} staged · SIMULATED`, staged, () =>
                  setPlanned(staged),
                )}
              />
              <div className="h-[26rem]">
                <MasterTable
                  rows={rows}
                  columns={columns}
                  rowKey={(r) => r.key}
                  scopeLabel="family types"
                  searchPlaceholder="search families, types, values…"
                  activeKey={picked}
                  onRowClick={(r) => setPicked(r.key)}
                />
              </div>
              {planned != null ? (
                <OutcomeLine
                  kind="advisory"
                  label={`SIMULATED · plan of ${planned} staged cells`}
                  says="the fixture writes nothing"
                />
              ) : null}
            </Section>

            <Section label="03 · form field · the same cells at card scale">
              <p className="t-prose text-ink-2">
                The picked table row as a spec-editor form. Its verbs are the same transitions over
                the same addresses: accept here and the table cell changes.
              </p>
              <TypeForm row={row} cells={cells} write={write} />
            </Section>
          </div>

          <Section label="02 · chat scale">
            <ArtifactFrame
              head={
                <span className="flex items-baseline gap-2">
                  <b>Pea</b> in Families on MEP Coordination.rvt
                </span>
              }
            >
              <div className="flex flex-col px-3 py-2">
                <AskHead ask={ask} resolve={setAsk} />
                <Gap>
                  <strong>Owed:</strong> chat summary from <code>summarize()</code> — contract SHA
                  pending.
                </Gap>
              </div>
            </ArtifactFrame>
            <div className="flex flex-wrap items-baseline gap-3 pt-2">
              <ActionButton
                label="end turn · SIMULATED"
                reason="Ends Pea's turn; its awaiting ask expires with it"
                disabled={ask !== "live"}
                onClick={() => setAsk("expired")}
              />
              <span className="t-small text-ink-2">
                Ruled: an ask lives as long as its awaiting turn. Turn end, cancel and host restart
                expire it; navigation and reload do not.
              </span>
            </div>
          </Section>
        </div>

        <BandGaps />
      </main>
    </div>
  );
}
