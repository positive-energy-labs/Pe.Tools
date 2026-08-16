import { cn } from "#/lib/utils";

/**
 * Exclusive MODE switch (docs/design/COLOR-ROLES.md): the active choice is a FILL (mist),
 * never a colour — selection is a place you are standing, not a state of the data, so it
 * spends nothing from the state palette and cannot be confused with commit or drift.
 *
 * Each option's `title` says what the mode SHOWS or changes — required, because a mode whose
 * consequence is not stated is a mystery toggle.
 */
export function Switcher<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: ReadonlyArray<{ value: T; label: string; title: string; disabled?: boolean }>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <span
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex shrink-0 items-center rounded-[2px] border border-[var(--line-2)]",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          disabled={option.disabled}
          title={option.title}
          aria-pressed={value === option.value}
          className={cn(
            "tele h-5 px-1.5 text-[10px] first:rounded-l-[1px] last:rounded-r-[1px]",
            option.disabled
              ? "cursor-not-allowed text-muted-foreground/50"
              : value === option.value
                ? "bg-secondary text-foreground"
                : "text-[var(--st-meta)] hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}
