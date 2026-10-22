import { ArrowDown, ArrowUp } from "lucide-react";

/** A sorted column's direction glyph with its rank as a superscript, beside the column title. */
export function SortMark({
  direction,
  rank,
  count,
}: {
  direction: "asc" | "desc";
  rank: number;
  count: number;
}) {
  const Glyph = direction === "desc" ? ArrowDown : ArrowUp;
  return (
    <sup className="relative -top-0.5 inline-flex shrink-0 items-center text-ink">
      <Glyph
        aria-label={direction === "asc" ? "sorted ascending" : "sorted descending"}
        className="size-2.5"
      />
      {count > 1 && <span className="face-mono text-ink-2">{rank + 1}</span>}
    </sup>
  );
}
