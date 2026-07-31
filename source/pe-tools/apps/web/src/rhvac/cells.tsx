/**
 * Dense-grid editing primitives for /rhvac. Cells are uncontrolled and commit
 * on blur/Enter (Escape reverts) so keystrokes never re-render the 150-row
 * grid; the room object only changes when a value actually lands.
 */
import { useRef } from "react";

import { cn } from "#/lib/utils";

/** Round for display without float noise: 22.200000762 → "22.2", 599.99994 → "600". */
export function fmtNum(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)));
}

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
  initial.current = display;
  return (
    <input
      key={display}
      defaultValue={display}
      placeholder={placeholder}
      title={title}
      inputMode={numeric ? "decimal" : undefined}
      className={cn(CELL_CLASS, numeric && "text-right", className)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
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
        const parsed = integer ? Number.parseInt(text, 10) : Number(text);
        if (Number.isNaN(parsed)) return; // revert-by-rerender: display key resets the input
        onCommit(min !== undefined && parsed < min ? min : parsed);
      }}
    />
  );
}

/** Native select styled to sit flush inside a hairline grid cell. */
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
  return (
    <select
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
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
