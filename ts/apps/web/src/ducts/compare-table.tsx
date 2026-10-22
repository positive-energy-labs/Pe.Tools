/**
 * The tutorial's comparison: Pe against native Revit and Naviate, one row per feature. Notes stay
 * short; the evidence behind a cell is its hover. Data: `@pe/agent-contracts/ducts-guide`.
 */
import { TooltipHint } from "@pe/kit/lang/tooltip";
import {
  DUCTS_COMPARE,
  onPeRoadmap,
  type DuctsCompareCell,
  type DuctsCompareRow,
  type DuctsProduct,
} from "@pe/agent-contracts/ducts-guide";

const MARK: Record<DuctsCompareCell["mark"], { glyph: string; tone?: string; word: string }> = {
  yes: { glyph: "✓", tone: "done", word: "ships" },
  partial: { glyph: "◐", tone: "caution", word: "partial" },
  owed: { glyph: "○", tone: "nav", word: "owed" },
  no: { glyph: "—", word: "not there" },
};

const PRODUCTS: [DuctsProduct, string][] = [
  ["revit", "Revit"],
  ["naviate", "Naviate HVAC&P"],
  ["pe", "Pe"],
];

function Cell({ row, product }: { row: DuctsCompareRow; product: DuctsProduct }) {
  const cell = row[product];
  const mark = MARK[cell.mark];
  const leads = row.lead?.includes(product);
  return (
    <TooltipHint content={cell.detail}>
      <span
        className={`flex gap-1.5 ${leads ? "font-medium" : "text-ink-mute"} ${cell.detail ? "underline decoration-dotted" : ""}`}
        tabIndex={cell.detail ? 0 : undefined}
        data-lead={leads || undefined}
      >
        <span data-tone={mark.tone} aria-label={mark.word} className="w-3 shrink-0 text-center">
          {mark.glyph}
        </span>
        <span>
          {cell.note}
          {product === "pe" && onPeRoadmap(row) ? (
            <span data-tone="nav" data-wash className="ml-1 rounded-sm px-1 t-small">
              roadmap
            </span>
          ) : null}
          {product === "pe" && row.unproven ? (
            <span className="ml-1 rounded-sm border border-dashed px-1 t-small text-ink-mute">
              unproven
            </span>
          ) : null}
        </span>
      </span>
    </TooltipHint>
  );
}

export function CompareTable() {
  return (
    <div className="grid grid-cols-[11rem_1fr_1fr_1fr] gap-x-3 gap-y-1.5 t-small">
      <span />
      {PRODUCTS.map(([key, name]) => (
        <b key={key}>{name}</b>
      ))}
      {DUCTS_COMPARE.map(({ group, rows }) => (
        <div key={group} className="contents">
          <h4 className="col-span-4 m-0 mt-2 border-b">{group}</h4>
          {rows.map((row) => (
            <div key={row.feature} className="contents">
              <b>{row.feature}</b>
              {PRODUCTS.map(([key]) => (
                <Cell key={key} row={row} product={key} />
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
