/**
 * RouteWorkspaceShell — the shared ribbon/pane frame for a full route workspace page
 * (/settings, /parameter-links, …). It owns the repeated boilerplate: the full-height
 * `<main>`, the header ribbon (title row + connection pill + a read-only binding chip +
 * an actions slot), the subline strip (metrics/status + route error), and the main pane.
 *
 * Everything route-specific is a slot: `subtitle`, `actions` (the button ribbon, which
 * still carries each page's own "pea is working" pill so its styling stays page-owned),
 * `subline`, and `children` (the pane). The binding chip is read-only for now — it shows
 * `binding.target ?? "unbound"`; cycling targets is out of scope.
 */
import type { ReactNode } from "react";
import { Link2 } from "lucide-react";

import type { RouteBinding } from "@pe/agent-contracts";

import { HostConnectionPill } from "#/host/issues";

export interface RouteWorkspaceShellProps {
  title: ReactNode;
  /** Optional subtitle node beside the title (page provides its own text styling). */
  subtitle?: ReactNode;
  /** Connection lamp state — typically `route.connected` ∧ host bridge status. */
  connected: boolean;
  connectionLabel?: string;
  /** The document's binding; renders a read-only chip (target ?? "unbound"). */
  binding?: RouteBinding | null;
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
  binding,
  actions,
  subline,
  error,
  children,
}: RouteWorkspaceShellProps) {
  const hasSubline = subline != null || error != null;
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--paper)]">
      <header className="shrink-0 border-b border-[var(--line-2)] px-5 pb-2.5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight text-[var(--clay-ink)]">
              {title}
            </h1>
            {subtitle}
            {binding !== undefined ? <BindingChip binding={binding} /> : null}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <HostConnectionPill connected={connected} label={connectionLabel} />
            {actions}
          </div>
        </div>

        {hasSubline ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {subline}
            {error ? <span className="text-[var(--cat-clay)]">{error}</span> : null}
          </div>
        ) : null}
      </header>

      {children}
    </main>
  );
}

/** Read-only binding chip: the current target, or "unbound". Cycling is out of scope. */
function BindingChip({ binding }: { binding: RouteBinding | null }) {
  const target = binding?.target ?? null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[2px] border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--lichen)]"
      title={target ? `bound to ${target}` : "no target bound"}
    >
      <Link2 className="size-2.5" />
      {target ?? "unbound"}
    </span>
  );
}
