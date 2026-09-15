/**
 * A route declares itself once: its Work schema, its Readings, its Page, its actions, its views.
 * Nothing here renders and nothing here holds React state — `useRoute` runs a manifest and
 * `RouteShell` draws it. The fable calls this type `Route`; every `routes/*.tsx` already exports a
 * TanStack `Route`, so the type is `RouteManifest` and the per-route export is `manifest`.
 */
import type { ReactNode } from "react";
import type { z } from "zod";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { semanticActions, type SemanticActionKey } from "@pe/agent-contracts";
import type {
  ExecutionTarget,
  Reading,
  ReadingRequest,
  RouteStatePatch,
  RouteStateSpec,
  Seed,
  WorkKey,
} from "@pe/agent-contracts";
import type { Refusal } from "./refusal";

const semanticNeeds = {
  nothing: "host",
  session: "session",
  document: "document",
  "project-document": "project",
  "family-document": "family",
} as const;

export const semanticActionFacts = (key: SemanticActionKey) => {
  const { says, needs, actor } = semanticActions[key];
  return { says, needs: semanticNeeds[needs], actor };
};

export const semanticActionInput = (
  key: SemanticActionKey,
  input: unknown,
): Record<string, unknown> => semanticActions[key].input.parse(input);

export const semanticActionInputSchema = (key: SemanticActionKey): z.ZodType =>
  semanticActions[key].input;

/** What a Reading key names: a fixed subject, or one selected by the route's current Page. */
export type ReadingSpec<P> = ReadingRequest | ((page: P, work: WorkKey) => ReadingRequest | null);

/** What Work a route owns: the route-state spec that already carries schema, mask and commands. */
export type WorkSpec<W> = RouteStateSpec<z.ZodType<W>>;

/** A call bound to a resolved ExecutionTarget. */
export type HostCaller = (operation: string, input?: unknown) => Promise<unknown>;

/** What `ready` and `run` receive. No React, no render state. */
export interface Ctx<W, R extends string, P> {
  readonly target: ExecutionTarget;
  readonly work: {
    readonly key: WorkKey;
    readonly doc: W | null;
    readonly revision: number | null;
  };
  readonly readings: Readonly<Record<R, Reading<unknown>>>;
  readonly page: P;
  readonly call: HostCaller;
  readonly write: (patch: RouteStatePatch[]) => Promise<Refusal | null>;
  /**
   * One of the Work spec's own commands. `write` is the patch lane and this is the command lane;
   * both belong to the primitive so the demo lane can neutralize them. The runner reports any
   * refusal.
   */
  readonly command: (name: string, input?: unknown) => Promise<Refusal | null>;
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
  /** Browser Reading keys invalidated on success; semantic actions name Host and Pea resources. */
  dirties: readonly R[];
  /** State that must be current before this action may mutate. Previous values remain display-only. */
  requires?: { readonly work?: true; readonly readings?: readonly R[] };
  chord?: UseHotkeyDefinition["hotkey"];
  /** The stage this verb belongs to; absent = every stage. The Situation scopes its verb row by it. */
  stage?: string;
  /** Page state the verb carries in its button ("Partition 10"); null = no count. */
  count?: (ctx: Ctx<W, R, P>) => number | null;
  ready: (ctx: Ctx<W, R, P>, input: I) => string | null;
  run: (ctx: Ctx<W, R, P>, input: I) => Promise<void | Refusal | null>;
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
  readings?: Readonly<Record<R, ReadingSpec<P>>>;
  page?: z.ZodType<P>;
  /** The stages a route works in; `word` is the first word of the Situation ("Auditing rooms"). */
  stages?: readonly { key: string; word: string }[];
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
export const emptyManifest = (
  key: string,
  name: string,
): RouteManifest<never, never, never, never> => ({
  key,
  name,
});
