/**
 * The static /ducts contract: read every duct network of one document, choose one as the subject,
 * stage the assumptions that make it solvable, then price its losses and write them to Revit.
 * Readings: `ducts` (`ducts.snapshot`) and `tables` (`ducts.tables`), both read by the route
 * (`host.ts`) and provided to the verbs. Readiness and losses are derived (`readiness.ts`,
 * `pricing.ts`), never stored. `preview` asks Revit what the staged cells would write; `apply`
 * sends the same request for real, armed only while the preview matches the Work revision and the
 * snapshot it was built on. Rulings, slots and flows write any time; the ESP number waits for a
 * clean calc (no Fix or Set row standing) and is left out of the request until then.
 *
 * Every verb that writes to Revit shows in the Situation as well as the page (kaitpw, 2026-10-21):
 * the head runs a verb bare, and the heal and fan verbs then act on the chosen system (its Heal
 * row, its offered fan), refused in words when there is nothing to act on.
 */
import { z } from "zod";
import {
  routeAddress,
  ductsRouteState,
  transitionPatches,
  type DuctAssumption,
  type DuctClaim,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import type { Cells } from "#/route/cells";
import { defineRoute, semanticActionInput, type Ctx } from "#/route/manifest";
import { refuse } from "#/route/refusal";
import { NATIVE_APPLY_WAIT_S } from "#/route/waits";
import { ductsDocs } from "#/ducts/docs";
import {
  actionResult,
  readAction,
  runSemanticAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { DuctsApply, DuctsAssignFan, DuctsHeal } from "@pe/host-contracts/generated";
import { EMPTY_CATALOGS, type Catalogs } from "@pe/ducts-domain/catalog";
import type { Grids } from "@pe/ducts-domain/loss-grid";
import { ruleByKey, ruleWords } from "@pe/ducts-domain/loss-rules";
import { applyRequest, rememberPrice } from "@pe/ducts-domain/pricing";
import type { PricingObservation } from "./pricing-job";
import { cellFocus } from "./inbox-rows";
import { pendingRulings, withStoredRulings } from "@pe/ducts-domain/rulings";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { espBefore, fanOf, healOf, healTarget, offeredFan } from "@pe/ducts-domain/action-targets";
import { healRequestGroup } from "@pe/ducts-domain/heal";
import { pendingCount, stagedCells, stagedEsp } from "@pe/ducts-domain/staged";
import { unitFlowsIn } from "@pe/ducts-domain/survey";
import { scopeOf, systemScope, groupsOfSystem } from "@pe/ducts-domain/system-scope";
import { healWords, networkWord, outcomeWords } from "@pe/ducts-domain/words";
import { claimsForGroup } from "@pe/ducts-domain/claims";
import { sceneRequest } from "#/scene/host";
import { airflowOptions } from "./airflow";
import { elementNamer } from "./claims";
import { espWaits, fanRefusal, fanWords, holding, triage } from "./inbox-rows";
import { activeSystem, capped } from "./selection";

/** What Revit said the staged cells would write, and the Work and snapshot it was asked over. */
interface DuctsEvaluation {
  revision: number;
  epoch: number;
  response: DuctsApply.Res.Response;
}

/**
 * The last `ducts.heal` run: its group, preview or apply, the snapshot epoch it ran over, Revit's
 * answer, and Pe's ESP of the group before it with the roots and elements to find the group by
 * after Revit renumbers what it rebuilt.
 */
export interface DuctsHealRun {
  group: string;
  mode: "preview" | "apply";
  epoch: number;
  response: DuctsHeal.Res.Response;
  before: { esp: number | null; roots: number[]; ids: number[] };
}

/**
 * The last `ducts.assign-fan` run: the unit and system it named, preview or apply, the snapshot
 * epoch it ran over, and Revit's answer (outcome, reason or the read back's words).
 */
export interface DuctsFanRun {
  unitId: number;
  systemId: number;
  mode: "preview" | "apply";
  epoch: number;
  response: DuctsAssignFan.Res.Response;
}

/**
 * The contract's fields (`routeAddress("ducts")`: subject, picture, viewport on the URL; `issue` and
 * `diagnostic` Pea's only) and the Page-only rest. `viewport` is a typed `Viewport`.
 */
const ductsPageSchema = routeAddress("ducts").schema.extend({
  /** Bumped by `refresh` and `apply`; the snapshot read keys on it. */
  epoch: z.number().default(0),
  /** The last preview; `apply` is armed while it matches the Work revision and epoch. Page, never URL. */
  evaluation: z.custom<DuctsEvaluation>().nullable().default(null),
  /** The last heal preview or apply; the Heal row reads it. Page, never URL. */
  heal: z.custom<DuctsHealRun>().nullable().default(null),
  /** The last make-the-fan preview or apply; its verbs read it. Page, never URL. */
  fan: z.custom<DuctsFanRun>().nullable().default(null),
});
export type DuctsPage = z.infer<typeof ductsPageSchema>;

/** The snapshot and claim cells actually displayed, not the effect-provided Reading mirror. */
export type LoadedDuctsReading = {
  snapshot: DuctSnapshot;
  /** The priced topology the tree and capture draw, including merged shared networks. */
  drawn: DuctSnapshot | null;
  claims: Readonly<Record<string, DuctClaim>>;
};

function knownSelection(page: DuctsPage, reading: LoadedDuctsReading): boolean {
  if (!page.selected) return true;
  const { snapshot, drawn, claims } = reading;
  const members =
    scopeOf(snapshot, page.system)?.members ??
    new Set([
      ...snapshot.nodes.map((node) => node.id),
      ...snapshot.segments.map((segment) => segment.id),
      ...snapshot.groups.flatMap((group) => group.rootIds),
    ]);
  // Claims and price blockers stay on the raw system. Selection also admits the neighbouring
  // elements the priced tree and capture actually draw (RA 52's merged network, for example).
  const scopedClaims = page.system.length ? claimsForGroup(claims, [...members]) : claims;
  if (Object.hasOwn(scopedClaims, page.selected)) return true;
  const id = Number(page.selected);
  return (
    Number.isSafeInteger(id) &&
    id > 0 &&
    String(id) === page.selected &&
    (members.has(id) || (drawn !== null && !!scopeOf(drawn, page.system)?.members.has(id)))
  );
}

/** The open systems the reading has no group for. */
const unknownSystems = (page: Pick<DuctsPage, "system">, snapshot: DuctSnapshot) =>
  page.system.filter((name) => groupsOfSystem(snapshot, name).length === 0);

/** Forgiving URL/initial restoration waits for evidence; the route replaces the address once. */
export function reconcileDuctsMembers(
  page: DuctsPage,
  reading: LoadedDuctsReading | null,
): Partial<DuctsPage> {
  if (!reading) return {};
  const unknown = unknownSystems(page, reading.snapshot);
  if (unknown.length)
    return {
      system: page.system.filter((name) => !unknown.includes(name)),
      selected: "",
      issue: "",
      viewport: null,
    };
  // A deep link can name a shared-network element absent from the raw system. Keep it until the
  // priced topology is ready to prove membership; clearing here loses a valid copied selection.
  if (!reading.drawn) return {};
  return knownSelection(page, reading) ? {} : { selected: "", issue: "" };
}

/** Human, action and Pea moves all validate the normalized candidate against the displayed read. */
export function bindDuctsManifest(read: () => LoadedDuctsReading | null): typeof manifest {
  return {
    ...manifest,
    transition: (current, patch, origin) => {
      const normalized = manifest.transition?.(current, patch, origin) ?? { patch };
      if ("refusal" in normalized) return normalized;
      if (origin === "url" || origin === "initial") return normalized;
      const candidate = { ...current, ...normalized.patch };
      const reading = read();
      if (!reading) {
        // Page-only refreshes can fetch evidence; no named move borrows the previous target's read.
        if (Object.hasOwn(patch, "system") || Object.hasOwn(patch, "selected"))
          return {
            refusal: refuse(
              "not-ready",
              "Load this document's ducts before naming a system or selection",
            ),
          };
        return normalized;
      }
      const unknown = unknownSystems(candidate, reading.snapshot);
      if (unknown.length)
        return {
          refusal: refuse(
            "not-ready",
            `System is not in this displayed reading: ${unknown.join(", ")}`,
          ),
        };
      // Closing a system can drop the selection out of what is open: it clears, never refuses.
      if (
        Object.hasOwn(patch, "system") &&
        !Object.hasOwn(patch, "selected") &&
        !knownSelection(candidate, reading)
      )
        return { patch: { ...normalized.patch, selected: "", issue: "" } };
      if (!knownSelection(candidate, reading))
        return {
          refusal: refuse(
            "not-ready",
            `Selection is not in this displayed system: ${candidate.selected}`,
          ),
        };
      return normalized;
    },
  };
}

export type DuctsReading = "ducts" | "tables" | "catalogs" | "pricing";
type DuctsCtx = Ctx<DuctsRouteDocument, DuctsReading, DuctsPage>;

const observed = <T>(ctx: DuctsCtx, key: DuctsReading) => {
  const reading = ctx.readings[key];
  return reading?.state === "ready" ? (reading.observation as T) : null;
};

/** No action may borrow the last visible solve or solve synchronously during readiness. */
const currentPricing = (ctx: DuctsCtx) => {
  const answer = observed<PricingObservation>(ctx, "pricing");
  const snapshot = observed<DuctSnapshot>(ctx, "ducts");
  const grids = observed<Grids>(ctx, "tables");
  const catalogs = observed<Catalogs>(ctx, "catalogs") ?? EMPTY_CATALOGS;
  const input = answer?.input;
  const documentKey =
    ctx.target.kind === "document" ? `${ctx.target.ref.session}/${ctx.target.ref.openId}` : null;
  if (
    !input ||
    input.snapshot !== snapshot ||
    input.grids !== grids ||
    input.catalogs !== catalogs ||
    input.doc !== ctx.work.doc ||
    input.revision !== ctx.work.revision ||
    input.epoch !== ctx.page.epoch ||
    input.documentKey !== documentKey
  )
    throw Error("Pricing is refreshing; wait for this Work revision before writing");
  // Shared domain action helpers can read this exact result without repeating survey or losses.
  rememberPrice(input.snapshot, input.grids, input.doc, input.catalogs, answer.result.priced);
  return answer.result.priced;
};

const pendingOf = (ctx: DuctsCtx) =>
  pendingCount(ctx.work.doc, observed<DuctSnapshot>(ctx, "ducts")?.store);

/**
 * The `revit.detail.space-scene` request for the picture: every element of every group the chosen
 * system is in, plus every element of the groups the picture draws (`drawn`: the priced survey can
 * merge a system with groups it shares, and the tree and centrelines draw those too; RA 52's raw
 * scope was 6 elements under a 193-part tree), with what is around it when the `context` layer is
 * on; null with no system. Every open system's members go in, and the `stubs` of the networks one
 * unit away. One capture per subject, never per render (the call keys on this request).
 */
export const sceneRequestOf = (
  snapshot: DuctSnapshot | null,
  page: Pick<DuctsPage, "system" | "layers">,
  drawn: readonly string[] = [],
  stubs: Iterable<number> = [],
) => {
  const scope = snapshot && scopeOf(snapshot, page.system);
  if (!snapshot || !scope) return null;
  const groups = new Set(drawn);
  const ids = [
    ...new Set([
      ...scope.members,
      ...[...snapshot.nodes, ...snapshot.segments]
        .filter((e) => e.groupId && groups.has(e.groupId))
        .map((e) => e.id),
      ...stubs,
    ]),
  ].filter((id) => id > 0);
  if (!ids.length) return null;
  return sceneRequest(
    ids.sort((a, b) => a - b),
    !page.layers.includes("context"),
  );
};

/**
 * What stands between the calc and the ESP write, in the inbox's own terms: the Fix and Set rows of
 * the chosen system (`triage`, the rows the Write group counts). Null when the snapshot or tables
 * are unread: nothing can be priced then, and the write fails on its own words.
 */
const standing = (ctx: DuctsCtx) => {
  const snapshot = observed<DuctSnapshot>(ctx, "ducts");
  const grids = observed<Grids>(ctx, "tables");
  if (!snapshot || !grids) return null;
  const priced = currentPricing(ctx);
  // The survey may merge or bridge groups: the scope is read over the snapshot that was priced.
  // The ESP write is the active system's, so only its rows hold it back.
  const active = activeSystem(ctx.page);
  const scope = scopeOf(priced.snapshot, active ? [active] : []);
  const { fix, set } = triage({
    snapshot: priced.snapshot,
    scope,
    findings: priced.findings,
    flows: priced.flows,
    equipmentFlows: unitFlowsIn(priced, scope?.groups ?? null),
    doc: withStoredRulings(ctx.work.doc, snapshot.store),
    airflow: airflowOptions(priced.snapshot, scope),
    unitAirflow: airflowOptions(priced.snapshot, scope, "unit"),
    roles: priced.roles,
  });
  return { fix: holding(fix), set: set.length };
};

/** Why the ESP waits (Fix or Set rows stand), or null when none is staged or it writes now. */
const espHeld = (ctx: DuctsCtx) =>
  stagedEsp(ctx.work.doc) ? espWaits(standing(ctx) ?? { fix: 0, set: 0 }) : null;

/** The request preview and apply send: `built`, with the ESP left out while it waits. */
const requestOf = (ctx: DuctsCtx) => {
  const request = built(ctx);
  return espHeld(ctx) ? { ...request, equipment: [] } : request;
};

/** The request from the staged cells, the snapshot and the grids the route read; throws why not. */
const built = (ctx: DuctsCtx) => {
  const snapshot = observed<DuctSnapshot>(ctx, "ducts");
  const grids = observed<Grids>(ctx, "tables");
  if (!snapshot) throw Error("The duct snapshot is not read yet");
  if (!grids) throw Error("The ASHRAE tables are not read yet");
  if (ctx.work.revision === null) throw Error("The Work is not read yet");
  if (snapshot.storeError)
    throw Error(`Pe's provenance store in this model is unreadable: ${snapshot.storeError}`);
  const priced = currentPricing(ctx);
  // Write scope is the active system: every group it is in, as the raw snapshot numbers them.
  const active = activeSystem(ctx.page);
  const groups = active ? systemScope(snapshot, active).groups : [];
  if (active && !groups.length) throw Error(`No duct network in this snapshot carries ${active}`);
  return applyRequest(snapshot, priced, new Date().toISOString(), groups);
};

const dispatch = async <T = DuctsApply.Res.Response>(
  ctx: DuctsCtx,
  key:
    | "ducts.preview-losses"
    | "ducts.apply-losses"
    | "ducts.preview-heal"
    | "ducts.apply-heal"
    | "ducts.preview-assign-fan"
    | "ducts.apply-assign-fan",
  input: Record<string, unknown>,
): Promise<T> => {
  if (ctx.target.kind !== "document") throw Error("An open document is required");
  // An apply on a large model runs about 45 s (the commits recalculate it). A
  // receipt that comes back detached or running is read again until it settles; the verb's
  // `waitSeconds` is the one bound, and past it the route ends the verb honestly.
  let row = await runSemanticAction(key, semanticActionInput(key, input), ctx.target.ref);
  while (row.state === "detached" || row.state === "running") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    row = (await readAction(row.id)) ?? row;
  }
  // The host answers `{ value, target }` (ducts-actions.ts); the value is the native op's answer.
  const answer = actionResult(row) as { value?: unknown };
  return (answer.value ?? answer) as T;
};

/** The raw duct snapshot the route read; throws when it is not read yet. */
const snapshotOf = (ctx: DuctsCtx) => {
  const snapshot = observed<DuctSnapshot>(ctx, "ducts");
  if (!snapshot) throw Error("The duct snapshot is not read yet");
  return snapshot;
};

// The group and the pair are optional: the head runs a verb bare, and it acts on the selection.
const healInput = z.object({ group: z.string().optional() }) as unknown as z.ZodType<never>;
/** The group a heal verb names; undefined when it is run bare (the head). */
const groupOf = (input: unknown) => (input as { group?: string } | undefined)?.group;

/** The group a heal verb acts on: the one it names (a Heal row), else the chosen system's. */
const healTargetOf = (ctx: DuctsCtx, input: unknown): string => {
  currentPricing(ctx);
  const named = groupOf(input);
  if (named) return named;
  const run = ctx.page.heal;
  return healTarget(
    snapshotOf(ctx),
    ctx.work.doc,
    activeSystem(ctx.page),
    ctx.page.selected,
    run?.mode === "preview" ? run.group : null,
  );
};

const fanInput = z.object({
  unitId: z.number().optional(),
  systemId: z.number().optional(),
}) as unknown as z.ZodType<never>;
/** The unit and system a fan verb names; undefined when it is run bare (the head). */
const pairOf = (input: unknown) => {
  const p = input as { unitId?: number; systemId?: number } | undefined;
  return p?.unitId != null && p.systemId != null
    ? { unitId: p.unitId, systemId: p.systemId }
    : undefined;
};

/** The fan the chosen system is offered (`offeredFan`), over what the route read. */
const offeredFanOf = (ctx: DuctsCtx) => {
  currentPricing(ctx);
  const snapshot = snapshotOf(ctx);
  return offeredFan(
    snapshot,
    ctx.work.doc,
    observed<Grids>(ctx, "tables"),
    observed<Catalogs>(ctx, "catalogs"),
    activeSystem(ctx.page),
    ctx.page.selected,
    ctx.page.fan,
    elementNamer(snapshot, null),
  );
};
/** The pair a fan verb acts on: the one it names, else the chosen system's offered fan. */
const fanTarget = (ctx: DuctsCtx, input: unknown) => {
  const named = pairOf(input);
  if (named) return named;
  const { unitId, systemId } = offeredFanOf(ctx);
  return { unitId, systemId };
};
/** The page's words for the offered fan (`fanVerbs`), so the head's button reads as the row's. */
const fanLabel = (ctx: DuctsCtx, preview: boolean) => {
  const offered = attempt(() => offeredFanOf(ctx));
  if ("no" in offered) return preview ? "preview fan" : "make the fan";
  const words = `make ${offered.ok.unit ?? offered.ok.unitId} the fan of ${offered.ok.system}`;
  return preview ? `preview: ${words}` : words;
};

/** The preview still describes this Work revision and this snapshot. */
export const previewFresh = (page: DuctsPage, revision: number | null) =>
  page.evaluation !== null &&
  page.evaluation.revision === revision &&
  page.evaluation.epoch === page.epoch;

/** Run it: its value, or the sentence it threw. */
const attempt = <T>(run: () => T): { ok: T } | { no: string } => {
  try {
    return { ok: run() };
  } catch (error) {
    return { no: error instanceof Error ? error.message : String(error) };
  }
};
const why = (run: () => unknown) => {
  const tried = attempt(run);
  return "no" in tried ? tried.no : null;
};

const requestReadiness = new WeakMap<
  ReturnType<typeof currentPricing>,
  Map<string, string | null>
>();
/** Page-only renders cannot repeatedly rebuild the global write request. */
const requestReady = (ctx: DuctsCtx) => {
  const tried = attempt(() => currentPricing(ctx));
  if ("no" in tried) return tried.no;
  let bySystem = requestReadiness.get(tried.ok);
  if (!bySystem) requestReadiness.set(tried.ok, (bySystem = new Map()));
  if (!bySystem.has(activeSystem(ctx.page)))
    bySystem.set(
      activeSystem(ctx.page),
      why(() => requestOf(ctx)),
    );
  return bySystem.get(activeSystem(ctx.page))!;
};

/**
 * Every keyed Work cell family lands a chat review on its own inbox row (`cellFocus`), and a loss
 * rule's group reads as its family, type and condition rather than its key.
 */
const ductCells = (families: Cells<DuctsRouteDocument>[]): Cells<DuctsRouteDocument>[] =>
  families.map((family) => {
    const { segment } = family;
    if (segment === null) return family;
    return {
      ...family,
      focus: (key) => ({ issue: cellFocus(segment, key) }),
      ...(segment === "rules"
        ? {
            label: (group) => {
              const rule = ruleByKey(group);
              return rule ? ruleWords(rule) : group;
            },
          }
        : {}),
    };
  });
const none = z.void() as unknown as z.ZodType<never>;

export const manifest = defineRoute<
  DuctsRouteDocument,
  DuctsReading,
  DuctsPage,
  "refresh" | "preview" | "apply" | "heal-preview" | "heal" | "fan-preview" | "fan"
>({
  key: "ducts",
  name: "Ducts",
  docs: ductsDocs,
  needs: "project",
  work: ductsRouteState,
  cells: ductCells([
    {
      segment: "calculation",
      groupOf: (key) => [key],
      nouns: ["calculation evidence"],
      noun: "calculation evidence",
      show: (value) => (value as { kind: string }).kind,
    },
    {
      segment: "assumptions",
      groupOf: (key) => [key.split(":")[0] ?? key],
      nouns: ["assumption"],
      noun: "duct assumptions",
      show: (value) => {
        const a = value as DuctAssumption | undefined;
        return !a
          ? "take back"
          : a.kind === "verdict"
            ? a.verdict
            : a.kind === "flex-roughness"
              ? `${a.ft} ft`
              : `${a.inWg} in-wg`;
      },
    },
    {
      segment: "rules",
      groupOf: (key) => [key],
      nouns: ["rule"],
      noun: "loss rules",
      show: (value) => (value as { table: string }).table,
    },
    {
      segment: "catalogs",
      groupOf: (key) => [key],
      nouns: ["catalog link"],
      noun: "grille catalog links",
      show: (value) => (value as { table: string }).table,
    },
    {
      segment: "ruleAssignments",
      groupOf: (key) => [key],
      nouns: ["fitting family"],
      noun: "fitting families priced as a rule",
      show: (value) =>
        ruleByKey((value as { rule: string }).rule)?.family ?? (value as { rule: string }).rule,
    },
    {
      segment: "terminalDrops",
      groupOf: (key) => [key],
      nouns: ["terminal"],
      noun: "terminal drops",
      show: (value) => `${(value as { inWg: number }).inWg} in-wg`,
    },
    {
      segment: "componentDrops",
      groupOf: (key) => [key],
      nouns: ["component"],
      noun: "component drops",
      show: (value) => `${(value as { inWg: number }).inWg} in-wg`,
    },
    {
      segment: "flows",
      groupOf: (key) => [key],
      nouns: ["terminal"],
      noun: "terminal flows",
      show: (value) => `${(value as { cfm: number }).cfm} cfm`,
    },
    {
      segment: "esp",
      groupOf: (key) => [key],
      nouns: ["unit"],
      noun: "unit ESPs",
      show: (value) => `${(value as { inWg: number }).inWg} in-wg`,
    },
    {
      segment: "equipmentFlows",
      groupOf: (key) => [key],
      nouns: ["unit"],
      noun: "unit flows",
      show: (value) => `${(value as { cfm: number }).cfm} cfm`,
    },
    {
      segment: "roles",
      groupOf: (key) => [key],
      nouns: ["unit"],
      noun: "unit roles",
      show: (value) => (value as { role: string }).role,
    },
    {
      segment: "parameters",
      groupOf: (key) => [key],
      nouns: ["slot"],
      noun: "parameter slots",
      show: (value) => String(value),
    },
  ]),
  // Both are host reads the route owns (`host.ts`) and provides to the verbs: the snapshot keyed on
  // target, subject, slots and epoch; the tables on the session.
  readings: { ducts: () => null, tables: () => null, catalogs: () => null, pricing: () => null },
  page: ductsPageSchema,
  transition: (current, patch) => {
    // Pea and the address are capped here too; the page's own picks already are.
    const system = Object.hasOwn(patch, "system") ? capped(patch.system ?? []) : current.system;
    // Only a move that keeps none of the open systems is a new subject: the camera, selection and
    // row reset then. Opening or closing one beside the others keeps them (a selection a close
    // drops out of view clears in `bindDuctsManifest`, which holds the reading).
    const switched =
      system.join("\n") !== current.system.join("\n") &&
      !current.system.some((name) => system.includes(name));
    const selected = Object.hasOwn(patch, "selected")
      ? (patch.selected ?? "")
      : switched
        ? ""
        : current.selected;
    return {
      patch: {
        ...(switched ? { selected: "", viewport: null } : {}),
        ...(switched || selected !== current.selected ? { issue: "" } : {}),
        ...patch,
        ...(Object.hasOwn(patch, "system") ? { system } : {}),
      },
    };
  },
  address: "ducts",
  actions: {
    refresh: {
      label: "refresh",
      says: "Reads the duct snapshot of the document again",
      needs: "project",
      actor: "any",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: [],
      rereads: "ducts",
      ready: () => null,
      run: async (ctx) => ctx.setPage({ epoch: ctx.page.epoch + 1 }),
    },
    preview: {
      label: "preview",
      does: "ducts.preview-losses",
      input: none,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      requires: { work: true },
      count: (ctx) => pendingOf(ctx) || null,
      ready: (ctx) => (pendingOf(ctx) ? requestReady(ctx) : "Nothing staged"),
      run: async (ctx) => {
        const response = await dispatch(ctx, "ducts.preview-losses", requestOf(ctx));
        ctx.setPage({
          evaluation: { revision: ctx.work.revision!, epoch: ctx.page.epoch, response },
        });
        ctx.note("preview", `Work r${ctx.work.revision}: ${outcomeWords(response)}`);
      },
    },
    apply: {
      label: "write to Revit",
      labelNow: (ctx) => {
        // Planned writes only: a refused write is not one apply makes.
        const n = ctx.page.evaluation?.response.counts.planned ?? 0;
        return previewFresh(ctx.page, ctx.work.revision) && n
          ? `write ${n} to Revit`
          : "write to Revit";
      },
      does: "ducts.apply-losses",
      input: none,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      requires: { work: true },
      // Armed while something is staged and the preview matches this Work and snapshot. Fix and Set
      // rows hold back only the ESP (`requestOf`); a write of nothing but held ESP is refused.
      ready: (ctx) => {
        const pending = pendingOf(ctx);
        if (!pending) return "Nothing staged";
        const pricing = why(() => currentPricing(ctx));
        if (pricing) return pricing;
        const held = espHeld(ctx);
        if (held && pending === stagedEsp(ctx.work.doc)) return `Only the ESP is staged: ${held}`;
        return ctx.page.evaluation === null
          ? "Preview first"
          : !previewFresh(ctx.page, ctx.work.revision)
            ? "The staged Work or the snapshot changed since the preview; preview again"
            : null;
      },
      run: async (ctx) => {
        const held = espHeld(ctx) !== null;
        // A held ESP stays staged: it was not in the request.
        const applied = stagedCells(ctx.work.doc).filter(
          (cell) =>
            cell.segment !== "catalogs" &&
            cell.segment !== "ruleAssignments" &&
            !(held && cell.segment === "esp"),
        );
        const rulings = pendingRulings(
          ctx.work.doc,
          observed<DuctSnapshot>(ctx, "ducts")?.store,
        ).map(({ segment, key }) => ({ segment, key, cell: ctx.work.doc![segment][key]! }));
        const response = await dispatch(ctx, "ducts.apply-losses", requestOf(ctx));
        ctx.note("apply", outcomeWords(response), response.counts.refused > 0);
        // The staged cells are in Revit now and the rulings in its store; the snapshot is their home.
        const patches: RouteStatePatch[] = [...applied, ...rulings].flatMap(
          ({ segment, key, cell }) => transitionPatches([segment], key, cell, { kind: "unstage" }),
        );
        const refusal = await ctx.write(patches);
        ctx.setPage({ epoch: ctx.page.epoch + 1, evaluation: null });
        return refusal;
      },
    },
    // Healing makes the model whole (pressure-drop ledger 2026-10-20): the Heal row of a group
    // previews its caps and joins in Revit, rolled back, then heals what passed in one transaction.
    // Run bare (the head), both act on the chosen system's Heal row (`healTarget`).
    "heal-preview": {
      label: "preview heal",
      does: "ducts.preview-heal",
      input: healInput,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      ready: (ctx, input) =>
        why(() => {
          currentPricing(ctx);
          return healOf(snapshotOf(ctx), ctx.work.doc, healTargetOf(ctx, input));
        }),
      run: async (ctx, input) => {
        const group = healTargetOf(ctx, input);
        const snapshot = snapshotOf(ctx);
        const found = healOf(snapshot, ctx.work.doc, group);
        currentPricing(ctx);
        const before = espBefore(
          snapshot,
          ctx.work.doc,
          observed<Grids>(ctx, "tables"),
          observed<Catalogs>(ctx, "catalogs"),
          group,
        );
        const response = await dispatch<DuctsHeal.Res.Response>(ctx, "ducts.preview-heal", {
          groups: [healRequestGroup(found)],
        });
        ctx.setPage({
          heal: {
            group,
            mode: "preview",
            epoch: ctx.page.epoch,
            response,
            before,
          },
        });
        ctx.note(
          "heal preview",
          `${networkWord(snapshot, group)}: ${healWords(response)}`,
          response.counts.refused > 0,
        );
      },
    },
    heal: {
      label: "heal",
      // The Heal row's word: how many a fresh preview of this group passed.
      labelNow: (ctx) => {
        const run = ctx.page.heal;
        const target = attempt(() => healTargetOf(ctx, undefined));
        return "ok" in target &&
          run?.mode === "preview" &&
          run.group === target.ok &&
          run.epoch === ctx.page.epoch
          ? `heal ${passedOf(run).size}`
          : "heal";
      },
      does: "ducts.apply-heal",
      input: healInput,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      // Armed only by a preview of this group over this snapshot: what heals is what the person saw pass.
      ready: (ctx, input) => {
        const target = attempt(() => healTargetOf(ctx, input));
        if ("no" in target) return target.no;
        const group = target.ok;
        const run = ctx.page.heal;
        if (run?.mode !== "preview" || run.group !== group) return "Preview the heal first";
        if (run.epoch !== ctx.page.epoch)
          return "The snapshot changed since the preview; preview again";
        return passedOf(run).size ? null : "Nothing passed the preview";
      },
      run: async (ctx, input) => {
        const run = ctx.page.heal!;
        const group = healTargetOf(ctx, input);
        const snapshot = snapshotOf(ctx);
        const found = healOf(snapshot, ctx.work.doc, group);
        const response = await dispatch<DuctsHeal.Res.Response>(ctx, "ducts.apply-heal", {
          groups: [healRequestGroup(found, passedOf(run))],
        });
        ctx.note(
          "heal",
          `${networkWord(snapshot, group)}: ${healWords(response)}`,
          response.counts.refused > 0,
        );
        // Revit renumbers what it rebuilt: read the snapshot again, and keep the before for the row.
        ctx.setPage({
          heal: { ...run, mode: "apply", response },
          epoch: ctx.page.epoch + 1,
          evaluation: null,
        });
      },
    },
    // Revit's Duct Systems > Select Equipment (pressure-drop ledger 2026-10-21): make a unit the
    // base equipment of a system, the first rung of the fan proposal. Preview runs Pe's guards, the
    // write and its read back in Revit and rolls it back; apply is armed by that preview only.
    // Run bare (the head), both act on the chosen system's offered fan (`offeredFan`).
    "fan-preview": {
      label: "preview fan",
      labelNow: (ctx) => fanLabel(ctx, true),
      does: "ducts.preview-assign-fan",
      input: fanInput,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      ready: (ctx, input) => why(() => fanOf(snapshotOf(ctx), fanTarget(ctx, input))),
      run: async (ctx, input) => {
        const pair = fanTarget(ctx, input);
        const found = fanOf(snapshotOf(ctx), pair);
        const response = await dispatch<DuctsAssignFan.Res.Response>(
          ctx,
          "ducts.preview-assign-fan",
          pair,
        );
        ctx.setPage({ fan: { ...pair, mode: "preview", epoch: ctx.page.epoch, response } });
        ctx.note(
          "fan preview",
          `${found.system}: ${fanWords(response)}`,
          response.outcome === "refused",
        );
      },
    },
    fan: {
      label: "make the fan",
      labelNow: (ctx) => fanLabel(ctx, false),
      does: "ducts.apply-assign-fan",
      input: fanInput,
      dirties: [],
      waitSeconds: NATIVE_APPLY_WAIT_S,
      // Armed only by a passing preview of this pair over this snapshot.
      ready: (ctx, input) => {
        const target = attempt(() => fanTarget(ctx, input));
        return "no" in target ? target.no : fanRefusal(ctx.page, target.ok);
      },
      run: async (ctx, input) => {
        const pair = fanTarget(ctx, input);
        const response = await dispatch<DuctsAssignFan.Res.Response>(
          ctx,
          "ducts.apply-assign-fan",
          pair,
        );
        ctx.note("fan", fanWords(response), response.outcome === "refused");
        // The base equipment is Revit's now: read the snapshot again and the role reason follows it.
        ctx.setPage({
          fan: { ...pair, mode: "apply", epoch: ctx.page.epoch, response },
          epoch: ctx.page.epoch + 1,
          evaluation: null,
        });
      },
    },
  },
});

/** The item keys a heal preview passed. */
const passedOf = (run: DuctsHealRun) =>
  new Set(
    run.response.groups.flatMap((g) =>
      g.items.filter((i) => i.outcome === "planned").map((i) => i.key),
    ),
  );
