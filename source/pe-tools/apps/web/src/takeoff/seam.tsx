/**
 * Seam chips — the living spec's honesty device.
 *
 * Every stage of /takeoffs is either wired to the real backend or standing in for something that
 * does not exist yet. A `seam:` chip marks the second kind and says, in one line, what replaces
 * it. A stage with no chip is claiming to be real; that claim has to be true.
 */
import { cn } from "#/lib/utils";

export function Seam({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "tele inline-flex items-start gap-1 rounded-[var(--radius)] border border-dashed border-cat-clay/45 bg-cat-clay/[0.06] px-1.5 py-0.5 text-left leading-snug text-cat-clay",
        className,
      )}
    >
      <span className="tele-label shrink-0 opacity-70">seam</span>
      <span className="min-w-0 normal-case text-foreground/70">{children}</span>
    </span>
  );
}

/** The opposite chip: this stage is talking to the real thing, and here is the proof lane. */
export function Live({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "tele inline-flex items-center gap-1 rounded-[var(--radius)] border border-cat-blue/40 bg-cat-blue/[0.07] px-1.5 py-0.5 text-cat-blue",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-cat-blue" />
      <span className="normal-case text-foreground/70">{children}</span>
    </span>
  );
}

/** A numbered pipeline step header — the route reads as README.md's seven-step table. */
export function Step({
  n,
  title,
  owner,
  home,
  children,
}: {
  n: React.ReactNode;
  title: string;
  owner: string;
  home: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <span className="tele-label rounded-[var(--radius)] border border-[var(--line)] px-1.5 py-px text-muted-foreground">
        step {n}
      </span>
      <h2 className="font-pe-display text-sm font-semibold tracking-tight">{title}</h2>
      <span className="tele text-muted-foreground">
        {owner} → {home}
      </span>
      {children}
    </div>
  );
}
