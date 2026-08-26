/**
 * RouteWorkspaceShell — the shared ribbon/pane frame for a full route workspace page
 * (/settings, /parameter-links, …). It owns the repeated boilerplate: the full-height
 * `<main>`, the header ribbon (title row + connection pill +
 * an actions slot), the subline strip (metrics/status + route error), and the main pane.
 *
 * Everything route-specific is a slot: `subtitle`, `actions` (the button ribbon, which
 * still carries each page's own "pea is working" pill so its styling stays page-owned),
 * `subline`, and `children` (the pane).
 */
import type { ReactNode } from "react";
import { HostConnectionPill } from "#/host/issues";

export interface RouteWorkspaceShellProps {
  title: ReactNode;
  /** Optional subtitle node beside the title (page provides its own text styling). */
  subtitle?: ReactNode;
  /** Connection lamp state — typically `route.connected` ∧ host bridge status. */
  connected: boolean;
  connectionLabel?: string;
  /** Right-side ribbon: page action buttons (and the page's own pea pill). */
  actions?: ReactNode;
  /** Subline strip content (metrics / validation / status spans). */
  subline?: ReactNode;
  /** Route-level error, appended to the subline strip in clay. */
  error?: string | null;
  /** The main pane below the ribbon. */
  children: ReactNode;
}

export function RouteWorkspaceShell({
  title,
  subtitle,
  connected,
  connectionLabel = "Connected",
  actions,
  subline,
  error,
  children,
}: RouteWorkspaceShellProps) {
  const hasSubline = subline != null || error != null;
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--r-page)] [--r-on:var(--r-page)]">
      <header className="shrink-0 border-b border-[var(--r-line-2)] px-5 pb-2.5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            {/* a page title is chrome — ink, not a meaning hue (it wore the alarm via shim) */}
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-[var(--r-ink)]">
              {title}
            </h1>
            {subtitle}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <HostConnectionPill connected={connected} label={connectionLabel} />
            {actions}
          </div>
        </div>

        {hasSubline ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 t-label">
            {subline}
            {/* a route-level error is an ERROR — caution, never a viz hue as state */}
            {error ? <span className="text-[var(--r-caution)]">{error}</span> : null}
          </div>
        ) : null}
      </header>

      {children}
    </main>
  );
}
