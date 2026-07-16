import { cn } from "#/lib/utils";

/**
 * ValueDiff — the one way a value change is written anywhere in the workbench:
 * struck current value, arrow, proposed value. Values are measured facts, so the
 * whole atom is `tele`. When `from` is unknown or unchanged, only `to` renders.
 * The new value inherits color from the caller (proposal clay, staged green, …).
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
    <span className={cn("tele tabular-nums", className)}>
      {changed && (
        <>
          <span className="text-muted-foreground line-through opacity-70">{from || "—"}</span>
          <span className="mx-1 text-muted-foreground">→</span>
        </>
      )}
      <span>{to || "—"}</span>
    </span>
  );
}
