/**
 * THE SHELL — the one route chrome. Head (name + host lamp), Door (one control: resolution
 * recovery, keys, views, docs, dev inspector). It replaces `targeting/head.tsx`,
 * `targeting/cluster.tsx`, `workbench/route-workspace-shell.tsx` and `workbench/route-scope.tsx`.
 *
 * The lamp is one `host-status` Reading at 5s (ruling Q5) and the route gate reads the same value.
 * Installer/update UI is NOT here — it moved to `routes/__root.tsx` (ruling Q3).
 */
import { useCallback, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { InstancesPage } from "#/instances/route";

import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import { ThemeToggle } from "#/components/lang/theme-toggle";
import { StateDot } from "#/components/master-table/cells";
import { useHostStatus } from "#/readings";

import { RouteInspector } from "./inspector";
import { RouteHelpButton } from "./help";
import { RouteKeys } from "./keys";
import type { RouteManifest } from "./manifest";
import { useRoute, type RouteHandle } from "./use-route";
import type { Refusal } from "./refusal";

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

/* ── The door ──────────────────────────────────────────────────────────────── */

const resolutionSentence = (handle: RouteHandle<any, any, any, any>): string | null => {
  const { resolution } = handle;
  if (resolution.kind === "resolved") return null;
  if (resolution.kind === "checking") return "checking the target…";
  if (resolution.kind === "failed") return resolution.message;
  return `pick a target — ${resolution.reason.replaceAll("-", " ")}`;
};

/** One control. It opens the views, the chords, the route's docs and the dev inspector. */
function Door<W, R extends string, P, A extends string>({
  handle,
  refusal,
}: {
  handle: RouteHandle<W, R, P, A>;
  refusal: Refusal | null;
}) {
  const [open, setOpen] = useState(false);
  const sentence = resolutionSentence(handle);
  const failure = refusal ?? handle.failure;
  const outcome = handle.outcome;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-center gap-2">
        <Press
          type="button"
          tone="quiet"
          size="label"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          title="what this route can do: its views, its chords, and what it is bound to"
        >
          <span className="face-mono">{open ? "▴" : "▾"}</span> {handle.manifest.name}
        </Press>
        {sentence ? <span className="t-small text-ink-2">{sentence}</span> : null}
        {handle.busy ? (
          <span className="t-small face-mono text-ink-mute">
            {handle.busy.key} · {handle.busy.seconds}s
          </span>
        ) : null}
        {/* ONE outcome line for both lanes. A refused chord and a refused click reach it by the
            same path — `useRoute` keeps the refusal on the owner, not in a per-surface copy. */}
        <span className="t-small text-ink-2" role="status" aria-label="Action outcome">
          {failure
            ? `${failure.code}: ${failure.message}`
            : outcome
              ? outcome.refusal
                ? `${outcome.label} · ${outcome.refusal.message}`
                : `${outcome.label} · ran`
              : ""}
        </span>
      </div>
      {open ? (
        <div className="flex flex-col gap-2 border border-line p-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {Object.entries(handle.actions).map(([key, action]) => {
              const value = action as RouteHandle<W, R, P, A>["actions"][A];
              // A refused or busy action is `aria-disabled`, never `disabled`: the click must
              // still reach `run`, because `run` is where the refusal sentence comes from, and
              // that is the SAME path the chord takes. A `disabled` button would make the two
              // surfaces disagree — the chord would speak and the button would be mute.
              const stopped = value.refusal !== null || handle.busy !== null;
              return (
                <Press
                  key={key}
                  type="button"
                  tone="quiet"
                  size="label"
                  state={stopped ? "disabled" : "rest"}
                  aria-disabled={stopped}
                  title={
                    value.refusal ?? (handle.busy ? `${handle.busy.key} is running` : value.says)
                  }
                  onClick={() => void value.run()}
                >
                  {value.label}
                  {value.chord ? <span className="face-mono"> {value.chord}</span> : null}
                </Press>
              );
            })}
          </div>
          {(handle.manifest.views ?? []).map((view) => (
            <div key={view.key}>{view.draws({ readings: handle.readings })}</div>
          ))}
          {handle.manifest.docs}
          <RouteInspector handle={handle} />
        </div>
      ) : null}
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

/** Explicit session management disclosure; unresolved targets keep their route head and body. */
export function useEmptyBody<W, R extends string, P, A extends string>(
  handle: RouteHandle<W, R, P, A>,
): ReactNode | null {
  const [target, choose] = useChooseTarget();
  const [open, setOpen] = useState(false);
  if (!handle.manifest.needs || handle.resolution.kind === "resolved") return null;
  if (handle.manifest.key === "instances") return null;
  return (
    <details className="my-2 text-sm" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer">Open a document or manage sessions</summary>
      {open ? <InstancesPage shell={false} target={target ?? ""} setTarget={choose} /> : null}
    </details>
  );
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
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const empty = useEmptyBody(handle);
  return (
    // The one landmark of the primitive. A route may override the printed head with its own word
    // (chat prints the thread's label), so the shell names itself with the MANIFEST's name: that
    // is the handle that a proof — or a screen reader — can hold on every route alike.
    <div
      role="region"
      aria-label={`${manifest.name} route`}
      className={`flex ${children ? "h-full" : ""} min-h-0 min-w-0 flex-col gap-2`}
    >
      <RouteKeys handle={handle} onRefusal={setRefusal} />
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
          {head ?? <Door handle={handle} refusal={refusal} />}
        </>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {empty}
        {children}
      </div>
    </div>
  );
}
