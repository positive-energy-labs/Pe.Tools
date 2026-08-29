import type { ReactNode } from "react";
import { HostConnectionPill } from "#/host/issues";

export interface RouteWorkspaceShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  connected: boolean;
  connectionLabel?: string;
  actions?: ReactNode;
  subline?: ReactNode;
  error?: string | null;
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
    <main className="flex h-screen flex-col overflow-hidden on-page">
      <header className="shrink-0 border-b border-line-2 px-5 pb-2.5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            {/* a page title is chrome — ink, not a meaning hue (it wore the alarm via shim) */}
            <h1 className="t-head face-display text-ink">{title}</h1>
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

            {error ? <span className="text-caution">{error}</span> : null}
          </div>
        ) : null}
      </header>

      {children}
    </main>
  );
}
