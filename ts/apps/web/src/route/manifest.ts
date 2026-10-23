/**
 * A route declares itself once: its Work schema, its Readings, its Page, its actions, its views.
 * Nothing here renders and nothing here holds React state — `useRoute` runs a manifest and
 * `RouteShell` draws it. The fable calls this type `Route`; every `routes/*.tsx` already exports a
 * TanStack `Route`, so the type is `RouteManifest` and the per-route export is `manifest`.
 */
import type { Inspectable, InspectableRef } from "./inspect";
import type { OpKey, OpCallArgs, OpResponseOf } from "@pe/host-contracts/operation-types";
import type { ReactNode } from "react";
import { z } from "zod";
import type { Chord } from "@pe/kit/keys";
import {
  semanticActions,
  type SemanticActionKey,
  type ExecutionTarget,
  type HostActionKey,
  type Reading,
  type ReadingRequest,
  type History,
  type RouteKey,
  type RouteStatePatch,
  type RouteStateSpec,
  type Seed,
  type WorkKey,
} from "@pe/agent-contracts";
import type { ActionIdentity } from "./facts";
import type { Refusal } from "./refusal";
import type { Cells } from "./cells";
import type { GlobalOption, PageOption } from "#/settings/option-state";
import { registerGlobalOptions } from "#/settings/option-catalogue";

export const semanticActionInput = (
  key: SemanticActionKey,
  input: unknown,
): Record<string, unknown> => semanticActions[key].input.parse(input);

/** What a Reading key names: a fixed subject, or one selected by the route's current Page. */
export type ReadingSpec<P> = ReadingRequest | ((page: P, work: WorkKey) => ReadingRequest | null);

/** What Work a route owns: the route-state spec that already carries schema, mask and commands. */
type WorkSpec<W> = RouteStateSpec<z.ZodType<W>>;

/** A call bound to a resolved ExecutionTarget. */
export type HostCaller = <K extends OpKey>(
  operation: K,
  ...args: OpCallArgs<K, never>
) => Promise<OpResponseOf<K>>;

/** What `ready` and `run` receive. No React, no render state. */
export interface Ctx<W, R extends string, P> {
  readonly target: ExecutionTarget;
  readonly work: {
    readonly key: WorkKey;
    readonly doc: W | null;
    readonly revision: number | null;
    /** Why the Work cannot be read (unreadable saved Work); null when it can. */
    readonly refusal: string | null;
  };
  readonly readings: Readonly<Record<R, Reading<unknown>>>;
  readonly page: P;
  readonly call: HostCaller;
  /** The patch lane on the Work document. Throws the refusal; the runner reports it. */
  readonly write: (patch: RouteStatePatch[]) => Promise<Refusal | null>;
  /** The command lane on the Work document, one of the Work spec's own commands. */
  readonly command: (name: string, input?: unknown) => Promise<Refusal | null>;
  /** Publishes action progress only while its original Target, Work, and user Page remain current. */
  readonly setPage: (next: Partial<P>, options?: PageMove<P> | readonly (keyof P)[]) => void;
  /** One page-log line from inside the verb: what its result says beside its outcome. */
  readonly note: (label: string, says: string, refused?: boolean, link?: InspectableRef) => void;
}

/**
 * How a page move lands in history: a named move (frame, preset, a Pea patch) pushes one entry; a
 * continuous gesture (wheel, drag, orbit, typing) replaces it. `guard` drops the move when one of
 * those fields changed since the action began (a bare array is the guard alone).
 */
export interface PageMove<P> {
  readonly history?: History;
  readonly guard?: readonly (keyof P)[];
}

export type PageTransitionOrigin = "page" | "action" | "pea" | "url" | "initial";

/** Pure coupled Page rules. The owner validates the normalized patch as one complete candidate.
 * Restores reset dependents too. The owner preserves explicitly restored fields atomically;
 * evidence-dependent guards defer URL/initial membership checks until the Reading arrives.
 */
export type PageTransition<P> = (
  current: Readonly<P>,
  patch: Readonly<Partial<P>>,
  origin: PageTransitionOrigin,
) => { readonly patch: Partial<P> } | { readonly refusal: Refusal };

import { DEFAULT_WAIT_S, HOST_READ_WAIT_S } from "./waits";
export { DEFAULT_WAIT_S, HOST_READ_WAIT_S };

export type RouteAction<W, R extends string, P, I = void> = ActionIdentity<W, R, P> & {
  label: string;
  /** What it does now, when that depends on the state (apply: plan first, or send the plan). */
  saysNow?: (ctx: Ctx<W, R, P>) => string;
  /** Its button word now, when the verb names its object ("apply 3 cells", "apply spec a.json"). */
  labelNow?: (ctx: Ctx<W, R, P>) => string;
  /** True when this press only plans (apply's first press): it changes nothing, so dirties nothing. */
  plans?: (ctx: Ctx<W, R, P>) => boolean;
  input: z.ZodType<I>;
  /** Browser Reading keys invalidated on success; semantic actions name Host and Pea resources. */
  dirties: readonly R[];
  /** What this verb reads again (a Reading key, or `work`); Revit's change mark there makes it stale. A `read`/`refresh` verb must declare it (ruling 5). */
  rereads?: R | "work";
  /**
   * How long this verb may stay in flight before it ends as "stopped: no answer after Ns" and
   * releases busy (a timeout is a diagnostic boundary, never a retry). Default `DEFAULT_WAIT_S`.
   */
  waitSeconds?: number;
  /** State that must be current before this action may mutate. Previous values remain display-only. */
  requires?: { readonly work?: true; readonly readings?: readonly R[] };
  chord?: Chord;
  /** The stage this verb belongs to; absent = every stage. The Situation scopes its verb row by it. */
  stage?: string;
  /** Available to route callers and Pea, without a bare button in the verb row. */
  visible?: false;
  /** Page state the verb carries in its button ("Partition 10"); null = no count. */
  count?: (ctx: Ctx<W, R, P>) => number | null;
  ready: (ctx: Ctx<W, R, P>, input: I) => string | null;
  run: (ctx: Ctx<W, R, P>, input: I) => Promise<void | Refusal | null>;
};

interface View<R extends string> {
  key: string;
  label: string;
  draws: (props: { readonly readings: Readonly<Record<R, Reading<unknown>>> }) => ReactNode;
}

export interface RouteManifest<W, R extends string, P, A extends string> {
  key: string;
  name: string;
  needs?: "session" | "document" | "project" | "family";
  work?: WorkSpec<W>;
  /** The Chat head's Work key: absent = the thread document's Address, null = none it can name. */
  workKey?: WorkKey | null;
  /** The Work's trichotomy cell families; the Situation reads the first keyed, the head all. */
  cells?: readonly Cells<W>[];
  /** What its verbs produce, by kind, and how each opens; `member`, `receipt` and `capture` are built in (`inspect.tsx`). */
  inspectables?: Readonly<Record<string, Inspectable>>;
  readings?: Readonly<Record<R, ReadingSpec<P>>>;
  page?: z.ZodType<P>;
  /** One normalization boundary for human, action and Pea moves. Never runs native work. */
  transition?: PageTransition<P>;
  /**
   * The route's address in agent-contracts (`routeAddress(route)`): its fields say which Page keys the
   * URL carries, how each moves history, and what Pea reads and sets. The page schema extends
   * `routeAddress(route).schema`.
   */
  address?: RouteKey;
  /** The stages a route works in; `word` is the first word of the Situation ("Auditing rooms"). */
  stages?: readonly { key: string; word: string }[];
  actions?: {
    readonly [K in A]: RouteAction<W, R, P, never> &
      (K extends "read" | "refresh" ? { rereads: R | "work" } : unknown);
  };
  views?: readonly View<R>[];
  /** Host actions this route's views run that no declared verb `does`: with the verbs, what a
   * transcript record of that action opens (`workbench/chat-plugins.ts` `actionRoute`). */
  runs?: readonly HostActionKey[];
  seeds?: Readonly<Partial<Record<A, Seed<W, R, P>>>>;
  docs?: ReactNode;
  /** Projections bind to this route instance's Page and disappear with its owner. */
  options?: readonly PageOption<P>[];
  /** External owner bindings remain available in Settings after this Page unmounts. */
  globalOptions?: readonly GlobalOption[];
}

/** Identity, for inference only. Exactly one `manifest` per route module (fable §8). */
export const defineRoute = <W, const R extends string, P, const A extends string>(
  m: RouteManifest<W, R, P, A>,
): RouteManifest<W, R, P, A> => {
  registerGlobalOptions(m.key, m.name, m.globalOptions ?? []);
  return m;
};
