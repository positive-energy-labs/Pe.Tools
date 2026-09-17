/**
 * A route declares itself once: its Work schema, its Readings, its Page, its actions, its views.
 * Nothing here renders and nothing here holds React state â€” `useRoute` runs a manifest and
 * `RouteShell` draws it. The fable calls this type `Route`; every `routes/*.tsx` already exports a
 * TanStack `Route`, so the type is `RouteManifest` and the per-route export is `manifest`.
 */
import type { ReactNode } from "react";
import { z } from "zod";
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
  /** The patch lane on the Work document. Throws the refusal; the runner reports it. */
  readonly write: (patch: RouteStatePatch[]) => Promise<Refusal | null>;
  /** The command lane on the Work document, one of the Work spec's own commands. */
  readonly command: (name: string, input?: unknown) => Promise<Refusal | null>;
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

/** Identity, for inference only. Exactly one `manifest` per route module (fable Â§8). */
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

/* â”€â”€ The entity route kernel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/** A pod member's address, everywhere (dogma law 11). */
export interface MemberRef {
  pod: string;
  path: string;
}

/** One `pod.list` row, as the host projects it. */
export interface PodRow {
  id: string;
  name: string;
  version: string;
  folder: string;
  entrypoints: readonly string[];
  members: readonly { path: string; sha256: string; schema: string | null }[];
  diagnostics: readonly { message: string; path?: string }[];
}

export type EntityStage = "audit" | "capture" | "apply";
export type EntityAction = "capture" | "apply";
/** The Reading every entity route shares: the installed pods, provided by the route's owner. */
export type EntityReading = "pods";

export interface EntityPage {
  stage: EntityStage;
  /** The member the editor holds; capture lands here, apply reads it. Empty = none. */
  pod: string;
  path: string;
}

export const entityPage = z.object({
  stage: z.enum(["audit", "capture", "apply"]).default("audit"),
  pod: z.string().default(""),
  path: z.string().default(""),
});

/** An entity route, declared once: `/family`, `/families`, `/schedules` differ only here. */
export interface EntityRouteDef<W, R extends string, P> {
  key: string;
  name: string;
  /** The noun a captured member is filed under: `settings/<entity>/â€¦`. */
  entity: string;
  /** `selection` = the document plus the audit rows the route has picked. */
  target: "document" | "selection";
  /** The spec's `$schema` path (`/schemas/settings/…`); the only thing that says a member is this route's. */
  schema: string;
  capture: string;
  /** Families only: the confirmation sheet behind apply (dogma law 9). */
  plan?: string;
  apply: string;
  /** What capture needs beyond the target, read off the audit; a string refuses. */
  captureInput?: (ctx: Ctx<W, R, P & EntityPage>) => Record<string, unknown> | string;
  docs?: ReactNode;
}

/** `$schema` is an absolute URL on whichever host served it; the path is what names the library. */
export const isSpecOf = (schema: string | null | undefined, path: string) => {
  if (!schema) return false;
  try {
    return new URL(schema, "http://host").pathname === path;
  } catch {
    return false;
  }
};

type EntityCtx = Ctx<unknown, string, EntityPage>;

const targetInput = (ctx: EntityCtx) =>
  ctx.target.kind === "document" ? { target: ctx.target.ref } : {};

const podsOf = (ctx: EntityCtx) => {
  const reading = ctx.readings.pods;
  return reading?.state === "ready" ? (reading.observation as readonly PodRow[]) : [];
};

/** Capture always files a new member; the timestamp is the only thing that makes it new. */
export const capturePath = (entity: string, at = new Date()) =>
  `settings/${entity}/${at.toISOString().replace(/[:.]/g, "-")}.json`;

/**
 * The one entity route. Stages are audit, capture, apply; the audit's own Work, Readings and
 * verbs (a grid's `push`) ride in `audit` and keep their names.
 */
export function entityRoute<W, const R extends string, P extends object, const A extends string>(
  def: EntityRouteDef<W, R, P>,
  audit: Pick<RouteManifest<W, R, P, A>, "work" | "readings" | "page" | "actions" | "seeds"> = {},
): RouteManifest<W, R | EntityReading, P & EntityPage, A | EntityAction> {
  const actions: Record<EntityAction, RouteAction<unknown, string, EntityPage, never>> = {
    capture: {
      label: `capture ${def.entity}`,
      says: `reads the ${def.entity} from Revit into a new member of the chosen pod`,
      needs: "project",
      actor: "any",
      stage: "capture",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: ["pods"],
      ready: (ctx) => {
        if (!ctx.page.pod) return "choose the pod the capture lands in";
        const extra = def.captureInput?.(ctx as never);
        return typeof extra === "string" ? extra : null;
      },
      run: async (ctx) => {
        const extra = def.captureInput?.(ctx as never);
        if (typeof extra === "string") throw Error(extra);
        const spec = await ctx.call(def.capture, { ...targetInput(ctx), ...extra });
        const path = capturePath(def.entity);
        const $schema = new URL(def.schema, globalThis.location.origin).href;
        const content = JSON.stringify({ $schema, ...(spec as object) }, null, 2);
        await ctx.call("pod.member.write", { pod: ctx.page.pod, path, content });
        ctx.setPage({ path });
      },
    },
    apply: {
      label: `apply ${def.entity}`,
      says: `writes the saved ${def.entity} spec to Revit and files a run receipt in its pod`,
      needs: "project",
      actor: "human",
      stage: "apply",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: ["pods"],
      ready: (ctx) => {
        if (!ctx.page.pod || !ctx.page.path) return "open a saved spec first";
        const pod = podsOf(ctx).find((row) => row.id === ctx.page.pod);
        const member = pod?.members.find((row) => row.path === ctx.page.path);
        if (!member) return "save the spec before applying";
        return isSpecOf(member.schema, def.schema)
          ? null
          : `the member is not a ${def.entity} spec`;
      },
      run: async (ctx) => {
        const { pod, path } = ctx.page;
        const member = podsOf(ctx)
          .find((row) => row.id === pod)
          ?.members.find((row) => row.path === path);
        if (!member) throw Error("save the spec before applying");
        const { composed } = (await ctx.call("pod.member.compose", { pod, path })) as {
          composed: unknown;
        };
        const source = { pod, path, sha256: member.sha256 };
        const plan = def.plan
          ? ((await ctx.call(def.plan, { ...targetInput(ctx), spec: composed })) as {
              planHash: string;
            })
          : null;
        await ctx.call(def.apply, {
          ...targetInput(ctx),
          spec: composed,
          source,
          ...(plan ? { planHash: plan.planHash } : {}),
        });
      },
    },
  };
  return defineRoute({
    key: def.key,
    name: def.name,
    docs: def.docs,
    needs: "project",
    stages: [
      { key: "audit", word: "Auditing" },
      { key: "capture", word: "Capturing" },
      { key: "apply", word: "Applying" },
    ],
    work: audit.work,
    // `pods` is provided by the route's owner (a live `pod.list`, or the seed); never subscribed.
    readings: { ...audit.readings, pods: () => null } as Record<
      R | EntityReading,
      ReadingSpec<P & EntityPage>
    >,
    page: (audit.page ? z.intersection(audit.page, entityPage) : entityPage) as z.ZodType<
      P & EntityPage
    >,
    actions: { ...audit.actions, ...actions } as never,
    seeds: audit.seeds as never,
  });
}
