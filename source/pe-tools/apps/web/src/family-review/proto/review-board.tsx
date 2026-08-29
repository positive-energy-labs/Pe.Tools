/**
 * The winning review board overlay and reconciliation table.
 */
import { useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { Press } from "#/components/lang/press";
import {
  EMPTY_SCENE,
  VERDICT_LABEL,
  actualScene,
  authoredScene,
  claimEdit,
  editKey,
  feet,
  headline,
  sceneHalfSpan,
  stagedValue,
  uneditableReason,
  type ReviewRow,
} from "#/family-review/model";
import { CompactTable, type CompactColumn } from "#/family-review/proto/compact-table";
import {
  AgreementWord,
  FamilySidebar,
  RefusalPanel,
  TallyChips,
  VerdictStrip,
  type EditDesk,
  type Stage,
  type VerdictBook,
} from "#/family-review/proto/review-board-parts";
import { ScaleNote, Triptych } from "#/family-review/proto/views";
import { token } from "#/lib/token";

export { stages, useEdits, useVerdicts } from "#/family-review/proto/review-board-parts";

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
      cell: (row) => <span>{row.kind}</span>,
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
      cell: (row) => <span>{row.authored}</span>,
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
      cell: (row) => <span>{row.actual}</span>,
    },
    {
      key: "delta",
      label: "worst Δ",
      width: "w-[92px]",
      right: true,
      cell: (row) =>
        row.deviation == null ? (
          <span>—</span>
        ) : row.deviation <= 1e-6 ? (
          <span>·</span>
        ) : (
          <span style={{ color: token("alarm") }}>{feet(row.deviation)}</span>
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
        className="w-72 overflow-y-auto overflow-x-visible"
        style={{ borderColor: token("line") }}
      >
        {board.map((entry) => (
          <div key={entry.key} style={{ borderColor: token("line") }}>
            <div className="flex items-start">
              <div className="min-w-0 flex-1">
                <Press
                  type="button"
                  layout="stack"
                  state={selected === entry.key ? "selected" : "rest"}
                  onClick={() => setSelected(entry.key)}
                >
                  <span>{entry.family.name}</span>
                  <span className="flex items-baseline gap-1.5">
                    <span>{entry.typeName}</span>
                    <AgreementWord agreement={headline(entry.rows)} />
                    {verdicts.get(entry.key) !== "unjudged" ? (
                      <span>{VERDICT_LABEL[verdicts.get(entry.key)]}</span>
                    ) : null}
                  </span>
                </Press>
              </div>
              <Press
                type="button"
                size="sm"
                state="expanded"
                aria-expanded={expanded === entry.key}
                onClick={() => setExpanded(expanded === entry.key ? null : entry.key)}
                title="Show what this family.json declares, and six small drawings of it. For recognising a family, not judging one — judging is the overlay on the right."
              >
                {expanded === entry.key ? "hide" : "open"}
              </Press>
            </div>
            {expanded === entry.key ? (
              <div
                className="z-popup w-64"
                style={{
                  backgroundColor: token("artifact"),
                  border: `0.5px solid ${token("line-2")}`,
                  borderRadius: "var(--radius)",
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
          <span>{stage.family.name}</span>
          <span>{stage.typeName}</span>
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
          <span>this reading came from</span>
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
              <span>
                thin outline = the portable document&apos;s prediction · filled ink = what Revit
                built · dashed = void. Daylight between them IS the disagreement.
              </span>
            </div>
          </>
        ) : (
          <RefusalPanel family={stage.family} size={PANEL} />
        )}

        <div className="flex flex-col gap-1">
          <span>
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
