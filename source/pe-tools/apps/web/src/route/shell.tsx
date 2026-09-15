/**
 * THE SHELL — the one route chrome: the chord bindings, and a head for a route that has not been
 * cut over to a Situation yet (name, host lamp, verb row). The Situation (`situation.tsx`) is the
 * one head; the shell draws none of its own when a route hands one in.
 *
 * The lamp is one `host-status` Reading at 5s (ruling Q5) and the route gate reads the same value.
 * Installer/update UI is NOT here — it moved to `routes/__root.tsx` (ruling Q3).
 */
import { useCallback, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip } from "#/components/lang/chip";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { StateDot } from "#/components/master-table/cells";
import { useHostStatus } from "#/readings";

import { RouteHelpButton } from "./help";
import { RouteKeys } from "./keys";
import type { RouteManifest } from "./manifest";
import { SituationAction } from "./situation";
import { useRoute, type RouteHandle } from "./use-route";

/* ── The lamp ──────────────────────────────────────────────────────────────── */

export interface Lamp {
  tone: "done" | "alarm" | "mute" | "ink";
  word: string;
  says: string;
  checked: string | null;
}

/**
 * `/host/status` → `bridgeIsConnected`. One `host-status` Reading, polled by the HOST at 5s: the
 * lamp cannot sit green after Revit closed, and every capability gate reads the same observation.
 */
export function useHostLamp(enabled = true): Lamp {
  const info = useHostStatus(enabled);
  if (!enabled)
    return {
      tone: "mute",
      word: "offline",
      says: "no host contacted",
      checked: null,
    };
  if (info.state === "failed")
    return {
      tone: "alarm",
      word: "unreachable",
      says: `the host did not answer /host/status — ${info.message}`,
      checked: null,
    };
  if (info.state === "absent")
    return {
      tone: "mute",
      word: "unknown",
      says: "asking the host for its capabilities",
      checked: null,
    };
  if (info.state === "loading")
    return {
      tone: "mute",
      word: "checking",
      says: "waiting for a current host status",
      checked: null,
    };
  if (info.state === "stale")
    return {
      tone: "alarm",
      word: "stale",
      says: "the last host status is no longer current",
      checked: null,
    };
  const seen = info.observation;
  if (!seen.capabilities.revit)
    return {
      tone: "ink",
      word: "no revit",
      says: "the host answers, but it reports no Revit capability — nothing is attached",
      checked: null,
    };
  if (!seen.bridgeIsConnected)
    return {
      tone: "ink",
      word: "no Revit bridge",
      says: "the host supports Revit, but no Revit bridge is attached",
      checked: null,
    };
  return {
    tone: "done",
    word: "connected",
    says: `Revit is attached — host ${seen.controllerId}`,
    checked: null,
  };
}

export function HostLamp({ live = true }: { live?: boolean }) {
  const lamp = useHostLamp(live);
  return (
    <ArtifactFrame>
      <span className="flex items-center gap-1.5 px-1">
        <FactChip title={lamp.says}>
          <span className="flex items-center gap-1.5">
            <StateDot tone={lamp.tone} />
            <span>
              host · {lamp.word}
              {lamp.checked ? ` · ${lamp.checked}` : ""}
            </span>
          </span>
        </FactChip>
        <ThemeToggle />
      </span>
    </ArtifactFrame>
  );
}

/* ── The verb row ─────────────────────────────────────────────────────────── */

/**
 * The verbs of a route that has no Situation yet. Same buttons the Situation's verb row draws
 * (`SituationAction`), so a refusal, a flag and an outcome paint identically in both heads — and
 * so there is exactly one action surface in the app, not a shell copy of it.
 */
function ShellVerbs<W, R extends string, P, A extends string>({
  handle,
}: {
  handle: RouteHandle<W, R, P, A>;
}) {
  const verbs = Object.entries(handle.actions) as [string, RouteHandle<W, R, P, A>["actions"][A]][];
  if (!verbs.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {verbs.map(([name, action]) => (
        <SituationAction key={name} handle={handle} name={name} action={action} />
      ))}
    </div>
  );
}

/* ── The shell ─────────────────────────────────────────────────────────────── */

export interface ShellProps<W, R extends string, P, A extends string> {
  manifest: RouteManifest<W, R, P, A>;
  handle: RouteHandle<W, R, P, A>;
  /** Overrides `manifest.name` for a route that has not been cut over yet (fold 5). */
  name?: string;
  aside?: ReactNode;
  head?: ReactNode;
  /** A Situation owns the whole head row (name, chain lamp, verbs); the shell draws none of it. */
  situation?: ReactNode;
  live?: boolean;
  children?: ReactNode;
}

/** The one `?target` reader/writer every shell and route shares. Grammar lives in `parseTarget`. */
export function useChooseTarget(): [string | null, (target: string | null) => void] {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { target?: string };
  const choose = useCallback(
    (target: string | null) =>
      void navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          target: target || undefined,
        }),
        replace: true,
      }),
    [navigate],
  );
  return [search.target ?? null, choose];
}

export function RouteShell<W, R extends string, P, A extends string>(
  props: Omit<ShellProps<W, R, P, A>, "handle"> & { handle?: RouteHandle<W, R, P, A> },
) {
  return props.handle ? (
    <RouteShellView {...props} handle={props.handle} />
  ) : (
    <OwnedRouteShell {...props} />
  );
}

function OwnedRouteShell<W, R extends string, P, A extends string>(
  props: Omit<ShellProps<W, R, P, A>, "handle">,
) {
  const [target] = useChooseTarget();
  const handle = useRoute(props.manifest, { target });
  return <RouteShellView {...props} handle={handle} />;
}

function RouteShellView<W, R extends string, P, A extends string>(props: ShellProps<W, R, P, A>) {
  return <BaselineShell {...props} />;
}

function BaselineShell<W, R extends string, P, A extends string>({
  manifest,
  handle,
  name,
  aside,
  head,
  situation,
  live,
  children,
}: ShellProps<W, R, P, A>) {
  return (
    // The one landmark of the primitive. A route may override the printed head with its own word
    // (chat prints the thread's label), so the shell names itself with the MANIFEST's name: that
    // is the handle that a proof — or a screen reader — can hold on every route alike.
    <div
      role="region"
      aria-label={`${manifest.name} route`}
      className={`flex ${children ? "h-full" : ""} min-h-0 min-w-0 flex-col gap-2`}
    >
      <RouteKeys handle={handle} />
      {situation ?? (
        <>
          <div className="flex min-w-0 items-center justify-between gap-4">
            <h1 className="t-head face-display text-ink">{name ?? manifest.name}</h1>
            <span className="flex shrink-0 items-center gap-3">
              {aside}
              <RouteHelpButton name={manifest.name} docs={manifest.docs} />
              <HostLamp live={live} />
            </span>
          </div>
          {head ?? <ShellVerbs handle={handle} />}
        </>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
