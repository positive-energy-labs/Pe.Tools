/**
 * MASTER-TABLE CELL RENDERERS — thin wrappers over the language, not a second editor.
 *
 * RULED 2026-08-16 (fit reviews, #2 — "the editable cell fractured into parallel editors"):
 * `BaseCell` was a parallel implementation of `StateCell`'s keyboard/commit contract, and it
 * silently swallowed refused numeric commits (§3's named defect, in canon). It is deleted.
 * `TextCell`/`NumberCell` now RENDER `StateCell` at row scale — one editor, one refusal
 * mechanism (the visible dismissible note), one focus treatment (the inset hairline, per the
 * focus law). `CellSelect` is the one forced wrapper: it keeps table navigation around the kit
 * Combobox and routes its refusal through the alarm mixes.
 */
import { useContext } from "react";

import { useCellNavigation } from "#/components/master-table/cell-navigation";
import {
  Combobox,
  ComboboxContent,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "#/components/lang/combobox";
import { CellHost, StateCell, fmtNum } from "#/components/lang/cell";
import type { Verdict, VerdictTone } from "#/components/master-table/model";
import { token } from "#/lib/token";
import { cn } from "#/lib/utils";

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
      onCommit={(text) => onCommit(text)}
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

/** The forced wrapper: a select-shaped editor cannot ride `StateCell`'s input. Focus takes the
 * select fill (the focus law — a fill, never a hue); `invalid` is its refusal mechanism and
 * spends the one alarm as an ink + wash mix, visibly on the surface. */
export function CellSelect({
  value,
  onChange,
  options,
  invalid,
  title,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  invalid?: boolean;
  title?: string;
}) {
  const move = useCellNavigation();
  // Closing (Escape or a pick) hands focus back to the td, where the table's keys live.
  const host = useContext(CellHost);
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <Combobox
      items={[...options]}
      value={selected}
      onValueChange={(option: { value: string; label: string } | null) =>
        option && onChange(option.value)
      }
      itemToStringLabel={(option: { value: string; label: string }) => option.label}
    >
      <ComboboxTrigger
        fill
        title={title}
        tabIndex={-1}
        data-cell-editor=""
        onKeyDown={(event) => {
          if (event.key === "Tab" && move?.(event.shiftKey ? "left" : "right"))
            event.preventDefault();
        }}
        data-tone={invalid ? "alarm" : undefined}
        data-wash={invalid ? "" : undefined}
      >
        {selected?.label ?? value}
      </ComboboxTrigger>
      <ComboboxContent finalFocus={host ?? undefined}>
        <ComboboxList>
          {(option: { value: string; label: string }) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
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
  "data-tone"?: "alarm" | "caution" | "done" | "commit" | "nav" | "pea";
}) {
  return (
    <span
      title={reason}
      className={cn("face-mono block truncate px-(--item-pad-x)", className)}
      data-tone={dataTone}
    >
      {value}
    </span>
  );
}

/** The verdict swatch. Tone is the NARROW meaning-role union — never a raw CSS colour
 * (takeoffs #11, ruled 2026-08-16 R5; `stateColumn`, which took any string, died with it). */
export function StateDot({ tone, dim, bar }: { tone: VerdictTone; dim?: boolean; bar?: boolean }) {
  return (
    <span
      className={
        bar ? "h-full min-w-0 flex-1" : "inline-block size-2 shrink-0 rounded-[1px] align-middle"
      }
      style={{ backgroundColor: VERDICT_INK[tone], opacity: dim ? 0.35 : 1 }}
    />
  );
}

export const VERDICT_INK: Record<VerdictTone, string> = {
  alarm: token("alarm"),
  caution: token("caution"),
  done: token("done"),
  ink: token("ink-2"),
  mute: token("ink-mute"),
};

/** How a `verdict:` column draws — the table calls this itself (master-table.tsx resolve). The
 * WORD wears its tone only at alarm rank (the one alarm must be unmissable); every quieter
 * verdict keeps the word in secondary ink and lets the dot carry the tone. */
export function VerdictCell({ verdict }: { verdict: Verdict }) {
  return (
    <span className="face-mono block truncate px-(--item-pad-x)" title={verdict.note}>
      <StateDot tone={verdict.tone} dim={verdict.dim} />{" "}
      <span
        className={verdict.tone === "alarm" ? undefined : "text-ink-2"}
        data-tone={verdict.tone === "alarm" ? "alarm" : undefined}
      >
        {verdict.word}
      </span>
    </span>
  );
}
