/** The Situation's cluster: the chain lamp and the state gauge on the name line. */
import { useContext, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Gauge } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { StateDot } from "@pe/kit/table/cells";
import {
  PrimaryRouteControls,
  useHasGlobalNavigation,
  useIsPrimaryRoute,
  usePublishSituationSignal,
  type SituationSignal,
} from "#/navigation/route-controls";
import { ThemeToggle } from "@pe/kit/lang/theme-toggle";
import { RouteHelpButton } from "./help";
import { FlowMatrix } from "./flow";
import { HostedChrome } from "./hosted-chrome";
import { RouteInspector } from "./inspector";
import type { RouteHandle } from "./handle";

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
  inspection = false,
  stageWord,
}: {
  handle: RouteHandle<any, any, any, any>;
  /** The document's complaint, when it has one ("needs initialization · 4 carriers"). */
  health?: string | null;
  /** The bound session's word (the pe-revit id when it has one); null = no session. */
  session: string | null;
  /** Diagnostic label only; the sentence owns target selection. */
  document: string | null;
  inspection?: boolean;
  stageWord?: string;
}) {
  const resolution = handle.resolution;
  const sessionWord =
    session ??
    (resolution.kind === "choose" ? resolution.reason.replaceAll("-", " ") : "no session");
  const title = [`session · ${sessionWord}`, health ? `document · ${health}` : null]
    .filter(Boolean)
    .join("\n");
  const primary = useIsPrimaryRoute(handle.manifest.key);
  const kind: SituationSignal["kind"] = inspection
    ? "archived"
    : handle.failure
      ? "failure"
      : handle.busy
        ? "busy"
        : health
          ? "health"
          : document && session
            ? "ready"
            : "unbound";
  const tone: SituationSignal["tone"] =
    kind === "archived"
      ? "nav"
      : kind === "busy"
        ? "commit"
        : kind === "ready"
          ? "done"
          : "caution";
  const stateWord =
    kind === "archived"
      ? "Archived · Saved observation"
      : kind === "failure"
        ? "Attention needed"
        : kind === "busy"
          ? `Running · ${handle.busy?.key}`
          : kind === "health"
            ? "Document needs attention"
            : kind === "ready"
              ? "Document bound"
              : "No live document bound";
  usePublishSituationSignal(handle.manifest.key, {
    kind,
    tone,
    title: [
      stateWord,
      stageWord,
      handle.failure?.message,
      document ?? "no document selected",
      inspection ? null : title,
    ]
      .filter(Boolean)
      .join("\n"),
    stamp: `${kind}|${stageWord}|${session}|${document}|${health}|${handle.failure?.message}|${handle.busy?.key}`,
  });
  if (primary || inspection) return null;
  const dot = (on: boolean, tone: "done" | "alarm" | "caution" | "mute" = "done") =>
    on ? (
      <StateDot tone={tone} />
    ) : (
      <span className="inline-block size-2 shrink-0 rounded-[1px] border border-ink-mute align-middle" />
    );
  return (
    <span
      className="flex min-w-0 items-center gap-1.5 t-small face-mono text-ink-mute"
      title={title}
    >
      {dot(session !== null, health ? "caution" : "done")}
      <span
        className={`min-w-0 truncate ${health ? "" : "text-ink-2"}`}
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
  word,
}: {
  handle: RouteHandle<any, any, any, any>;
  children?: ReactNode;
  word?: string;
}) {
  if (!import.meta.env.DEV && children == null) return null;
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            label={word ?? "Route state"}
            reason="route state: what is bound, what ran, and the route's nouns"
            icon={Gauge}
          >
            {word}
          </Button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            data-surface="artifact"
            className="flex max-h-(--available-height) w-[44rem] max-w-(--available-width) flex-col gap-3 overflow-auto p-3 t-prose text-ink float-surface"
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
  helpUtilities = false,
}: {
  handle: RouteHandle<any, any, any, any>;
  lamp: ReactNode;
  /** What the state gauge shows above the inspector (Chat hands in its ledger and log). */
  state?: ReactNode;
  helpUtilities?: boolean;
}) {
  const chrome = useContext(HostedChrome);
  const globalNavigation = useHasGlobalNavigation();
  const primary = useIsPrimaryRoute(handle.manifest.key);
  return (
    <>
      {lamp}
      <PrimaryRouteControls route={handle.manifest.key} slot="inspector">
        <StateGauge handle={handle} word={primary ? "Inspector" : undefined}>
          {state}
        </StateGauge>
      </PrimaryRouteControls>
      <PrimaryRouteControls route={handle.manifest.key}>
        <RouteHelpButton
          name={handle.manifest.name}
          docs={handle.manifest.docs}
          utilities={helpUtilities}
        />
        {chrome}
        {!globalNavigation && <ThemeToggle />}
      </PrimaryRouteControls>
    </>
  );
}
