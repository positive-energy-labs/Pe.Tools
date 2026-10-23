/**
 * THE SHELL — the one route chrome: the chord bindings, and a head for a route that has not been
 * cut over to a Situation yet (name, verb row). The Situation (`situation.tsx`) is the one head;
 * the shell draws none of its own when a route hands one in.
 *
 * No connected-or-not lamp: those states left product chrome (host ledger 2026-10-09). Machine
 * state and repair actions live on the canonical Machine route; configuration lives in Settings.
 */
import { useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { useRouteNavigate, useRouteSearch } from "./activity";

import {
  PrimaryRouteControls,
  useHasGlobalNavigation,
  useIsPrimaryRoute,
} from "#/navigation/route-controls";
import { ThemeToggle } from "@pe/kit/lang/theme-toggle";
import { usePublishRouteOptions } from "#/settings/options";

import { RouteHelpButton } from "./help";
import { HostedChrome } from "./hosted-chrome";
import { KeysNode } from "@pe/kit/keys";
import { manifestChords } from "./keys";
import type { RouteManifest } from "./manifest";
import { SituationAction } from "./situation-verbs";
import { useRoute } from "./use-route";
import type { RouteHandle } from "./handle";

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
  const verbs = Object.entries(handle.actions).filter(
    ([name]) =>
      (handle.manifest.actions as Record<string, { visible?: false }> | undefined)?.[name]
        ?.visible !== false,
  ) as [string, RouteHandle<W, R, P, A>["actions"][A]][];
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
  children?: ReactNode;
}

/**
 * The one `?target` reader/writer every shell and route shares. Grammar lives in `parseTarget`.
 * A person's pick is a named move and pushes (N5: Back returns to the previous target); only a
 * pick the page makes for them (auto-binding the one open document) replaces.
 */
export function useChooseTarget(): [
  string | null,
  (target: string | null, history?: "push" | "replace") => void,
] {
  const navigate = useRouteNavigate();
  const search = useRouteSearch();
  const choose = useCallback(
    (target: string | null, history: "push" | "replace" = "push") =>
      void navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          target: target || undefined,
        }),
        replace: history === "replace",
      }),
    [navigate],
  );
  return [search.target ?? null, choose];
}

/**
 * The route's target context, from `?thread`. An unaddressed route issues a browser-only draft;
 * its first chat send promotes it to a durable host conversation.
 */
export function useRouteThread(): string {
  const navigate = useRouteNavigate();
  const search = useRouteSearch();
  const minted = useRef<string | null>(null);
  if (search.thread) minted.current = null;
  else minted.current ??= crypto.randomUUID();
  const thread = search.thread ?? minted.current!;
  useEffect(() => {
    if (!search.thread) {
      // Keep issuance across a target pick or refresh until the host creates the real thread.
      try {
        sessionStorage.setItem(`pe.routeThread.${thread}`, "minted");
      } catch {
        /* History also carries issuance. */
      }
      void navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({ ...previous, thread }),
        state: (previous) => ({ ...previous, __peMintedThread: thread }),
        replace: true,
      });
    }
  }, [navigate, search.thread, thread]);
  return thread;
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
  children,
}: ShellProps<W, R, P, A>) {
  const chrome = useContext(HostedChrome);
  const globalNavigation = useHasGlobalNavigation();
  const primary = useIsPrimaryRoute(manifest.key);
  usePublishRouteOptions(
    manifest.key,
    manifest.name,
    manifest.options,
    handle.page[0],
    handle.page[1],
  );
  return (
    // The one landmark of the primitive. A route may override the printed head with its own word
    // (chat prints the thread's label), so the shell names itself with the MANIFEST's name: that
    // is the handle that a proof — or a screen reader — can hold on every route alike.
    <div
      role="region"
      aria-label={`${manifest.name} route`}
      className={`flex ${children ? "h-full" : ""} min-h-0 min-w-0 flex-col gap-2`}
    >
      <KeysNode id={manifest.name} keys={manifestChords(handle)}>
        {situation ?? (
          <>
            <PrimaryRouteControls route={manifest.key} slot="situation">
              {(aside || head || Object.keys(handle.actions).length > 0 || !primary) && (
                <div data-surface="page" className="flex min-w-0 flex-col gap-2 p-3">
                  {!primary && (
                    <div className="flex min-w-0 items-center justify-between gap-4">
                      <h1 className="t-head face-display text-ink">{name ?? manifest.name}</h1>
                    </div>
                  )}
                  {aside}
                  {head ?? <ShellVerbs handle={handle} />}
                </div>
              )}
            </PrimaryRouteControls>
            <PrimaryRouteControls route={manifest.key}>
              <RouteHelpButton name={manifest.name} docs={manifest.docs} />
              {!globalNavigation && <ThemeToggle />}
              {chrome}
            </PrimaryRouteControls>
          </>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </KeysNode>
    </div>
  );
}
