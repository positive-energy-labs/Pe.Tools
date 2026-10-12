/** The Situation's cluster: the chain lamp and the state gauge on the name line. */
import { useContext, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Gauge } from "lucide-react";
import { Press } from "#/components/lang/press";
import { StateDot } from "#/components/master-table/cells";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { RouteHelpButton } from "./help";
import { FlowMatrix } from "./flow";
import { HostedChrome } from "./hosted-chrome";
import { RouteInspector } from "./inspector";
import type { RouteHandle } from "./use-route";

/**
 * session › document, one instrument that says ONE thing at rest: the document (which is the
 * picker) and its complaint. Whether the host answers is not drawn here: connected-or-not states
 * left product chrome (host ledger 2026-10-09). The whole chain rides the title.
 */
export function ChainLamp({
  handle,
  health,
  session,
  document,
}: {
  handle: RouteHandle<any, any, any, any>;
  /** The document's complaint, when it has one ("needs initialization · 4 carriers"). */
  health?: string | null;
  /** The bound session's word (the pe-revit id when it has one); null = no session. */
  session: string | null;
  /** Diagnostic label only; the sentence owns target selection. */
  document: string | null;
}) {
  const resolution = handle.resolution;
  const sessionWord =
    session ??
    (resolution.kind === "choose" ? resolution.reason.replaceAll("-", " ") : "no session");
  const title = [`session · ${sessionWord}`, health ? `document · ${health}` : null]
    .filter(Boolean)
    .join("\n");
  const dot = (on: boolean, tone: "done" | "alarm" | "caution" | "mute" = "done") =>
    on ? (
      <StateDot tone={tone} />
    ) : (
      <span className="inline-block size-2 shrink-0 rounded-[1px] border border-ink-mute align-middle" />
    );
  return (
    <span className="flex items-center gap-1.5 t-small face-mono text-ink-mute" title={title}>
      {dot(session !== null, health ? "caution" : "done")}
      <span
        className={health ? undefined : "text-ink-2"}
        data-tone={health ? "caution" : undefined}
      >
        {document ?? "no document selected"}
        {health ? ` · ${health}` : ""}
      </span>
    </span>
  );
}

/* ── the cluster ───────────────────────────────────────────────────────────── */

/**
 * The state gauge: one icon on the cluster that opens the route's state — what the caller hands
 * in (Chat's ledger and log) and, in dev, the route inspector (target, Work, Readings, actions).
 * Nothing when there is nothing to show.
 */
function StateGauge({
  handle,
  children,
}: {
  handle: RouteHandle<any, any, any, any>;
  children?: ReactNode;
}) {
  if (!import.meta.env.DEV && children == null) return null;
  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Press tone="quiet" size="icon" />}
        title="route state: what is bound, what ran, and the route's nouns"
        aria-label="Route state"
      >
        <Gauge className="size-4" strokeWidth={1.5} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            data-surface="artifact"
            className="flex max-h-(--available-height) w-[44rem] max-w-(--available-width) flex-col gap-3 overflow-auto rounded-lg p-3 t-prose text-ink ring-1 ring-line outline-none"
          >
            {children}
            <FlowMatrix handle={handle} />
            <RouteInspector handle={handle} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Lamp · gauge · help · theme, always together, on the right of the name line. */
export function Cluster({
  handle,
  lamp,
  state,
}: {
  handle: RouteHandle<any, any, any, any>;
  lamp: ReactNode;
  /** What the state gauge shows above the inspector (Chat hands in its ledger and log). */
  state?: ReactNode;
}) {
  const chrome = useContext(HostedChrome);
  return (
    <span className="flex shrink-0 items-center gap-1">
      {lamp}
      <StateGauge handle={handle}>{state}</StateGauge>
      <RouteHelpButton name={handle.manifest.name} docs={handle.manifest.docs} />
      <ThemeToggle />
      {chrome}
    </span>
  );
}
