/**
 * A route declares itself once: its Work schema, its Readings, its Page, its actions, its views.
 * Nothing here renders and nothing here holds React state — `useRoute` runs a manifest and
 * `RouteShell` draws it. The fable calls this type `Route`; every `routes/*.tsx` already exports a
 * TanStack `Route`, so the type is `RouteManifest` and the per-route export is `manifest`.
 */
import type { PodList } from "@pe/host-contracts/operation-types";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { ReactNode } from "react";
import { z } from "zod";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { semanticActions, type ActionBases, type SemanticActionKey } from "@pe/agent-contracts";
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

/* ── The entity route kernel ─────────────────────────────────────────────────── */

/** A pod member's address, everywhere (dogma law 11). */
export interface MemberRef {
  pod: string;
  path: string;
}

/** One `pod.list` row, as the host projects it. */
export type PodRow = PodList["pods"][number];

export type EntityStage = "audit" | "capture" | "apply";
export type EntityAction = "capture" | "apply" | "confirm";
/** The Reading every entity route shares: the installed pods, provided by the route's owner. */
export type EntityReading = "pods";

/** One row of the confirmation sheet: what apply would do to one subject. */
export interface PlanEntry {
  id: string;
  name: string;
  planHash: string;
  /** Concrete edits the plan compiled. */
  actions: number;
  /** Where the edits came from, as the plan reported it. */
  detail: string;
  /** Why this row cannot be applied (a refusal, or nothing to do); null = applicable. */
  flag: string | null;
  warnings: readonly string[];
  /**
   * The saved member this row was planned from, when the sheet's rows come from more than one —
   * a staged audit generates one member per subject, so apply has to send each row's hashes back
   * to the member that produced them.
   */
  source?: MemberSource;
}

/** The plan apply confirms (dogma law 9), as its confirm workflow returned it. */
export interface PlanSheet {
  entries: readonly PlanEntry[];
}

export interface EntityPage {
  stage: EntityStage;
  /** The member the editor holds; capture lands here, apply reads it. Empty = none. */
  pod: string;
  path: string;
  /** Audit rows picked for capture when the target kind is `selection`. */
  selection: string[];
  /** The confirmation sheet is open. Page, never URL. */
  confirming: boolean;
  /** The sheet the plan read returned. */
  sheet: PlanSheet | null;
}

export const entityPage = z.object({
  stage: z.enum(["audit", "capture", "apply"]).default("audit"),
  pod: z.string().default(""),
  path: z.string().default(""),
  selection: z.array(z.string()).default([]),
  confirming: z.boolean().default(false),
  sheet: z.custom<PlanSheet>().nullable().default(null),
});

/** The URL half of the entity page: every entity route's search carries stage, pod and path. */
export type EntitySearch = Partial<Pick<EntityPage, "stage" | "pod" | "path">>;

export const entitySearch = (search: Record<string, unknown>): EntitySearch => ({
  ...(search.stage === "audit" || search.stage === "capture" || search.stage === "apply"
    ? { stage: search.stage }
    : {}),
  ...(typeof search.pod === "string" && search.pod ? { pod: search.pod } : {}),
  ...(typeof search.path === "string" && search.path ? { path: search.path } : {}),
});

/** What a plan lane reads to draw its sheet: the handle's view, with no host reach. */
export type EntityView<W, R extends string, P> = Pick<
  Ctx<W, R | EntityReading, P & EntityPage>,
  "work" | "readings" | "page"
>;

export interface MemberSource extends MemberRef {
  sha256: string;
}

/**
 * Apply as a confirmation (dogma law 9): `read` plans the saved spec and returns the sheet, the
 * page holds it, and `confirm` applies exactly the included rows' hashes.
 */
export interface ApplyPlan<W, R extends string, P> {
  read: (
    ctx: Ctx<W, R | EntityReading, P & EntityPage>,
    source: MemberSource,
  ) => Promise<PlanSheet>;
  /** Rows held back from apply; the route holds them where its host checks them. */
  excluded?: (view: EntityView<W, R, P>) => readonly string[];
  confirm: (
    ctx: Ctx<W, R | EntityReading, P & EntityPage>,
    included: readonly PlanEntry[],
    source: MemberSource,
  ) => Promise<void>;
}

/** An entity route, declared once: `/family`, `/families`, `/schedules` differ only here. */
export interface EntityRouteDef<W, R extends string, P> {
  key: string;
  name: string;
  /** The noun a captured member is filed under: `settings/<entity>/…`. */
  entity: string;
  /** `selection` = the document plus the audit rows the route has picked (`page.selection`). */
  target: "document" | "selection";
  /**
   * The spec `$schema` path(s) (`/schemas/settings/…`); the only thing that says a member is this
   * route's. The first is what a new draft is written against.
   */
  schema: string | readonly [string, ...string[]];
  /** The host workflow that captures into the route's pod and returns the new member(s). */
  capture: SemanticActionKey;
  /** The host workflow that applies a saved spec in one step, when there is no plan. */
  apply: SemanticActionKey;
  /** Present = apply is a confirmation over this plan. */
  plan?: ApplyPlan<W, R, P>;
  /**
   * Present = the audit stages edits of its own, and plan generates the spec from them AT THAT
   * MOMENT rather than reading a member the person saved (dogma law 10 still holds: the generated
   * member is the saved content, and the run receipt names it). With staged edits the route owns
   * both halves of the confirmation; with none it falls back to `plan` over the page's member.
   */
  staged?: {
    count: (ctx: Ctx<W, R | EntityReading, P & EntityPage>) => number;
    plan: (ctx: Ctx<W, R | EntityReading, P & EntityPage>) => Promise<PlanSheet>;
    apply: (
      ctx: Ctx<W, R | EntityReading, P & EntityPage>,
      included: readonly PlanEntry[],
    ) => Promise<void>;
  };
  /**
   * What the route needs bound before it reads anything; default `project`. The verbs need what
   * their host workflow's contract says (`family.apply` needs a family document).
   */
  needs?: RouteManifest<W, R, P, never>["needs"];
  /** Where the Situation offers the spec picker; default `apply`. `always` = the audit edits a member. */
  specPicker?: "always" | "apply";
  /** What the route does with the capture workflow's whole result (evidence beside the new member). */
  onCaptured?: (
    result: Record<string, unknown>,
    ctx: Ctx<W, R | EntityReading, P & EntityPage>,
  ) => void;
  /** What capture needs beyond the pod, read off the audit; a string refuses. */
  captureInput?: (
    ctx: Ctx<W, R | EntityReading, P & EntityPage>,
  ) => Record<string, unknown> | string;
  docs?: ReactNode;
}

/** `$schema` is an absolute URL on whichever host served it; the path is what names the library. */
export const isSpecOf = (schema: string | null | undefined, path: string | readonly string[]) => {
  if (!schema) return false;
  try {
    return [path].flat().includes(new URL(schema, "http://host").pathname);
  } catch {
    return false;
  }
};

type EntityCtx = Ctx<unknown, string, EntityPage>;
type Viewed = { page: EntityPage; readings: Readonly<Record<string, Reading<unknown>>> };

const documentOf = (ctx: { target: ExecutionTarget }) => {
  if (ctx.target.kind !== "document") throw Error("pick a document");
  return ctx.target.ref;
};

/** A host workflow's result, or its refusal as an error. */
export const workflow = async (
  key: SemanticActionKey,
  input: Record<string, unknown>,
  ctx: { target: ExecutionTarget },
  bases?: ActionBases,
): Promise<Record<string, unknown>> => {
  const action = await runSemanticAction(key, input, documentOf(ctx), bases);
  if (action.state !== "succeeded")
    throw Error(
      "error" in action && action.error ? String(action.error) : `${key} ${action.state}`,
    );
  return (action as unknown as { result: Record<string, unknown> }).result;
};

/**
 * The plan lane for a confirm/apply workflow pair (dogma law 14): `confirm` returns `{ plan }` and
 * mutates nothing, `apply` requires the hashes it returned. `plan` is one plan or one per subject;
 * apply sends each included row's hash as `expectedPlanHashes`.
 * `authored` is what the route's Work adds to both; with it, confirm reads against that revision.
 */
export const admissionPlan = <W, R extends string, P>(
  keys: { confirm: SemanticActionKey; apply: SemanticActionKey },
  row: (plan: unknown) => PlanEntry,
  authored?: (work: W) => { executionOptions?: unknown } & Record<string, unknown>,
): ApplyPlan<W, R, P> => {
  const workOf = (
    ctx: Ctx<W, R | EntityReading, P & EntityPage>,
  ): { input: { executionOptions?: unknown }; bases?: ActionBases } => {
    if (!authored) return { input: {} };
    const { doc, key, revision } = ctx.work;
    if (!doc || revision === null) throw Error("author the route's Work first");
    return { input: authored(doc), bases: { work: { key: key as WorkKey, revision } } };
  };
  return {
    read: async (ctx, source) => {
      const { input, bases } = workOf(ctx);
      const result = await workflow(keys.confirm, { source, ...input }, ctx, bases);
      return { entries: [result.plan].flat().map(row) };
    },
    confirm: async (ctx, included, source) => {
      const { executionOptions } = workOf(ctx).input;
      await workflow(
        keys.apply,
        {
          source,
          ...(executionOptions ? { executionOptions } : {}),
          expectedPlanHashes: Object.fromEntries(included.map((r) => [r.id, r.planHash])),
        },
        ctx,
      );
    },
  };
};

const podsOf = (view: Viewed) => {
  const reading = view.readings.pods;
  return reading?.state === "ready" ? (reading.observation as readonly PodRow[]) : [];
};

/** The saved member the page names, if the pod list holds it. */
export const memberOf = (view: Viewed) =>
  podsOf(view)
    .find((row) => row.id === view.page.pod)
    ?.members.find((row) => row.path === view.page.path);

/** The sheet the route draws, and which of its rows apply would send. */
export function sheetOf<W, R extends string, P>(
  def: EntityRouteDef<W, R, P>,
  view: EntityView<W, R, P>,
): { sheet: PlanSheet; excluded: ReadonlySet<string>; included: readonly PlanEntry[] } | null {
  const sheet = view.page.sheet;
  if (!sheet) return null;
  const excluded = new Set(def.plan?.excluded?.(view) ?? []);
  return {
    sheet,
    excluded,
    included: sheet.entries.filter((entry) => !entry.flag && !excluded.has(entry.id)),
  };
}

/**
 * The one entity route. Stages are audit, capture, apply; the audit's own Work, Readings and
 * verbs (a grid's `push`) ride in `audit` and keep their names. With a plan lane, `apply` plans
 * and opens the sheet and `confirm` applies; without one, `apply` applies.
 */
export function entityRoute<W, const R extends string, P extends object, const A extends string>(
  def: EntityRouteDef<W, R, P>,
  audit: Pick<RouteManifest<W, R, P, A>, "work" | "readings" | "page" | "actions" | "seeds"> = {},
): RouteManifest<W, R | EntityReading, P & EntityPage, A | EntityAction> {
  const plan = def.plan as ApplyPlan<unknown, string, object> | undefined;
  const staged = def.staged as EntityRouteDef<unknown, string, object>["staged"];
  /** How many edits the audit has staged; 0 = the verbs read the page's saved member instead. */
  const stagedCount = (ctx: EntityCtx) => staged?.count(ctx as never) ?? 0;
  const sheetView = (ctx: EntityCtx) => sheetOf(def as never, ctx as never);
  const sourceOf = (ctx: EntityCtx): MemberSource => {
    const member = memberOf(ctx);
    if (!member) throw Error("save the spec before applying");
    return { pod: ctx.page.pod, path: ctx.page.path, sha256: member.sha256 };
  };
  const capture: RouteAction<unknown, string, EntityPage, never> = {
    label: `capture ${def.entity}`,
    says: `reads the ${def.entity} from Revit into new members of the chosen pod`,
    actor: "any",
    stage: "capture",
    needs: semanticActionFacts(def.capture).needs,
    input: z.void() as unknown as z.ZodType<never>,
    dirties: ["pods"],
    count: (ctx) => (def.target === "selection" ? ctx.page.selection.length || null : null),
    ready: (ctx) => {
      if (!ctx.page.pod) return "choose the pod the capture lands in";
      if (def.target === "selection" && !ctx.page.selection.length)
        return "pick rows in the audit first";
      const extra = def.captureInput?.(ctx as never);
      return typeof extra === "string" ? extra : null;
    },
    run: async (ctx) => {
      const extra = def.captureInput?.(ctx as never);
      if (typeof extra === "string") throw Error(extra);
      // The host captures and files the new members; the page lands on the first it wrote.
      const result = await workflow(def.capture, { pod: ctx.page.pod, ...extra }, ctx);
      const members = (result.members ?? [result.member]) as MemberRef[];
      if (members[0]) ctx.setPage({ path: members[0].path, selection: [] });
      def.onCaptured?.(result, ctx as never);
    },
  };
  const apply: RouteAction<unknown, string, EntityPage, never> = {
    label: plan ? "plan" : `apply ${def.entity}`,
    // Without a plan this verb is the apply workflow, so its facts are the contract's.
    ...(plan
      ? {
          says: `plans the saved ${def.entity} spec and opens the confirmation sheet; changes nothing`,
          needs: semanticActionFacts(def.apply).needs,
          actor: "any" as const,
        }
      : semanticActionFacts(def.apply)),
    stage: "apply",
    input: z.void() as unknown as z.ZodType<never>,
    dirties: ["pods"],
    count: (ctx) => stagedCount(ctx) || null,
    ready: (ctx) => {
      // Staged edits ARE the spec: plan files them as new members, so nothing is open yet.
      if (stagedCount(ctx))
        return ctx.page.pod ? null : "choose the pod the generated spec lands in";
      if (!ctx.page.pod || !ctx.page.path) return "open a saved spec first";
      const member = memberOf(ctx);
      if (!member) return "save the spec before applying";
      return isSpecOf(member.schema, def.schema) ? null : `the member is not a ${def.entity} spec`;
    },
    run: async (ctx) => {
      if (stagedCount(ctx)) {
        ctx.setPage({ confirming: true, sheet: await staged!.plan(ctx as never) });
        return;
      }
      const source = sourceOf(ctx);
      if (!plan) {
        // The host composes the saved bytes, refuses if they moved, and files the run receipt.
        await workflow(def.apply, { source }, ctx);
        return;
      }
      const sheet = await plan.read(ctx as never, source);
      ctx.setPage({ confirming: true, sheet });
    },
  };
  const confirm: RouteAction<unknown, string, EntityPage, never> = {
    label: `apply ${def.entity}`,
    ...semanticActionFacts(def.apply),
    stage: "apply",
    input: z.void() as unknown as z.ZodType<never>,
    dirties: ["pods"],
    count: (ctx) => sheetView(ctx)?.included.length || null,
    ready: (ctx) => {
      if (!ctx.page.confirming) return "plan first";
      const view = sheetView(ctx);
      if (!view) return "the plan no longer describes this spec; plan again";
      // Apply sends the saved sha; a pod list mid-refresh has not re-proven it yet. A staged sheet
      // carries its own generated members per row, so the page's member is not what it sends.
      if (!stagedCount(ctx) && !memberOf(ctx)) return "save the spec before applying";
      return view.included.length ? null : "no included row has changes to apply";
    },
    run: async (ctx) => {
      const view = sheetView(ctx);
      if (!view) throw Error("plan first");
      if (stagedCount(ctx)) await staged!.apply(ctx as never, view.included);
      else if (plan) await plan.confirm(ctx as never, view.included, sourceOf(ctx));
      else throw Error("plan first");
      ctx.setPage({ confirming: false, sheet: null });
    },
  };
  return defineRoute({
    key: def.key,
    name: def.name,
    docs: def.docs,
    needs: def.needs ?? "project",
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
    actions: { ...audit.actions, capture, apply, ...(plan || staged ? { confirm } : {}) } as never,
    seeds: audit.seeds as never,
  });
}
