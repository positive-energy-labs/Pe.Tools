import { cn } from "#/lib/utils";

/**
 * THE verb — every button that acts, in one of three tones (docs/design/COLOR-ROLES.md):
 *
 *   commit — writes beyond the page (save, apply, materialize, bind). The ONLY interactive
 *            surface allowed to wear `--act-commit`.
 *   act    — safe verb, page-scoped (refresh, parse, capture-into-draft, collapse). Neutral;
 *            hover strengthens the border and never turns blue.
 *   nav    — goes somewhere or back (← all types, open elsewhere). Text with an underline
 *            affordance; no border, because leaving is not an operation on the data.
 *
 * `reason` is REQUIRED and becomes the title: what the verb MEANS and what pressing it DOES —
 * or, when disabled, why it will not. Tooltips deepen, they must never rescue; the label still
 * has to carry the verb on its own.
 */
export function Verb({
  label,
  onClick,
  disabled,
  reason,
  busy,
  tone = "act",
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  reason: string;
  busy?: boolean;
  tone?: "commit" | "act" | "nav";
  className?: string;
}) {
  const inert = disabled || busy;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={inert}
      title={reason}
      className={cn(
        "tele h-6 shrink-0 rounded-[2px]",
        tone === "nav"
          ? cn(
              "px-1 underline-offset-2",
              inert
                ? "cursor-not-allowed text-muted-foreground"
                : "text-foreground hover:underline",
            )
          : cn(
              "border px-2",
              inert
                ? "cursor-not-allowed border-[var(--line-soft)] text-muted-foreground"
                : tone === "commit"
                  ? "border-[var(--act-commit)] text-[var(--act-commit)] hover:bg-[var(--act-commit)]/10"
                  : "border-[var(--line-2)] text-foreground hover:border-[var(--act-hover)]",
            ),
        className,
      )}
    >
      {busy ? `${label}…` : label}
    </button>
  );
}
