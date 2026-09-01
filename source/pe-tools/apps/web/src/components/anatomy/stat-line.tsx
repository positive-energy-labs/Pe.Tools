import { cn } from "#/lib/utils";

export function StatLine({
  label,
  value,
  tone,
  muted,
  truncate = true,
}: {
  label: string;
  value: string;
  tone?: "alarm" | "caution" | "done" | "commit" | "nav" | "pea";
  muted?: boolean;
  truncate?: boolean;
}) {
  return (
    <p className="face-mono flex gap-1.5 t-value">
      <span className="w-16 shrink-0 text-right text-ink-2">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1",
          truncate ? "truncate" : "break-words",
          muted && "text-ink-2",
        )}
        data-tone={tone}
      >
        {value}
      </span>
    </p>
  );
}
