import { cn } from "#/lib/utils";

export function Key({ tone, label, seam }: { tone: string; label: string; seam?: boolean }) {
  return (
    <span className="face-mono inline-flex items-center gap-1 text-ink-2 t-small">
      <span
        className={cn("inline-block size-2.5 rounded-[1px] border", seam === true && "seam-border")}
        style={{
          backgroundColor: `color-mix(in srgb, ${tone} 16%, transparent)`,
          borderColor: tone,
        }}
      />
      {label}
    </span>
  );
}
