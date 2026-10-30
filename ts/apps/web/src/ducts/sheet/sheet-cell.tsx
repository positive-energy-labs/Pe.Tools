/**
 * The sheet's one editable number: the kit's row-scale `StateCell` (the cell the network stage's
 * inputs and settings use), its unit drawn inside the box and its source word beside it. Every
 * sheet edit is a sheet `edits` request (the host writes Work and reprices), so the cell commits a
 * number, or null to clear when `clearable`; a refusal (busy, no fan) locks the cell and says why.
 * `cell` is the Work cell behind the value, when there is one, so a staged edit or Pea's
 * suggestion draws as the house cell draws it.
 */
import { cellFromDraft, StateCell } from "@pe/kit/lang/cell";

export type WorkCell = Parameters<typeof cellFromDraft>[0];

/** A Work rung as text: a bare number, or the one number a `{ cfm }` / `{ inWg }` rung carries. */
const showRung = (v: unknown): string =>
  typeof v === "number"
    ? String(v)
    : v && typeof v === "object"
      ? String(Object.values(v).find((x) => typeof x === "number") ?? "")
      : "";

/** The write's outcome as the cell's commit: nothing to refuse once it lands (the sheet shows refusals). */
const settled = (out: void | Promise<unknown>) =>
  out instanceof Promise ? out.then(() => undefined, () => undefined) : undefined;

export function SheetCell({
  label,
  value,
  unit,
  digits,
  source,
  sourceTitle,
  cell = {},
  refusal,
  positive = false,
  clearable = false,
  placeholder,
  className = "contents",
  onValue,
  onDraft,
}: {
  label: string;
  /** The resolved value; null draws an empty box. */
  value: number | null;
  unit: { label: string; short?: string };
  digits: number;
  /** Where the value came from (firm, seed, typed, suggested, revit, none); null draws no word. */
  source: string | null;
  /** The source word's title, when the word is short for something longer (a derived flow's provenance). */
  sourceTitle?: string;
  cell?: WorkCell;
  refusal: string | null;
  positive?: boolean;
  /** Emptying the box commits null (clear the typed value) instead of refusing. */
  clearable?: boolean;
  placeholder?: string;
  /**
   * The wrapper: `contents` (default) hands the box and the source word to the caller's grid as
   * two columns, so a list of cells aligns; a caller with no grid passes its own two-column grid.
   */
  className?: string;
  /** A promise holds the cell's submitted text until the write lands, so a blur after Enter never commits twice. */
  onValue: (value: number | null) => void | Promise<unknown>;
  /**
   * The number in the box as it is typed, before Enter or leaving the box commits it: null for an
   * empty or unreadable box, undefined when the edit is abandoned (Escape). A verb beside the cell
   * reads it so it is live while the person types, not only after the commit.
   */
  onDraft?: (value: number | null | undefined) => void;
}) {
  const text = value == null ? "" : String(Number(value.toFixed(digits)));
  return (
    <span
      className={className}
      data-sheet-cell={label}
      aria-label={label}
      onClick={(event) => event.stopPropagation()}
      onInput={
        onDraft &&
        ((event) => {
          const typed = (event.target as HTMLInputElement).value.trim();
          const n = Number(typed);
          onDraft(typed && Number.isFinite(n) && n >= 0 && !(positive && n <= 0) ? n : null);
        })
      }
      onKeyDown={onDraft && ((event) => void (event.key === "Escape" && onDraft(undefined)))}
    >
      <span className="block min-w-0">
      <StateCell
        {...cellFromDraft(
          cell,
          refusal
            ? { value: text, cap: "locked", capReason: refusal }
            : { value: text, cap: "editable" },
          showRung,
        )}
        scale="row"
        unit={unit}
        placeholder={placeholder}
        onCommit={(typed: string) => {
          const trimmed = typed.trim();
          if (!trimmed) {
            if (clearable) return value != null ? settled(onValue(null)) : undefined;
            return "Type a number";
          }
          const n = Number(trimmed);
          if (!Number.isFinite(n) || n < 0) return "Type a number of zero or more";
          if (positive && n <= 0) return "Type a number above zero";
          if (n !== value) return settled(onValue(n));
        }}
      />
      </span>
      {source != null && (
        <span
          className="t-small min-w-0 truncate text-ink-2"
          title={sourceTitle ?? source}
          data-input-source={source}
          data-tone={source === "none" ? "alarm" : undefined}
        >
          {source}
        </span>
      )}
    </span>
  );
}
