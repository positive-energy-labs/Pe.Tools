import { useRef } from "react";

import { useCellNavigation } from "#/components/master-table/cell-navigation";
import { fmtNum, parseCell, type Verdict, type VerdictTone } from "#/components/master-table/model";
import { cn } from "#/lib/utils";

const CELL_CLASS = "tele h-7 w-full min-w-0 bg-transparent px-1.5 outline-none focus:bg-primary/5";

function BaseCell({
  display,
  onText,
  numeric,
  className,
  placeholder,
  title,
}: {
  display: string;
  onText: (text: string) => void;
  numeric?: boolean;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  const initial = useRef(display);
  const move = useCellNavigation();
  initial.current = display;
  return (
    <input
      key={display}
      defaultValue={display}
      placeholder={placeholder}
      title={title}
      tabIndex={-1}
      inputMode={numeric ? "decimal" : undefined}
      className={cn(CELL_CLASS, numeric && "text-right", className)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (!move?.(e.shiftKey ? "up" : "down")) e.currentTarget.blur();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          move?.(e.key === "ArrowUp" ? "up" : "down");
        } else if (e.key === "Tab") {
          if (move?.(e.shiftKey ? "left" : "right")) e.preventDefault();
        } else if (e.key === "Escape") {
          e.currentTarget.value = initial.current;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const text = e.currentTarget.value;
        if (text !== initial.current) onText(text);
      }}
    />
  );
}

export function TextCell({
  value,
  onCommit,
  className,
  placeholder,
  title,
}: {
  value: string;
  onCommit: (value: string) => void;
  className?: string;
  placeholder?: string;
  title?: string;
}) {
  return (
    <BaseCell
      display={value}
      onText={onCommit}
      className={className}
      placeholder={placeholder}
      title={title}
    />
  );
}

export function NumberCell({
  value,
  onCommit,
  digits = 2,
  integer = false,
  min,
  className,
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
  return (
    <BaseCell
      display={fmtNum(value, digits)}
      numeric
      className={className}
      title={title}
      onText={(text) => {
        const parsed = parseCell(text, { integer, min });
        if (parsed !== null) onCommit(parsed);
      }}
    />
  );
}

export function CellSelect({
  value,
  onChange,
  children,
  invalid,
  className,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  invalid?: boolean;
  className?: string;
  title?: string;
}) {
  const move = useCellNavigation();
  return (
    <select
      value={value}
      title={title}
      tabIndex={-1}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Tab" && move?.(e.shiftKey ? "left" : "right")) e.preventDefault();
      }}
      className={cn(
        "tele h-7 w-full min-w-0 truncate rounded-none border-0 bg-transparent px-1 outline-none focus:bg-primary/5",
        invalid && "bg-destructive/10 text-destructive",
        className,
      )}
    >
      {children}
    </select>
  );
}

/**
 * A cell the user may not edit. `reason` is REQUIRED and surfaces as the title: a value that
 * refuses editing must say why (e.g. "detected area — geometry is edited in Revit").
 */
export function ReadCell({
  value,
  reason,
  className,
}: {
  value: React.ReactNode;
  reason: string;
  className?: string;
}) {
  return (
    <span title={reason} className={cn("tele block truncate px-1.5 tabular-nums", className)}>
      {value}
    </span>
  );
}

/** The verdict swatch. Tone is the NARROW meaning-role union — never a raw CSS colour
 * (takeoffs #11, ruled 2026-08-16 R5; `stateColumn`, which took any string, died with it). */
export function StateDot({ tone, dim }: { tone: VerdictTone; dim?: boolean }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-[1px] align-middle"
      style={{ background: VERDICT_INK[tone], opacity: dim ? 0.35 : 1 }}
    />
  );
}

export const VERDICT_INK: Record<VerdictTone, string> = {
  alarm: "var(--r-alarm)",
  caution: "var(--r-caution)",
  done: "var(--r-done)",
  ink: "var(--r-ink-2)",
  mute: "var(--r-ink-mute)",
};

/** How a `verdict:` column draws — the table calls this itself (master-table.tsx resolve). The
 * WORD wears its tone only at alarm rank (the one alarm must be unmissable); every quieter
 * verdict keeps the word in secondary ink and lets the dot carry the tone. */
export function VerdictCell({ verdict }: { verdict: Verdict }) {
  return (
    <span className="tele block truncate px-1.5" title={verdict.note}>
      <StateDot tone={verdict.tone} dim={verdict.dim} />{" "}
      <span
        className={verdict.tone === "alarm" ? "text-[var(--r-alarm)]" : "text-muted-foreground"}
      >
        {verdict.word}
      </span>
    </span>
  );
}
