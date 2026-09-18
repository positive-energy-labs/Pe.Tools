/** /design-system/cell-select — three editors for one cell value, side by side (ruling 5). */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import type { CellWire } from "#/components/lang/band";
import { FactChip } from "#/components/lang/chip";
import { Section } from "#/components/lang/section";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { MasterTable } from "#/components/master-table/master-table";
import { applyPatches } from "#/design-system/band-matrix";
import {
  parameterColumn,
  STORAGE_CELLS,
  STORAGE_ROWS,
  VARIANTS,
  variantColumn,
} from "#/design-system/cell-select-variants";

export const Route = createFileRoute("/design-system_/cell-select")({ component: CellSelectRoute });

const KEYS: [string, string][] = [
  ["Enter / F2", "open or edit the focused cell"],
  ["type", "filter (B, C) or jump (A)"],
  ["↑ / ↓", "move through the options"],
  ["Enter", "commit — stages the value, like typing a cell"],
  ["Esc", "cancel back to the cell"],
  ["Tab", "the next cell"],
  ["a / d / u", "accept, deny, unstage a proposal, on the focused cell"],
];

function CellSelectRoute() {
  const [cells, setCells] = useState(STORAGE_CELLS);
  const wire = useMemo<CellWire>(
    () => ({
      segment: "cells",
      revision: null,
      write: async (patches) => {
        setCells((current) => applyPatches(current, patches));
        return null;
      },
    }),
    [],
  );
  const columns = useMemo(
    () => [
      parameterColumn,
      ...VARIANTS.map((variant) => variantColumn(variant.key, variant.label, cells, wire)),
    ],
    [cells, wire],
  );

  return (
    <div className="min-h-screen">
      <header className="sticky z-sticky">
        <div className="flex items-center justify-between py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link to="/design-system">← design system</Link>
            <span>cell-select</span>
            <span>one storage-type value, three editors, the same cells</span>
            <FactChip
              dashed
              title="Storage types of the band's Families parameters; a live families matrix replaces it."
            >
              fixture
            </FactChip>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-col gap-8 pt-8 pb-16">
        <Section label="the question">
          <p className="max-w-[86ch] t-prose text-ink-2">
            Each column edits the same value of the same row: a pick in one moves all three. The
            proposal marks and the cell verbs are the one cell grammar; only the editor differs. Kai
            picks one; the others are deleted.
          </p>
          <ul className="t-prose">
            {VARIANTS.map((variant) => (
              <li key={variant.key}>
                <b>{variant.label}</b> — {variant.says}
              </li>
            ))}
          </ul>
        </Section>

        <div className="h-[16rem]">
          <MasterTable
            rows={STORAGE_ROWS}
            columns={columns}
            rowKey={(row) => row.key}
            scopeLabel="parameters"
          />
        </div>

        <Section label="keys (every variant)">
          <dl className="grid max-w-[60ch] grid-cols-[9rem_1fr] gap-x-3 gap-y-1 t-prose">
            {KEYS.map(([key, says]) => (
              <div key={key} className="contents">
                <dt className="face-mono">{key}</dt>
                <dd className="text-ink-2">{says}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </main>
    </div>
  );
}
