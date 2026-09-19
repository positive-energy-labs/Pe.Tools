/**
 * A route declares itself once: its Work schema, its Readings, its Page, its actions, its views.
 * Nothing here renders and nothing here holds React state — `useRoute` runs a manifest and
 * `RouteShell` draws it. The fable calls this type `Route`; every `routes/*.tsx` already exports a
 * TanStack `Route`, so the type is `RouteManifest` and the per-route export is `manifest`.
 */
import type { PodList } from "@pe/host-contracts/operation-types";
import { previousOf } from "#/readings";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { ReactNode } from "react";
import { z } from "zod";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import {
  sameValue,
  semanticActions,
  stagedEntries,
  type ActionBases,
  type Rung,
  type SemanticActionKey,
} from "@pe/agent-contracts";
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
  readonly setPage: (next: Partial<P>) => void;
}

import { DEFAULT_WAIT_S, HOST_READ_WAIT_S, NATIVE_APPLY_WAIT_S, NATIVE_READ_WAIT_S } from "./waits";
export { DEFAULT_WAIT_S, HOST_READ_WAIT_S, NATIVE_APPLY_WAIT_S, NATIVE_READ_WAIT_S };

export interface RouteAction<W, R extends string, P, I = void> {
  label: string;
  /** What the verb does in any state: the catalog's words. */
  says: string;
  /** What it does now, when that depends on the state (plan: the staged draft or the saved spec). */
  saysNow?: (ctx: Ctx<W, R, P>) => string;
  needs: "host" | "session" | "document" | "project" | "family";
  actor: "any" | "human";
  input: z.ZodType<I>;
  /** Browser Reading keys invalidated on success; semantic actions name Host and Pea resources. */
  dirties: readonly R[];
  /**
   * How long this verb may stay in flight before it ends as "stopped: no answer after Ns" and
   * releases busy (a timeout is a diagnostic boundary, never a retry). Default `DEFAULT_WAIT_S`.
   */
  waitSeconds?: number;
  /** State that must be current before this action may mutate. Previous values remain display-only. */
  requires?: { readonly work?: true; readonly readings?: readonly R[] };
  chord?: UseHotkeyDefinition["hotkey"];
  /** The stage this verb belongs to; absent = every stage. The Situation scopes its verb row by it. */
  stage?: string;
  /** Runs only from its confirmation sheet; the verb row draws no second button for it. */
  sheet?: true;
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
export type EntityAction = "capture" | "plan" | "apply";
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
  /** The plan action this row came from; apply names it, and the host consumes its sealed input. */
  plan?: string;
}

/** Apply each plan action's included rows, one host apply per plan, as `{ plan, hashes }`. */
export const byPlan = (included: readonly PlanEntry[]) => {
  const plans = new Map<string, Record<string, string>>();
  for (const row of included) {
    if (!row.plan) throw Error(`the planned row for ${row.name} names no plan`);
    (plans.get(row.plan) ?? plans.set(row.plan, {}).get(row.plan)!)[row.id] = row.planHash;
  }
  return [...plans].map(([plan, expectedPlanHashes]) => ({ plan, expectedPlanHashes }));
};

/** The plan apply confirms (dogma law 9), as the plan workflow returned it. */
export interface PlanSheet {
  entries: readonly PlanEntry[];
  /**
   * The staged value at each cell a staged plan read, as it was when planned: the plan's own
   * evidence. A cell that no longer holds it makes the sheet stale, the host's refusal rule.
   */
  staged?: Readonly<Record<string, Rung>>;
}

/** The host's words for a plan whose staged cells moved; the sheet says them before the press. */
export const STALE_PLAN = "The staged cells changed since this plan; plan again";

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
 * page holds it, and `apply` writes exactly the included rows' hashes.
 */
export interface ApplyPlan<W, R extends string, P> {
  read: (
    ctx: Ctx<W, R | EntityReading, P & EntityPage>,
    source: MemberSource,
  ) => Promise<PlanSheet>;
  /** Rows held back from apply; the route holds them where its host checks them. */
  excluded?: (view: EntityView<W, R, P>) => readonly string[];
  apply: (
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
  /** The audit Readings an apply changes in Revit (a new schedule joins the catalog): its
   * completion re-reads them, so the route never shows a pre-apply count. */
  applies?: readonly R[];
  /** Present = apply is a confirmation over this plan. */
  plan?: ApplyPlan<W, R, P>;
  /**
   * Present = the audit stages edits of its own, and plan generates the spec from them AT THAT
   * MOMENT rather than reading a member the person saved (dogma law 10 still holds: the generated
   * member is the saved content, and the run receipt names it). With staged edits the route owns
   * both halves of the confirmation; with none it falls back to `plan` over the page's member.
   */
  staged?: {
    /** The audit's keyed cells; the staged ones are what plan generates the spec from. */
    cells: (
      ctx: Ctx<W, R | EntityReading, P & EntityPage>,
    ) => Readonly<Record<string, { staged?: Rung | null }>>;
    plan: (ctx: Ctx<W, R | EntityReading, P & EntityPage>) => Promise<PlanSheet>;
    /** Resolves to the apply's own outcome when it has one (partial, refused, failed). */
    apply: (
      ctx: Ctx<W, R | EntityReading, P & EntityPage>,
      included: readonly PlanEntry[],
    ) => Promise<Refusal | null | void>;
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

export const documentOf = (ctx: { target: ExecutionTarget }) => {
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
 * The plan lane for a plan/apply workflow pair (dogma law 14): `plan` returns `{ plan }` and
 * mutates nothing, `apply` requires the hashes it returned. The result is one plan or one per
 * subject; apply sends each included row's hash as `expectedPlanHashes`.
 * `authored` is what the route's Work adds to both; with it, plan reads against that revision.
 */
export const admissionPlan = <W, R extends string, P>(
  keys: { plan: SemanticActionKey; apply: SemanticActionKey },
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
      const result = await workflow(keys.plan, { source, ...input }, ctx, bases);
      return {
        entries: [result.plan].flat().map((plan) => ({ ...row(plan), plan: String(result.id) })),
      };
    },
    // The plan sealed the source and options; apply names that plan and the hashes it confirms.
    apply: async (ctx, included) => {
      for (const input of byPlan(included)) await workflow(keys.apply, input, ctx);
    },
  };
};

/** A re-reading pod list still answers with what it last saw; only "never read" is empty. */
const podsOf = (view: Viewed) =>
  (previousOf(view.readings.pods) as readonly PodRow[] | undefined) ?? [];

/** The saved member the page names, if the pod list holds it. */
export const memberOf = (view: Viewed) =>
  podsOf(view)
    .find((row) => row.id === view.page.pod)
    ?.members.find((row) => row.path === view.page.path);

/** The sheet the route draws, and which of its rows apply would send. */
export function sheetOf<W, R extends string, P>(
  def: EntityRouteDef<W, R, P>,
  view: EntityView<W, R, P>,
): {
  sheet: PlanSheet;
  excluded: ReadonlySet<string>;
  included: readonly PlanEntry[];
  stale: boolean;
} | null {
  const sheet = view.page.sheet;
  if (!sheet) return null;
  const excluded = new Set(def.plan?.excluded?.(view) ?? []);
  const now = sheet.staged && def.staged ? def.staged.cells(view as never) : {};
  return {
    sheet,
    excluded,
    included: sheet.entries.filter((entry) => !entry.flag && !excluded.has(entry.id)),
    stale: Object.entries(sheet.staged ?? {}).some(
      ([cell, rung]) => !sameValue(now[cell]?.staged, rung),
    ),
  };
}

/**
 * The one entity route. Its three verbs are one word each — capture, plan, apply — and none is
 * scoped to a stage: a route offers them wherever it stands, and a verb moves the page to the
 * stage it produced. The audit's own Work, Readings and verbs (a grid's `push`) ride in `audit`
 * and keep their names. Without a plan lane there is no `plan` verb and `apply` applies directly.
 */
export function entityRoute<W, const R extends string, P extends object, const A extends string>(
  def: EntityRouteDef<W, R, P>,
  audit: Pick<RouteManifest<W, R, P, A>, "work" | "readings" | "page" | "actions" | "seeds"> = {},
): RouteManifest<W, R | EntityReading, P & EntityPage, A | EntityAction> {
  const plan = def.plan as ApplyPlan<unknown, string, object> | undefined;
  const staged = def.staged as EntityRouteDef<unknown, string, object>["staged"];
  /** How many edits the audit has staged; 0 = the verbs read the page's saved member instead. */
  const stagedCells = (ctx: EntityCtx) =>
    stagedEntries(staged?.cells(ctx as never) ?? {}) as [string, { staged: Rung }][];
  const stagedCount = (ctx: EntityCtx) => stagedCells(ctx).length;
  const sheetView = (ctx: EntityCtx) => sheetOf(def as never, ctx as never);
  const sourceOf = (ctx: EntityCtx): MemberSource => {
    const member = memberOf(ctx);
    if (!member) throw Error("save the spec before applying");
    return { pod: ctx.page.pod, path: ctx.page.path, sha256: member.sha256 };
  };
  /** Both apply-side verbs read the same saved member; a refusal says which half is missing. */
  const savedSpec = (ctx: EntityCtx) => {
    if (!ctx.page.pod || !ctx.page.path) return "open a saved spec first";
    const member = memberOf(ctx);
    if (!member) return "save the spec before applying";
    return isSpecOf(member.schema, def.schema) ? null : `the member is not a ${def.entity} spec`;
  };
  const capture: RouteAction<unknown, string, EntityPage, never> = {
    waitSeconds: NATIVE_READ_WAIT_S,
    label: `capture ${def.entity}`,
    says: `reads the ${def.entity} from Revit into new members of the chosen pod`,
    actor: "any",
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
      // The verb moves the page to the stage it produced; the stage never gates the verb.
      if (members[0]) ctx.setPage({ stage: "capture", path: members[0].path, selection: [] });
      def.onCaptured?.(result, ctx as never);
    },
  };
  /** A sheet planned from staged work; apply sends its plans, never the page's member. */
  const stagedSheet = (ctx: EntityCtx) => Boolean(staged && sheetView(ctx)?.sheet.staged);
  const planVerb: RouteAction<unknown, string, EntityPage, never> = {
    waitSeconds: NATIVE_READ_WAIT_S,
    label: "plan",
    says: staged
      ? `plans the staged draft, or the saved ${def.entity} spec when nothing is staged, and opens the confirmation sheet; changes nothing`
      : `plans the saved ${def.entity} spec and opens the confirmation sheet; changes nothing`,
    ...(staged
      ? {
          saysNow: (ctx) =>
            stagedCount(ctx)
              ? `plans the staged draft (${stagedCount(ctx)} cells, filed nowhere) and opens the confirmation sheet; changes nothing`
              : `plans the saved ${def.entity} spec and opens the confirmation sheet; changes nothing`,
        }
      : {}),
    needs: semanticActionFacts(def.apply).needs,
    actor: "any",
    input: z.void() as unknown as z.ZodType<never>,
    dirties: [],
    count: (ctx) => stagedCount(ctx) || null,
    ready: (ctx) => {
      // Staged work IS the spec; the pod holds the run, not a member.
      if (stagedCount(ctx)) return ctx.page.pod ? null : "choose the pod the run is filed in";
      return plan ? savedSpec(ctx) : "nothing is staged to plan";
    },
    run: async (ctx) => {
      // What the plan reads, taken before it reads it: the sheet's staged evidence.
      const read = Object.fromEntries(stagedCells(ctx).map(([cell, { staged }]) => [cell, staged]));
      const sheet = stagedCount(ctx)
        ? { ...(await staged!.plan(ctx as never)), staged: read }
        : await plan!.read(ctx as never, sourceOf(ctx));
      ctx.setPage({ stage: "apply", confirming: true, sheet });
    },
  };
  const apply: RouteAction<unknown, string, EntityPage, never> = {
    waitSeconds: NATIVE_APPLY_WAIT_S,
    label: `apply ${def.entity}`,
    ...semanticActionFacts(def.apply),
    // The plan sheet gates apply: its button is the only one (w8-revit trip 5).
    ...(plan || staged ? { sheet: true as const } : {}),
    input: z.void() as unknown as z.ZodType<never>,
    dirties: ["pods", ...(def.applies ?? [])],
    count: (ctx) => (plan || staged ? sheetView(ctx)?.included.length || null : null),
    ready: (ctx) => {
      // A staged sheet carries its own sealed plans; the page's member is not sent.
      const missing = stagedSheet(ctx) ? null : savedSpec(ctx);
      if (missing || !(plan || staged)) return missing;
      if (!ctx.page.confirming) return "plan first";
      const view = sheetView(ctx);
      if (!view) return "the plan no longer describes this spec; plan again";
      if (view.stale) return STALE_PLAN;
      return view.included.length ? null : "no included row has changes to apply";
    },
    run: async (ctx) => {
      if (!plan && !staged) {
        // The host composes the saved bytes, refuses if they moved, and files the run receipt.
        await workflow(def.apply, { source: sourceOf(ctx) }, ctx);
        return;
      }
      const view = sheetView(ctx);
      if (!view) throw Error("plan first");
      // A staged apply may report its own outcome (applied X of N, refused, failed in Revit).
      const outcome = stagedSheet(ctx)
        ? await staged!.apply(ctx as never, view.included)
        : await plan!.apply(ctx as never, view.included, sourceOf(ctx));
      ctx.setPage({ confirming: false, sheet: null });
      return outcome ?? null;
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
    actions: {
      ...audit.actions,
      capture,
      ...(plan || staged ? { plan: planVerb } : {}),
      apply,
    } as never,
    seeds: audit.seeds as never,
  });
}
