import { useRef } from "react";

import { useCellNavigation } from "#/components/master-table/cell-navigation";
import { fmtNum, parseCell, type Column } from "#/components/master-table/model";
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

/** The state/verdict swatch — one hue budget: clay alarms, green is done, the rest is quiet. */
export function StateDot({ tone, dim }: { tone: string; dim?: boolean }) {
  return (
    <span
      className="inline-block size-2 shrink-0 rounded-[1px] align-middle"
      style={{ background: tone, opacity: dim ? 0.35 : 1 }}
    />
  );
}

/** What a row's state/verdict column shows. `note` is the cell title — say what the state MEANS. */
export interface StateMeta {
  label: string;
  /** CSS colour, e.g. "var(--cat-clay)". */
  tone: string;
  note: string;
  /** Clay-inked: this row is the one asking for a human. */
  alarm?: boolean;
  dim?: boolean;
}

/**
 * The state/verdict column slot: a dot + label whose vocabulary the route owns. Filterable and
 * sortable on the state's label, so "show me only what needs a call" is one select away.
 */
export function stateColumn<Row>({
  key = "state",
  label = "state",
  title,
  of,
}: {
  key?: string;
  label?: string;
  title?: string;
  of: (row: Row) => StateMeta;
}): Column<Row> {
  return {
    key,
    label,
    title,
    facet: (row) => of(row).label,
    sort: (row) => of(row).label,
    cell: (row) => {
      const meta = of(row);
      return (
        <span className="tele block truncate px-1.5" title={meta.note}>
          <StateDot tone={meta.tone} dim={meta.dim} />{" "}
          <span className={meta.alarm ? "text-cat-clay" : "text-muted-foreground"}>
            {meta.label}
          </span>
        </span>
      );
    },
  };
}
