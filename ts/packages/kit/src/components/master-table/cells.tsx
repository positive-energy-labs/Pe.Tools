import type { Tone } from "../../lib/token";
/** Table cells render the shared language primitives. */
import { useCellNavigation } from "./cell-navigation";
import { StateCell, fmtNum } from "../lang/cell";
import type { Verdict } from "./model";
import { tokenRef } from "../../lib/token";
import { cn } from "../../lib/utils";
import { TooltipHint } from "../lang/tooltip";

export function TextCell({
  value,
  onCommit,
  placeholder,
  title,
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  const move = useCellNavigation();
  return (
    <StateCell
      scale="row"
      value={value}
      placeholder={placeholder}
      note={title}
      onCommit={onCommit}
      onNavigate={(direction) => move?.(direction) ?? false}
    />
  );
}

export function NumberCell({
  value,
  onCommit,
  digits = 2,
  integer = false,
  min,
  title,
}: {
  value: number;
  onCommit: (value: number) => void;
  digits?: number;
  integer?: boolean;
  min?: number;
  className?: string;
  title?: string;
}) {
  const move = useCellNavigation();
  return (
    <StateCell
      scale="row"
      value={fmtNum(value, digits)}
      numeric={{ integer, min, digits }}
      note={title}
      // `numeric` already parsed, clamped and normalized — a refused parse never reaches here.
      onCommit={(text) => onCommit(Number(text))}
      onNavigate={(direction) => move?.(direction) ?? false}
    />
  );
}

/**
 * A cell the user may not edit. `reason` surfaces as the title — a value that refuses editing
 * should say why (e.g. "detected area — geometry is edited in Revit"). OPTIONAL since the fit
 * reviews (ruled 2026-08-16): requiring it farmed ceremony on identity columns ("a tooltip
 * that tells you what a table is"); supply it where the refusal is a fact worth stating.
 */
export function ReadCell({
  value,
  reason,
  className,
  "data-tone": dataTone,
}: {
  value: React.ReactNode;
  reason?: string;
  className?: string;
  "data-tone"?: Tone;
}) {
  return (
    <TooltipHint content={reason}>
      <span
        className={cn("face-mono block truncate px-(--item-pad-x)", className)}
        data-tone={dataTone}
      >
        {value}
      </span>
    </TooltipHint>
  );
}

/** The verdict swatch. Tone is the NARROW meaning-role union — never a raw CSS colour
 * (takeoffs #11, ruled 2026-08-16 R5; `stateColumn`, which took any string, died with it). */
export function StateDot({ tone, dim, bar }: { tone?: Tone; dim?: boolean; bar?: boolean }) {
  return (
    <span
      className={
        bar ? "h-full min-w-0 flex-1" : "inline-block size-2 shrink-0 rounded-[1px] align-middle"
      }
      style={{
        backgroundColor: verdictInk(tone),
        opacity: dim ? 0.35 : 1,
      }}
    />
  );
}

/** Unmarked verdicts stay neutral; CSS resolves all six meaning tokens. */
export const verdictInk = (tone?: Tone): string => tokenRef(tone ?? "ink-2");

/** How a `verdict:` column draws — the table calls this itself (master-table.tsx resolve). The
 * WORD wears its tone only at alarm rank (the one alarm must be unmissable); every quieter
 * verdict keeps the word in secondary ink and lets the dot carry the tone. */
export function VerdictCell({ verdict }: { verdict: Verdict }) {
  return (
    <TooltipHint content={verdict.note}>
      <span className="face-mono block truncate px-(--item-pad-x)">
        <StateDot tone={verdict.tone} dim={verdict.dim} />{" "}
        <span
          className={verdict.tone === "alarm" ? undefined : "text-ink-2"}
          data-tone={verdict.tone === "alarm" ? "alarm" : undefined}
        >
          {verdict.word}
        </span>
      </span>
    </TooltipHint>
  );
}
