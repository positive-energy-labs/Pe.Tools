import type { ReactNode } from "react";

/**
 * Presentation-only disclosure for route activity. It owns expansion and nothing else: no atom,
 * no read, no subscription, no poll, no dismissal and no recovery. The caller derives its summary
 * and rows during render from the owners it already holds, and supplies the detail node itself.
 */
export function ActivityDisclosure({
  summary,
  tone,
  children,
  label = "route activity",
}: {
  summary: string;
  tone?: "caution" | "meta";
  label?: string;
  children?: ReactNode;
}) {
  if (!children) return <span data-tone={tone}>{summary}</span>;
  return (
    <details className="min-w-0">
      <summary aria-label={label} data-tone={tone} className="cursor-pointer">
        {summary}
      </summary>
      <div className="min-w-0 space-y-1 py-1">{children}</div>
    </details>
  );
}

/**
 * One unresolved-or-busy line. `says` wraps in full — an expanded reason is never clamped to one
 * line and never hidden behind hover.
 */
export function ActivityRow({
  label,
  says,
  tone,
  children,
}: {
  label: string;
  says?: string;
  tone?: "caution" | "meta";
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-0.5" data-tone={tone}>
      <div className="min-w-0">{label}</div>
      {says ? <div className="min-w-0 break-words whitespace-pre-wrap">{says}</div> : null}
      {children}
    </div>
  );
}
