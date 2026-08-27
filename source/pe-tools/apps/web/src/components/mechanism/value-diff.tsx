import { cn } from "#/lib/utils";

/**
 * ValueDiff — the one way a value change is written anywhere in the workbench:
 * struck current value, arrow, proposed value. Values are measured facts, so the
 * whole atom is mono at the value tier. When `from` is unknown or unchanged, only
 * `to` renders. The new value inherits color from the caller (a meaning role).
 */
export function ValueDiff({
  from,
  to,
  className,
}: {
  from?: string | null;
  to: string;
  className?: string;
}) {
  const changed = from != null && from !== to;
  return (
    <span className={cn("face-mono t-value", className)}>
      {changed && (
        <>
          <span className="text-ink-2 line-through opacity-70">{from || "—"}</span>
          <span className="mx-1 text-ink-2">→</span>
        </>
      )}
      <span>{to || "—"}</span>
    </span>
  );
}
