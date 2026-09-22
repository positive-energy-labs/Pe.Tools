import { FactChip } from "#/components/lang/chip";
import { ListChips, ListPopup } from "#/components/lang/list-popup";
import { Press } from "#/components/lang/press";

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
  return <span className="t-small t-upper text-ink-2">{children}</span>;
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
  /* The whole-set default is a SUMMARY, not a chip flood: 300 auto-picked families as 300
     chips is bounded but unreadable. One quiet count stands in until the set is narrowed —
     deselection happens in the popup either way, so nothing is lost but the noise. */
  const collapsed = values.length > 3 && values.length === options.length;
  return (
    <div className="max-h-[3.25rem] min-w-[14rem] flex-1 basis-[14rem] overflow-y-auto">
      <ListPopup<string>
        anchor="trigger"
        face="field"
        triggerLabel={ariaLabel}
        title={title}
        disabled={disabled}
        trigger={
          <ListChips
            labels={
              collapsed
                ? [`all ${values.length} ${ariaLabel.replace(/^draft /, "")}`]
                : values.map((name) => <span className="face-mono">{name}</span>)
            }
            none={placeholder}
          />
        }
        aria-label={ariaLabel}
        items={options}
        keyOf={(name) => name}
        labelOf={(name) => name}
        filter="substring"
        select="multi"
        selected={values}
        onSelectedChange={onChange}
        empty="nothing to pick"
        noMatch="no matches"
        footer={
          values.length ? (
            <Press tone="quiet" size="value" onClick={() => onChange([])}>
              clear {ariaLabel}
            </Press>
          ) : null
        }
        row={(name) => ({ label: <span className="face-mono">{name}</span> })}
      />
    </div>
  );
}

// ── route ───────────────────────────────────────────────────────────────────────────────────────
