import { FactChip } from "#/components/lang/chip";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  useComboboxAnchor,
} from "#/components/lang/combobox";

export function Seam({ op }: { op: string }) {
  return (
    <FactChip
      dashed
      title={`${op} is a typed bridge op that has never met a live Revit session. It will run — nothing here is a mock — but its live behaviour remains unproven until the step-3 live proof closes this chip.`}
    >
      unproven · {op}
    </FactChip>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="t-label t-upper text-ink-2">{children}</span>;
}

/**
 * A multi-select over plain names, chips inside the control — the scope row's two pickers.
 *
 * It replaces a flex-wrap of toggle buttons: with 40 categories (or 300 families) the button
 * sprawl pushed the commit verb off the row entirely. Chips scroll inside a two-row box instead,
 * so the row's HEIGHT is bounded no matter how wide the scope gets.
 */
export function NamePicker({
  options,
  values,
  onChange,
  placeholder,
  ariaLabel,
  title,
  disabled,
}: {
  options: readonly string[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  ariaLabel: string;
  title: string;
  disabled?: boolean;
}) {
  const anchor = useComboboxAnchor();
  /* The whole-set default is a SUMMARY, not a chip flood: 300 auto-picked families as 300
     chips is bounded but unreadable. One quiet count stands in until the set is narrowed —
     deselection happens in the popup either way, so nothing is lost but the noise. */
  const collapsed = values.length > 8 && values.length === options.length;
  return (
    <Combobox
      items={options}
      multiple
      value={values}
      disabled={disabled}
      onValueChange={(next: string[]) => onChange(next)}
      itemToStringLabel={(name: string) => name}
    >
      {/* ponytail: explicit anchor on the chips row — the chips input must not be the positioner
          anchor, or the popup roams as chips wrap (same law as control-chips.tsx). */}
      <ComboboxChips ref={anchor} title={title}>
        {collapsed ? (
          <span
            className="px-1 t-label text-ink-2"
            title="Every resolved name is in the draft. Open the list to deselect — chips appear once the set is narrowed."
          >
            all {values.length}
          </span>
        ) : (
          values.map((name) => <ComboboxChip key={name}>{name}</ComboboxChip>)
        )}
        <ComboboxChipsInput
          aria-label={ariaLabel}
          placeholder={values.length === 0 ? placeholder : "add…"}
        />
        <ComboboxTrigger />
      </ComboboxChips>
      <ComboboxContent anchor={anchor}>
        {/* RULED not-an-empty-state (fit reviews, 2026-08-16): a combobox no-match slot is
            "you typed a string that matched nothing" — plain muted text, no story/exit. */}
        <ComboboxEmpty>no matches</ComboboxEmpty>
        <ComboboxList>
          {(name: string) => (
            <ComboboxItem key={name} value={name}>
              <span className="truncate">{name}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ── route ───────────────────────────────────────────────────────────────────────────────────────
