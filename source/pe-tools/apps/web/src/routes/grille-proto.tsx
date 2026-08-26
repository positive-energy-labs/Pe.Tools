/**
 * /grille-proto — THROWAWAY. find-the-product round 1: the CUSTOM WOOD FLOOR GRILLE calculator.
 *
 * THE QUESTION: the team sizes grilles in `PE Custom Wood Floor Grille Calculator.xlsx` — a row per
 * candidate profile, free area falling out of opening width × count × borders. What is the product
 * that carries that math and shows the grille while you edit it?
 *
 *   A · SHEET          the spreadsheet kept honest: rows, live derived columns, a thumbnail per row.
 *   B · DRAWING-AS-FORM one grille drawn big; dimension lines are the inputs; drag an opening edge.
 *   C · TARGET-FIRST   overreach: name the free area you need, see every profile that gets there.
 *
 * All three edit the SAME in-memory rows seeded from the sheet's six. `?variant=a|b|c`. Dies with the
 * round; the winner is rewritten to canon, the losers never reach main.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { VariantA } from "#/grille-proto/a";
import { VariantB } from "#/grille-proto/b";
import { VariantC } from "#/grille-proto/c";
import { type GrilleInput, SHEET_ROWS } from "#/grille-proto/math";
import { VariantSwitcher } from "#/param-tables/proto/switcher";

const VARIANTS = [
  { key: "a", name: "Sheet — rows, live columns, thumbnails" },
  { key: "b", name: "Drawing-as-form — type on the picture" },
  { key: "c", name: "Target-first — name the free area, pick a profile" },
];

export const Route = createFileRoute("/grille-proto")({
  validateSearch: (search: Record<string, unknown>): { variant: string } => ({
    variant: typeof search.variant === "string" ? search.variant : "a",
  }),
  component: GrilleProto,
});

function GrilleProto() {
  const { variant } = Route.useSearch();
  const navigate = useNavigate();
  const [rows, setRows] = useState<GrilleInput[]>(SHEET_ROWS);
  // B and C work on the first row; "use this" in C writes back into it so A/B see the pick.
  const first = rows[0] ?? SHEET_ROWS[0]!;
  const setFirst = (p: Partial<GrilleInput>) =>
    setRows(
      rows.length ? rows.map((r, i) => (i === 0 ? { ...r, ...p } : r)) : [{ ...first, ...p }],
    );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <header
        className="flex flex-wrap items-baseline gap-2 border-b px-3 py-2"
        style={{ borderColor: "var(--r-line)" }}
      >
        <span className="face-mono t-label t-upper text-[var(--r-ink-mute)]">
          wood floor grille
        </span>
        <span className="t-value text-[var(--r-ink)]">free area calculator</span>
        <FactChip
          tone="caution"
          dashed
          title="Seeded from the six rows of PE Custom Wood Floor Grille Calculator.xlsx. Edits live in memory for this page view and are written nowhere."
        >
          xlsx rows · in memory · writes nowhere
        </FactChip>
        <button
          type="button"
          className="face-mono text-[11px] text-[var(--r-ink-mute)] underline"
          onClick={() => setRows(SHEET_ROWS)}
        >
          reset
        </button>
      </header>
      {variant === "a" && <VariantA rows={rows} setRows={setRows} />}
      {variant === "b" && <VariantB g0={first} set={setFirst} />}
      {variant === "c" && <VariantC base={first} set={setFirst} />}
      <VariantSwitcher
        variants={VARIANTS}
        current={variant}
        onSelect={(key) => navigate({ to: "/grille-proto", search: { variant: key } })}
      />
    </div>
  );
}
