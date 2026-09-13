/**
 * A route declares itself once: its Work schema, its Readings, its Page, its actions, its views.
 * Nothing here renders and nothing here holds React state — `useRoute` runs a manifest and
 * `RouteShell` draws it. The fable calls this type `Route`; every `routes/*.tsx` already exports a
 * TanStack `Route`, so the type is `RouteManifest` and the per-route export is `manifest`.
 */
import type { ReactNode } from "react";
import type { z } from "zod";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import type {
  ExecutionTarget,
  Reading,
  ReadingRequest,
  RouteStatePatch,
  RouteStateSpec,
  Seed,
} from "@pe/agent-contracts";

/** What a Reading key names: the request the owner subscribes for it. */
export type ReadingSpec = ReadingRequest;

/** What Work a route owns: the route-state spec that already carries schema, mask and commands. */
export type WorkSpec<W> = RouteStateSpec<z.ZodType<W>>;

/** A call bound to a resolved ExecutionTarget. */
export type HostCaller = (operation: string, input?: unknown) => Promise<unknown>;

/** What `ready` and `run` receive. No React, no render state. */
export interface Ctx<W, R extends string, P> {
  readonly target: ExecutionTarget;
  readonly work: { readonly doc: W; readonly revision: number };
  readonly readings: Readonly<Record<R, Reading<unknown>>>;
  readonly page: P;
  readonly call: HostCaller;
  readonly write: (patch: RouteStatePatch[]) => Promise<void>;
  /**
   * One of the Work spec's own commands. `write` is the patch lane and this is the command lane;
   * both belong to the primitive so the demo lane can neutralize them. An action that reached for
   * its own `docWriter` instead (settings did) could not be seeded: the seed is the document, and
   * a closure writer only ever saw the unhydrated live one. A refusal throws — `run` reports it.
   */
  readonly command: (name: string, input?: unknown) => Promise<void>;
  /**
   * An external mutation — one that earns a receipt outside the Work document. It runs for real
   * everywhere except the demo lane, where the seed IS the outcome and `null` comes back instead
   * of a receipt. Without this lane a seeded `save` reached the live host and failed there.
   */
  readonly external: <A>(run: () => Promise<A>) => Promise<A | null>;
  readonly setPage: (next: Partial<P>) => void;
}

export interface RouteAction<W, R extends string, P, I = void> {
  label: string;
  says: string;
  needs: "host" | "session" | "document" | "project" | "family";
  actor: "any" | "human";
  input: z.ZodType<I>;
  dirties: readonly R[];
  chord?: UseHotkeyDefinition["hotkey"];
  ready: (ctx: Ctx<W, R, P>, input: I) => string | null;
  run: (ctx: Ctx<W, R, P>, input: I) => Promise<void>;
}

export interface View<R extends string> {
  key: string;
  label: string;
  draws: (props: { readonly readings: Readonly<Record<R, Reading<unknown>>> }) => ReactNode;
}

export interface RouteManifest<W, R extends string, P, A extends string> {
  key: string;
  name: string;
  needs?: "session" | "document" | "project" | "family";
  work?: WorkSpec<W>;
  readings?: Readonly<Record<R, ReadingSpec>>;
  page?: z.ZodType<P>;
  actions?: Readonly<Record<A, RouteAction<W, R, P, never>>>;
  views?: readonly View<R>[];
  seeds?: Readonly<Partial<Record<A, Seed<W, R, P>>>>;
  docs?: ReactNode;
}

/** Identity, for inference only. Exactly one `manifest` per route module (fable §8). */
export const defineRoute = <W, const R extends string, P, const A extends string>(
  m: RouteManifest<W, R, P, A>,
): RouteManifest<W, R, P, A> => m;

/** An empty manifest is a legal manifest: the shell must render one. */
export const emptyManifest = (key: string, name: string): RouteManifest<never, never, never, never> => ({
  key,
  name,
});
