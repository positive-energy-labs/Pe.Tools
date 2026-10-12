/**
 * THE SHELL — the one route chrome: the chord bindings, and a head for a route that has not been
 * cut over to a Situation yet (name, verb row). The Situation (`situation.tsx`) is the one head;
 * the shell draws none of its own when a route hands one in.
 *
 * No connected-or-not lamp: those states left product chrome (host ledger 2026-10-09). Machine
 * state, update included, is the version chip's drawer (`machine/drawer.tsx`).
 */
import { useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/lang/theme-toggle";

import { RouteHelpButton } from "./help";
import { HostedChrome } from "./hosted-chrome";
import { KeysNode, manifestChords } from "./keys";
import type { RouteManifest } from "./manifest";
import { SituationAction } from "./situation-verbs";
import { useRoute, type RouteHandle } from "./use-route";

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

/**
 * The thread this page's target lives on, from `?thread`. A page opened without one mints a fresh
 * thread and writes it into the URL, the way `/chat` opens an empty thread; the root retains it on
 * every link after that. (Re-openable: "latest thread" instead of a fresh one.)
 */
export function useRouteThread(): string {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { thread?: string };
  const [minted] = useState(() => crypto.randomUUID());
  const thread = search.thread ?? minted;
  useEffect(() => {
    if (!search.thread)
      void navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({ ...previous, thread }),
        replace: true,
      });
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
            <div className="flex min-w-0 items-center justify-between gap-4">
              <h1 className="t-head face-display text-ink">{name ?? manifest.name}</h1>
              <span className="flex shrink-0 items-center gap-3">
                {aside}
                <RouteHelpButton name={manifest.name} docs={manifest.docs} />
                <ThemeToggle />
                {chrome}
              </span>
            </div>
            {head ?? <ShellVerbs handle={handle} />}
          </>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </KeysNode>
    </div>
  );
}
