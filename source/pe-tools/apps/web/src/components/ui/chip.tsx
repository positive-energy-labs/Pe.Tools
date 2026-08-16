import { cn } from "#/lib/utils";

/**
 * Status CHIP (docs/design/COLOR-ROLES.md): a small machine-measured fact wearing exactly one
 * state role. `dashed` marks a seam — typed but unproven, a fixture, a stand-in — the border
 * style IS that meaning, so nothing else may use it.
 *
 * `title` is required: a chip states a fact, the title says what the fact means and what would
 * change it.
 */
const TONE: Record<string, string> = {
  meta: "text-[var(--st-meta)]",
  warn: "text-[var(--st-warn)]",
  done: "text-[var(--st-done)]",
  drift: "text-[var(--st-drift)]",
  proposal: "text-[var(--st-proposal)]",
};

export function Chip({
  children,
  tone = "meta",
  dashed,
  title,
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONE;
  dashed?: boolean;
  title: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "tele shrink-0 rounded-[2px] border px-1 text-[10px]",
        dashed ? "border-dashed border-[var(--line-2)]" : "border-[var(--line-soft)]",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
