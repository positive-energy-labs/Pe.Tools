import { useMemo, useState } from "react";
import { Upload } from "lucide-react";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { CellStateKey } from "#/components/lang/cell-key";
import { FactChip, Tag } from "#/components/lang/chip";
import { HelpTip } from "#/components/lang/help";
import { Provenance, Section } from "#/components/lang/section";
import { ActionButton } from "#/components/lang/action-button";
import { Table } from "#/components/master-table/table";
import { TableFrame } from "#/components/master-table/table-frame";
import { useTableState } from "#/components/master-table/view";
import type { Column } from "#/components/master-table/model";
import { Gap } from "#/design-system/exhibit";
import { PARAM_ROWS, ageText, cellProps, type ParamRow } from "#/design-system/specimens-data";

const noop = () => {};

export function RealTable() {
  const [tableState, setTableState] = useTableState();
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const columns = useMemo<Column<ParamRow>[]>(
    () => [
      {
        key: "param",
        label: "parameter",
        title: "The parameter as Revit names it.",
        width: "w-44",
        lock: true,
        sort: (r) => r.param,
        search: (r) => r.param,
        // GAP (Table): `td` is `p-0` and `Column` has no cell-class hook — only
        // `headerClassName`, `width` and `right`. Every renderer must draw its own box model, so
        // cell padding is decided thirteen times per table instead of once by the primitive.
        cell: (r) => <span className="px-1.5 py-1 t-small text-ink">{r.param}</span>,
      },
      {
        key: "scope",
        label: "scope",
        title: "Type-level or instance-level.",
        width: "w-24",
        facet: (r) => r.scope,
        cell: (r) => <span className="px-1.5 py-1 t-small face-mono text-ink-2">{r.scope}</span>,
      },
      {
        key: "value",
        label: "value",
        title:
          "The value, carrying every mark the grammar has to make. Its filter speaks the grammar's own state vocabulary.",
        // THE CELL-STATE CLAUSE (ruled 2026-08-16, discharging the renderer-identity gap): the
        // column declares WHAT IT DRAWS. The table renders StateCell itself, and facet defaults
        // to the grammar's one-word reading — the hand-modelled `state` column this section
        // used to carry is gone because the primitive now reads the cell instead of the caller
        // restating it. Sort stays the VALUE; the filter carries the state.
        state: cellProps,
        sort: (r) => r.value,
        search: (r) => r.value,
      },
      {
        key: "read",
        label: "last read",
        title: "How old the reading behind the value is.",
        width: "w-24",
        right: true,
        sort: (r) => r.ageMin ?? Number.MAX_SAFE_INTEGER,
        cell: (r) => <span className="px-1.5 py-1 t-small face-mono text-ink-2">{ageText(r)}</span>,
      },
    ],
    [],
  );

  return (
    <Section
      label="04 · real table"
      help={
        <HelpTip>
          The product table primitive, unmodified, with the cell grammar as its renderer. Rows never
          grow; click a cell and the readout band under the table speaks its facts. The gap notes
          below are the section's deliverable.
        </HelpTip>
      }
    >
      <h3 className="pt-2 t-head text-ink">The real table</h3>
      <Provenance>
        shipping Table with StateCell as its value renderer · fixture rows are marked in the
        artifact head
      </Provenance>
      <p className="max-w-[80ch] pt-3 t-prose text-ink-2">
        the actual Table — the primitive atlas, takeoffs and families run on — with StateCell as its
        cell renderer
      </p>
      <p className="max-w-[80ch] t-prose text-ink-2">
        The design-lang round hand-rolled its table, so the grammar was only ever proven against
        markup written to flatter it. This is the product primitive, unmodified, wrapped in an{" "}
        <code>ArtifactFrame</code> per the border budget, with the cell-state key inside the frame
        it describes. Sort a column, filter one, type in the search box — the grammar has to survive
        all of it. THE ROW LAW (ruled 2026-08-16): a cell is one clipped line — the value and its
        zero-footprint marks, with the body wash filling the whole cell. Fat rows are never allowed.
        The prose a cell used to carry (refusal reasons, notes, citations, the model&apos;s ghost
        value) reads out in the band under the table when the cell is focused, the way a
        spreadsheet&apos;s formula bar reads out the active cell — click a cell below to see it.
      </p>
      <p className="max-w-[80ch]">
        This table is also the exhibit for two of §01&apos;s laws, because neither can be shown on a
        static specimen. <strong>A filter&apos;s vocabulary is stable under filtering:</strong> the
        facet options come from <code>facetOptions</code> reading ALL rows, never the visible
        subset, so narrowing by scope leaves the value column&apos;s state vocabulary untouched and
        picking an option can always widen back out — at the price of a chosen option resolving to
        zero visible rows, which the empty state says. <strong>Sort by domain order:</strong> a{" "}
        <code>state</code> column that declares no <code>sort</code> falls back to{" "}
        <code>CELL_STATE_ORDER</code> — drift first, locked last — rather than to the alphabet. The
        value column below opts out deliberately: it sorts by the VALUE and lets its facet carry the
        state.
      </p>

      <ArtifactFrame
        head={
          <>
            <Tag>overhead coiling door 421 · parameters</Tag>
            <FactChip title="Rows in scope before any narrowing.">
              {PARAM_ROWS.length} params
            </FactChip>
            <FactChip tone="alarm" title="Values the model disagrees with.">
              2 drift
            </FactChip>
            <FactChip tone="caution" title="Unsaved work that will be lost if you leave.">
              2 unsaved
            </FactChip>
            <FactChip dashed title="Fixture data — no host, no document, no element behind it.">
              fixture
            </FactChip>
          </>
        }
        foot={
          <>
            <Tag>2 unsaved · 1 refused by Revit</Tag>
            <ActionButton
              tone="commit"
              label="apply to Revit"
              icon={Upload}
              onClick={noop}
              disabled
              reason="fixture data — there is no model behind this table to write to"
            />
          </>
        }
      >
        {/* Table is `flex min-h-0 flex-1 flex-col` internally and expects a bounded parent. */}
        <div className="flex h-[26rem] flex-col">
          <TableFrame
            label="params in scope"
            rows={PARAM_ROWS}
            columns={columns}
            rowKey={(r) => r.key}
            state={tableState}
            onStateChange={setTableState}
            summary={<>13 params · 3 types</>}
            searchPlaceholder="search params…"
            selection={{ selected: selectedKeys, onChange: setSelectedKeys }}
          >
            <Table
              rows={PARAM_ROWS}
              columns={columns}
              rowKey={(r) => r.key}
              label="params in scope"
              state={tableState}
              onStateChange={setTableState}
              selection={{ selected: selectedKeys, onChange: setSelectedKeys }}
              // THE OWED MARKER (ruled 2026-08-16, fit reviews): the gutter locates the rows a
              // person must act on — count in the tone's ink, sentence in the title, no verb.
              // The locked param column offsets past it, which is the lock interaction the prop
              // documents, exercised here on purpose.
              gutter={(r) =>
                r.agree === "drift"
                  ? {
                      count: 1,
                      title: "the model disagrees — a person must pick the real value",
                      tone: "alarm",
                    }
                  : r.stage === "staged"
                    ? { count: 1, title: "staged and unsaved — commit or discard before leaving" }
                    : null
              }
            />
          </TableFrame>
        </div>
        {/* GAP (ArtifactFrame): the key belongs "inside the frame of the thing it describes", and
            the only place it fits is last-child-by-authorship. The `foot` slot is a flex control
            bar; a full-width grid block cannot go in it. */}
        <CellStateKey />
      </ArtifactFrame>

      <div className="flex flex-col gap-1.5 pt-1">
        <span className="t-small t-upper text-ink">what Table cannot express</span>
        <Gap>
          <strong>the clause&apos;s residue.</strong> The cell-state clause (ruled 2026-08-16)
          discharged renderer identity, selection-as-hue, the hover law and the two-palette chrome —
          but <code>CellStateKey</code> still cannot derive its axes from the rows on screen, and a
          row holding a proposal is still marked through <code>rowClassName</code>, which knows
          nothing about the grammar. Row-level state is the clause&apos;s unfinished half.
        </Gap>
        <Gap>
          <strong>non-state cells own their own box.</strong> <code>td</code> is <code>p-0</code>;
          the table draws the box model for <code>state</code> columns, but every plain{" "}
          <code>cell</code> renderer still decides padding for itself — decided per column instead
          of once by the primitive.
        </Gap>
        <Gap>
          <strong>two heads, by composition.</strong> Chrome is a wrapper now (
          <code>TableFrame</code>
          ), so this specimen stacks the artifact frame&apos;s head over the table frame&apos;s only
          because it wraps one in the other; a bare <code>Table</code> inside the artifact frame
          would lose the search and chips the frame owns. There is no merged head.
        </Gap>
        <Gap>
          <strong>one chip family now.</strong> The strip&apos;s chips ARE <code>NarrowChip</code>{" "}
          (fit reviews, ruled 2026-08-16 — <code>FilterChip</code> deleted). The honest residue: the
          strip has no per-narrowing denominator, so every chip&apos;s count is rows still in scope
          under ALL active narrowings, not what this one alone admits.
        </Gap>
        <Gap>
          <strong>no footline row.</strong> A receipt has nowhere in the grid: outcomes can only sit
          in the frame foot, outside the columns, so a partial write cannot align its &ldquo;4
          staged&rdquo; to the four rows it means.
        </Gap>
      </div>
    </Section>
  );
}

/* ═══ 06 · satellites ═══════════════════════════════════════════════════════════════════════ */
