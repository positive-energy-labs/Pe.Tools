import { native } from "@pe/agent-contracts/handle";
import {
  canonicalRouteInput,
  ductsDesign,
  ductsInputsSchema,
  ductsRosterRequestSchema,
  ductsRosterResponseSchema,
  ductsSheetOverviewSchema,
  ductsSheetRequestSchema,
  ductsSheetResponseSchema,
  ductParameterSlots,
  type DuctsInputs,
  type DuctsSheetOverview,
  type DuctsSheetRequest,
  fanClaimSchema, fanCloserSchema, fanEspValuesSchema, encounterSchema, fanIssueSchema, stagedDucts,
} from "@pe/agent-contracts";
import { elementLabeler } from "@pe/ducts-domain/element-label";
import { slotCoverage } from "@pe/ducts-domain/kernel/terminal-flow";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { LOSS_RULES } from "@pe/ducts-domain/loss-rules";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { beyondOf, stoppingUnits } from "@pe/ducts-domain/sheet/beyond";
import {
  buildChain,
  buildSheet,
  resolveCriteria,
  resolveInputs,
  scopeInputs,
  stagedEsp, encounterRulings,
} from "@pe/ducts-domain/sheet/index";
import type { Chain, Sheet, SheetPath } from "@pe/ducts-domain/sheet/types";
import { worksheet } from "@pe/ducts-domain/sheet/worksheet";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { z } from "zod";
import { firmLayer, workLayer } from "@pe/host/ducts-inputs";
import { followAcceptedJoins, mergeSnapshots } from "@pe/host/ducts-walk";
import { designLayers } from "./ducts-design.ts";
import { catalogs } from "@pe/host/builtin-read-handles";
import { fingerprint, nativeRead, read } from "@pe/host/reads/evaluator";
const snapshotSchema = nativeResponseSchema("ducts.snapshot.walk");
export const espOptions = read("fans.esp-options", {
  input: z.object({ target: ductsRosterRequestSchema.shape.target, units: z.array(z.string()) }),
  output: z.object({
    espOptions: nativeResponseSchema("revit.catalog.field-options").nullable(),
    espOptionsError: z.string().nullable(),
  }),
  async run(ctx, { target, units }) {
    if (!units.length)
      return { espOptions: null, espOptionsError: "No unit identities in this fan scope" };
    try {
      const response = await ctx.read(native("revit.catalog.field-options"), {
        target: { kind: "document", ref: target },
        request: {
          key: "parameter-identities",
          context: {
            ElementUniqueIds: [...new Set(units)].sort().join(","),
            ParameterScope: "instanceThenType",
            StorageType: "Double",
          },
        },
      });
      return { espOptions: response.body, espOptionsError: null };
    } catch (error) {
      return {
        espOptions: null,
        espOptionsError: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
const details = ductsSheetResponseSchema.options;
const enginePath = z.object({
  side: z.enum(["supply", "return"]),
  legIds: z.array(z.string()),
  end: details[4].shape.ends.element,
  knownInWg: z.number(),
  blockerIds: z.array(z.string()),
});
const wireTotals = ductsSheetOverviewSchema.shape.totals.unwrap();
const engineSide = wireTotals.shape.supply.omit({ complete: true });
const engineBase = {
  engineVersion: z.string(),
  basis: z.string(),
  legs: details[3].shape.legs,
  blockers: details[4].shape.blockers,
  notes: details[4].shape.notes,
  fittings: details[4].shape.fittings,
  walkedElementIds: details[2].shape.walkedElementIds,
};
/*
 * The engine's own output, kept whole between reads: the claim, the three ESP values, encounters,
 * typed issues and the network hash ride with the numbers, and no completeness boolean exists.
 * Built from the wire parts where they agree. The wire still marks a leg's `evidence` optional and
 * the engine always states it, so the parsed type is named as the engine's (`Sheet | Chain`) once, here.
 */
const engineValue = z.union([
  z.object({
    ...engineBase,
    fan: ductsSheetOverviewSchema.shape.fan.unwrap().omit({ ratedEspInWg: true, directionOverride: true }).extend({
      directionMismatch: z.object({ discharge: z.number(), networkDischarge: z.number(), evidence: z.string() }).nullable(),
    }),
    totals: wireTotals.extend({ supply: engineSide, return: engineSide }),
    claim: fanClaimSchema,
    esp: fanEspValuesSchema,
    encounters: z.array(encounterSchema),
    issues: z.array(fanIssueSchema),
    network: z.string(),
    paths: z.array(enginePath),
    assumed: z.object({
      paths: z.array(enginePath),
      legs: engineBase.legs,
      blockers: engineBase.blockers,
    }),
  }),
  z.object({
    ...engineBase,
    start: z.object({ elementId: z.number(), connector: z.number().optional() }),
    direction: z.enum(["supply", "return"]),
    path: enginePath.nullable(),
  }),
]) as unknown as z.ZodType<Sheet | Chain>;
const modelSchema = z.object({
  target: ductsRosterRequestSchema.shape.target,
  mode: z.enum(["fan", "chain"]),
  value: engineValue,
  inputs: ductsInputsSchema,
  firm: details[4].shape.firm,
  titles: z.record(z.string(), z.string()),
  beyond: details[2].shape.beyond,
});
type SheetModel = z.infer<typeof modelSchema>;
const tableRequest = {
  ids: [
    ...new Set(
      LOSS_RULES.flatMap((rule) => [
        rule.table,
        ...rule.options,
        ...(rule.fallback ? [rule.fallback] : []),
      ]),
    ),
  ].sort(),
};
const titlesOf = (grids: ReturnType<typeof toGrids>) =>
  Object.fromEntries(
    Object.entries(grids).flatMap(([id, results]) => {
      const title = Object.values(results)[0]?.title;
      return title ? [[id, title]] : [];
    }),
  );
const subject = ({
  detail: _detail,
  basis: _basis,
  ...args
}: DuctsSheetRequest): DuctsSheetRequest => args;
const walk = read("fans.walk", {
  input: nativeRead("ducts.snapshot.walk").input,
  output: z.object({ seed: z.number(), snapshot: snapshotSchema }),
  async run(ctx, args) {
    if (!("selector" in args.request) || args.request.selector?.kind !== "from")
      throw Error("Fan walk requires a seed");
    return {
      seed: args.request.selector.unitId,
      snapshot: (await ctx.read(native("ducts.snapshot.walk"), args)).body,
    };
  },
});
const coveredSeed = (part: z.infer<typeof walk.output>) =>
  [...part.snapshot.nodes, ...part.snapshot.segments].some((element) => element.id === part.seed)
    ? [part.seed]
    : [];
const sheetModel = read("fans.calculation", {
  input: ductsSheetRequestSchema,
  output: modelSchema,
  async run(ctx, request) {
    const saved = await ctx.read(designLayers, request.target);
    const design = ductsDesign(saved.ducts, saved.fans),
      base = workLayer(design),
      staged = stagedDucts(design, design).authored.esp;
    // The engine's staged ESP names who staged it: the caller the host stamped on the Work cell, and its evidence.
    const work = { ...base, esp: Object.fromEntries(Object.entries(base.esp ?? {}).map(([key, cell]) =>
      [key, { ...cell, ...(staged[key] ? { by: staged[key].author, ref: staged[key].ref } : {}) }])) };
    const criteria = resolveCriteria(work, null, firmLayer(saved.firm, saved.settings));
    const tolerances = {
      autoJoinGapIn: criteria.autoJoinGapIn.value,
      candidateBoxIn: criteria.healBoxIn.value,
    };
    const slots = ductParameterSlots(saved.settings);
    const acquisition = {
      ...(Object.keys(slots).length ? { slots } : {}),
      selector:
        request.mode === "fan"
          ? { kind: "from" as const, unitId: request.unitId, ...tolerances }
          : {
              kind: "from" as const,
              unitId: request.start.elementId,
              portIndex: request.start.connector,
              ...tolerances,
            },
    };
    const response = await ctx.read(native("ducts.snapshot.walk"), {
      role: "acquire",
      request: acquisition,
      target: { kind: "document", ref: request.target },
    });
    const tables = await ctx.read(native("ducts.tables"), {
      role: "acquire",
      request: tableRequest,
      target: { kind: "document", ref: request.target },
    });
    if (!response.version || !tables.version)
      throw Error("Ducts read did not return an observation version");
    const catalog = await ctx.read(catalogs, request.target);
    const layersOf = (snapshot: z.infer<typeof snapshotSchema>) => ({
      snapshot,
      work,
      versions: { Work: saved.revision },
      store: snapshot.store as Parameters<typeof resolveInputs>[0]["store"],
      firm: firmLayer(saved.firm, saved.settings),
      catalogs: catalog.tables,
    });
    const first = response.body;
    const snapshot = await followAcceptedJoins(
      first,
      resolveInputs(layersOf(first)).rulings.joins,
      async (unitId) => {
        const parts = await ctx.collect([unitId], {
          read: walk,
          batch: 1,
          args: ([id]) => ({
            target: { kind: "document" as const, ref: request.target },
            role: "join" as const,
            request: {
              ...(Object.keys(slots).length ? { slots } : {}),
              selector: { kind: "from" as const, unitId: id!, ...tolerances },
            },
          }),
          key: (id) => `join:${id}`,
          covered: coveredSeed,
        });
        // A refused necessary join cannot be silently replaced with the near-side snapshot.
        if (!parts[0]) throw Error(`Accepted join at ${unitId} was refused`);
        return parts[0].snapshot;
      },
    );
    const inputs = resolveInputs(layersOf(snapshot)),
      grids = toGrids(tables.body);
    const roster = suggestRoster(snapshot, [], rosterInputs(inputs)),
      ports = [...roster.fans, ...roster.suggestions];
    const value =
      request.mode === "fan"
        ? buildSheet({
            snapshot,
            grids,
            inputs,
            roster: ports,
            fan: { unitId: request.unitId, portIndex: request.portIndex },
            stagedEsp: stagedEsp({ snapshot, work }),
            encounterRulings: encounterRulings({ work }),
            // `hosts` stays unpassed: one read prices one fan, and the engine builds a host's calc where it meets one.
          })
        : buildChain({
            snapshot,
            grids,
            inputs,
            roster: ports,
            start: request.start,
            end: request.end,
            direction: request.direction,
            ...(inputs.terminals[String(request.end.elementId)]?.cfm.value != null
              ? { flowCfm: inputs.terminals[String(request.end.elementId)]!.cfm.value! }
              : {}),
          });
    let beyond: SheetModel["beyond"] = [];
    if (request.mode === "fan") {
      const units = stoppingUnits(value as Sheet).map((unit) => unit.unitId);
      const parts = await ctx.collect(units, {
        read: walk,
        batch: 1,
        args: ([unitId]) => ({
          target: { kind: "document" as const, ref: request.target },
          role: "beyond" as const,
          request: {
            ...(Object.keys(slots).length ? { slots } : {}),
            selector: { kind: "from" as const, unitId: unitId!, maxHops: 12, ...tolerances },
          },
        }),
        key: (id) => `context:${id}`,
        covered: coveredSeed,
      });
      // The legacy elements contract cannot label an absent context stub, so refuse it rather than omit it.
      if (parts.length !== units.length) throw Error("Beyond context was refused");
      beyond = beyondOf(
        parts.reduce((merged, part) => mergeSnapshots(merged, part.snapshot), snapshot),
        value as Sheet,
        (unitId) =>
          ports.find((port) => port.unitId === unitId)?.tag || elementLabeler(snapshot)(unitId),
      );
    }
    value.basis = fingerprint([
      request.target,
      response.version,
      tables.version,
      subject(request),
      saved,
      catalog,
      value.basis,
    ]);
    return {
      target: request.target,
      mode: request.mode,
      value,
      inputs,
      firm:
        "refused" in saved.firm
          ? saved.firm
          : { version: firmLayer(saved.firm, saved.settings).version, path: saved.firm.path, present: saved.firm.present },
      titles: titlesOf(grids),
      beyond,
    };
  },
});
/** Resolved kinds and roles by unit id, so the roster reads the same rulings the engine prices under. */
const rosterInputs = (inputs: DuctsInputs) => ({
  kinds: Object.fromEntries(Object.entries(inputs.units).map(([id, u]) => [id, u.kind.value])),
  roles: Object.fromEntries(Object.entries(inputs.units).map(([id, u]) => [id, u.role.value])),
});
const pathsOf = (value: Sheet | Chain): SheetPath[] =>
  "paths" in value ? value.paths : value.path ? [value.path] : [];
/** The typed closer the engine issued for a blocker, by id: data the page acts on, never the prose. */
const typedClosers = (value: Sheet | Chain) =>
  new Map(("issues" in value ? value.issues : []).map((issue) => [issue.id, fanCloserSchema.parse(issue.closer)]));
const compact = (closers: ReturnType<typeof typedClosers>) => (value: Sheet["blockers"][number]) => ({
  id: value.id,
  ...(closers.has(value.id) ? { typedCloser: closers.get(value.id)! } : {}),
  kind: value.kind,
  elementId: value.elementId,
  ...(value.subject ? { subject: value.subject } : {}),
  ...(value.connector === undefined ? {} : { connector: value.connector }),
  effectInWg: value.effectInWg,
  closer: value.closer.kind,
  ...(value.proposal ? { proposal: value.proposal } : {}),
  ...(value.owner ? { owner: value.owner } : {}),
  ...(value.causedBy ? { causedBy: value.causedBy } : {}),
});
/** Known blockers first, then the assumed pass's own (R-B consequences cite a known id). */
/** Known first: a blocker the known pass raises is never a consequence of an assumed heal (R-B). */
const allBlockers = (value: Sheet | Chain) => {
  const known = new Map(value.blockers.map((b) => [b.id, b]));
  const assumed = "assumed" in value ? value.assumed.blockers.filter((b) => !known.has(b.id)) : [];
  const closers = typedClosers(value);
  return [...known.values(), ...assumed].map((b) => (closers.has(b.id) ? { ...b, typedCloser: closers.get(b.id)! } : b));
};

/**
 * The elements one sheet reaches: what it walked (both passes), its fan, and what its blockers
 * stand on (their own element, the candidate or proposal they name). The inputs detail is scoped to
 * these, so every element row it returns is one the page's element snapshot names (UI5).
 */
export function sheetReach(value: Sheet | Chain): Set<number> {
  return new Set([
    ...value.walkedElementIds,
    ...("fan" in value ? [value.fan.unitId] : [value.start.elementId]),
    ...allBlockers(value).flatMap((b) =>
      [b.elementId, b.closer.candidate?.toElementId, b.proposal?.to.elementId].filter(
        (id): id is number => id != null,
      ),
    ),
  ]);
}

function overview(entry: SheetModel): DuctsSheetOverview {
  const paths = pathsOf(entry.value);
  const sheet = "claim" in entry.value ? entry.value : null, claim = sheet?.claim;
  const closers = compact(typedClosers(entry.value));
  const side = (name: "supply" | "return") => {
    const ranked = paths
      .map((path, index) => ({ path, index }))
      .filter(({ path }) => path.side === name);
    return {
      paths: ranked.slice(0, 5).map(({ path, index }) => ({
        pathId: String(index),
        end: path.end,
        knownInWg: path.knownInWg,
        // The wire still asks each path for a boolean; it repeats the claim, the one authority, and decides nothing.
        complete: claim?.kind === "complete",
        legCount: path.legIds.length,
        blockerIds: path.blockerIds,
      })),
      rest: Math.max(0, ranked.length - 5),
    };
  };
  const supply = side("supply"),
    ret = side("return");
  return {
    kind: "overview",
    mode: entry.mode,
    target: entry.target,
    basis: entry.value.basis,
    // Parsed through the wire schemas: the engine's readonly shapes become the wire's, and a malformed claim never leaves.
    ...(sheet ? { claim: fanClaimSchema.parse(sheet.claim), espValues: fanEspValuesSchema.parse(sheet.esp) } : {}),
    // Rated ESP is the engine's rated value alone. The wire's one direction field carries the family-direction mismatch's evidence.
    fan: sheet ? { ...sheet.fan, ratedEspInWg: sheet.esp.rated.value, directionOverride: sheet.fan.directionMismatch?.evidence ?? null } : null,
    totals: sheet ? { ...sheet.totals, supply: { ...sheet.totals.supply, complete: claim?.kind === "complete" }, return: { ...sheet.totals.return, complete: claim?.kind === "complete" } } : null,
    paths: { supply, return: ret },
    blockers: entry.value.blockers.map(closers),
    assumedBlockers: "assumed" in entry.value ? entry.value.assumed.blockers.map(closers) : [],
    next: {
      hint: "Repeat this request with basis and detail. legs needs pathId; elements returns walkedElementIds and, as context only (never priced), a short stub from every port of each unit this fan stops at; inputs returns provenance and full blocker closers; worksheet returns every run and section with its legs. Other paths use their zero-based engine path index.",
      legs: [...supply.paths, ...ret.paths].map(({ pathId }) => ({ kind: "legs", pathId })),
      elements: { kind: "elements" },
      inputs: { kind: "inputs" },
      worksheet: { kind: "worksheet" },
    },
  };
}

async function current(ctx: import("@pe/host/read-graph").ReadContext, request: DuctsSheetRequest) {
  const entry = await ctx.read(sheetModel, subject(request));
  if (request.basis && entry.value.basis !== request.basis)
    throw Error("Stale sheet basis; read a new overview before using detail handles");
  return entry;
}
export const fanOverview = read("fans.overview", {
  input: ductsSheetRequestSchema,
  output: ductsSheetOverviewSchema,
  async run(ctx, request) {
    return overview(await current(ctx, request));
  },
});
export const fanElements = read("fans.elements", {
  input: ductsSheetRequestSchema,
  output: details[2],
  async run(ctx, request) {
    const entry = await current(ctx, request);
    return {
      kind: "elements" as const,
      target: entry.target,
      basis: entry.value.basis,
      walkedElementIds: entry.value.walkedElementIds,
      beyond: entry.beyond,
    };
  },
});
export const fanInputs = read("fans.inputs", {
  input: ductsSheetRequestSchema,
  output: details[4],
  async run(ctx, request) {
    const entry = await current(ctx, request);
    return {
      kind: "inputs" as const,
      directionOverride: "fan" in entry.value ? (entry.value.fan.directionMismatch?.evidence ?? null) : null,
      target: entry.target,
      basis: entry.value.basis,
      inputs: scopeInputs(entry.inputs, sheetReach(entry.value)),
      firm: entry.firm,
      ends: [
        ...new Map(
          [
            ...pathsOf(entry.value),
            ...("assumed" in entry.value ? entry.value.assumed.paths : []),
          ].map((path) => [canonicalRouteInput(path.end), path.end]),
        ).values(),
      ],
      fittings: entry.value.fittings,
      tableTitles: entry.titles,
      notes: entry.value.notes,
      blockers: allBlockers(entry.value),
    };
  },
});
export const fanWorksheet = read("fans.worksheet", {
  input: ductsSheetRequestSchema,
  output: details[3],
  async run(ctx, request) {
    const entry = await current(ctx, request);
    if (!("assumed" in entry.value))
      throw Error("A worksheet is a fan sheet's; a chain has one path");
    const limit = entry.inputs.criteria.velocityLimitFpm,
      limits = { supply: limit.supply.value, return: limit.return.value };
    const result = worksheet(entry.value, { maxFpm: limits });
    const named = new Set(
      [...result.supply.runs, ...result.return.runs].flatMap((run) => run.legIds),
    );
    return details[3].parse({
      kind: "worksheet",
      target: entry.target,
      basis: entry.value.basis,
      limits: {
        supplyFpm: limits.supply,
        returnFpm: limits.return,
        supplySource: `${limit.supply.source}${limit.supply.ref ? `:${limit.supply.ref}` : ""}`,
        returnSource: `${limit.return.source}${limit.return.ref ? `:${limit.return.ref}` : ""}`,
      },
      ...result,
      legs: Object.fromEntries([...named].map((id) => [id, entry.value.legs[id]])),
    });
  },
});
export const fanLegs = read("fans.legs", {
  input: ductsSheetRequestSchema,
  output: details[1],
  async run(ctx, request) {
    const entry = await current(ctx, request),
      pathId = request.detail?.kind === "legs" ? request.detail.pathId : "";
    const path = pathsOf(entry.value)[Number(pathId)];
    if (!/^(0|[1-9][0-9]*)$/.test(pathId) || !path) throw Error("Unknown sheet path handle");
    return details[1].parse({
      kind: "legs",
      target: entry.target,
      basis: entry.value.basis,
      pathId,
      legs: path.legIds.map((id) => entry.value.legs[id]),
    });
  },
});
/** The existing Pea and Ducts HTTP contract projects the same graph as Fans. */
export const ductSheet = read("ducts.sheet", {
  input: ductsSheetRequestSchema,
  output: ductsSheetResponseSchema,
  run(ctx, request): Promise<z.infer<typeof ductsSheetResponseSchema>> {
    switch (request.detail?.kind) {
      case "elements":
        return ctx.read(fanElements, request);
      case "inputs":
        return ctx.read(fanInputs, request);
      case "worksheet":
        return ctx.read(fanWorksheet, request);
      case "legs":
        return ctx.read(fanLegs, request);
      default:
        return ctx.read(fanOverview, request);
    }
  },
});
export const fanRoster = read("fans.roster", {
  input: ductsRosterRequestSchema,
  output: ductsRosterResponseSchema,
  async run(ctx, { target, mark }) {
    const saved = await ctx.read(designLayers, target),
      design = ductsDesign(saved.ducts, saved.fans);
    const slots = ductParameterSlots(saved.settings);
    const response = await ctx.read(native("ducts.snapshot.roster"), {
      role: "acquire",
      target: { kind: "document", ref: target },
      request: { ...(Object.keys(slots).length ? { slots } : {}), selector: { kind: "roster" } },
    });
    const snapshot = { ...response.body, nodes: response.body.nodes.filter(node =>
      ductsRosterResponseSchema.shape.rows.element.shape.uniqueId.safeParse(node.uniqueId).success) };
    const inputs = resolveInputs({
      snapshot,
      work: workLayer(design),
      versions: { Work: saved.revision },
      store: snapshot.store as Parameters<typeof resolveInputs>[0]["store"],
      firm: firmLayer(saved.firm, saved.settings),
    });
    const roster = suggestRoster(snapshot, [], rosterInputs(inputs)),
      label = elementLabeler(snapshot);
    const activeSlot = slots.terminalFlow ?? snapshot.slots?.terminalFlow ?? "terminalFlow";
    const wanted = mark?.trim().toLowerCase();
    return ductsRosterResponseSchema.parse({
      target,
      activeSlot,
      slots: slotCoverage(snapshot.nodes, [activeSlot, snapshot.slots?.terminalFlow]),
      rows: [...roster.fans, ...roster.suggestions].map((port) => {
        const unit = snapshot.nodes.find((node) => node.id === port.unitId);
        return {
          unitId: port.unitId,
          uniqueId: unit?.uniqueId,
          portIndex: port.portIndex,
          mark: port.tag || label(port.unitId),
          level: snapshot.levels.find((level) => level.id === unit?.levelId)?.name ?? null,
          system: unit?.systemName ?? null,
          kind: port.kind,
          side: port.side,
          ratedEspInWg: inputs.units[String(port.unitId)]?.esp.value ?? null,
          confirmed: roster.fans.includes(port),
        };
      }).filter((row) => wanted === undefined || row.mark.trim().toLowerCase() === wanted),
    });
  },
});
