import { native } from "@pe/agent-contracts/handle";
import * as contracts from "./contract.ts";
import { body } from "@pe/host/read-graph";
import { z } from "zod";
import { DUCTS_SYSTEM_MAX,
  ductsRosterArgs,
  ductsNetworkData,
  ductsPricingData,
  ductsFanCalcSchema,
  ductsDesign,
  stagedDucts,
  ductParameterSlots, } from "@pe/agent-contracts";
import { SYSTEMS_PER_READ, mergeSnapshots } from "@pe/ducts-domain/system-reads";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { TABLE_IDS } from "@pe/ducts-domain/table-ids";
import { designLayers } from "./ducts-design.ts";
import { firmLayer, workLayer } from "@pe/host/ducts-inputs";
import { buildSheet, encounterRulings, resolveCriteria, resolveInputs } from "@pe/ducts-domain/sheet/index";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { survey } from "@pe/ducts-domain/survey";
import { healPlan } from "@pe/ducts-domain/heal";
import { inferJoints } from "@pe/ducts-domain/proximity";
import { systemNotes } from "@pe/ducts-domain/system-list-search";
import { stagedValues, serveSetting } from "@pe/agent-contracts";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { catalogs } from "@pe/host/builtin-read-handles";
import { read } from "@pe/host/read-graph";
import { systemList } from "@pe/ducts-domain/system-list";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { fanRoster, espOptions } from "./fan-sheet.ts";

export const ductsRoster = body(contracts.roster, async function(ctx, { target }) {
    const saved = await ctx.read(designLayers, target),
      design = ductsDesign(saved.ducts, saved.fans);
    const staged = stagedDucts(design, design);
    const response = await ctx.read(native("ducts.snapshot.roster"), {
      role: "acquire",
      target: { kind: "document", ref: target },
      request: {
        slots: ductParameterSlots(saved.settings),
        labelParameter: staged.labelParameter ?? undefined,
        selector: { kind: "roster" },
      },
    });
    if (!response.version) throw Error("Duct roster has no observation version");
    const snapshot = response.body;
    return { ...snapshot, rows: systemList(snapshot, null), sourceVersion: response.version };
  });
const systems = read("ducts.systems", {
  input: ductsRosterArgs.extend({ systemIds: z.array(z.number()).max(SYSTEMS_PER_READ) }),
  output: ductsNetworkData,
  async run(ctx, { target, systemIds }) {
    const saved = await ctx.read(designLayers, target),
      design = ductsDesign(saved.ducts, saved.fans);
    const staged = stagedDucts(design, design);
    const response = await ctx.read(native("ducts.snapshot.walk"), {
      role: "acquire",
      target: { kind: "document", ref: target },
      request: {
        slots: ductParameterSlots(saved.settings),
        labelParameter: staged.labelParameter ?? undefined,
        selector: { kind: "systems", systemIds },
      },
    });
    if (!response.version) throw Error("Duct network has no observation version");
    const snapshot = response.body;
    return {
      ...snapshot,
      sourceVersion: response.version,
      systemReads: {
        completed: systemIds,
        missing: systemIds.filter((id) => !snapshot.systems.some((system) => system.id === id)),
      },
    };
  },
});
export const ductsNetwork = body(contracts.network, async function(ctx, args) {
    const roster = await ctx.read(ductsRoster, { target: args.target });
    const names =
      args.system === "all"
        ? roster.systems.map((system) => system.name)
        : [...new Set(args.system)];
    if (names.length > DUCTS_SYSTEM_MAX)
      throw Error(`Read at most ${DUCTS_SYSTEM_MAX} systems at once`);
    const unknown = names.filter((name) => !roster.systems.some((system) => system.name === name));
    if (unknown.length) throw Error(`System is not in this document: ${unknown.join(", ")}`);
    const wanted = [
      ...new Set(
        roster.systems.filter((system) => names.includes(system.name)).map((system) => system.id),
      ),
    ];
    const parts = await ctx.collect(wanted, {
      read: systems,
      batch: SYSTEMS_PER_READ,
      args: (ids) => ({ target: args.target, systemIds: [...ids] }),
      covered: (value) => value.systemReads.completed,
    });
    return {
      ...(mergeSnapshots(parts) ?? roster),
      sourceVersion: parts.length
        ? parts.map((part) => part.sourceVersion).join("+")
        : roster.sourceVersion,
      systemReads: {
        completed: parts.flatMap((part) => part.systemReads.completed),
        missing: parts.flatMap((part) => part.systemReads.missing),
      },
    };
  });
// Built once: z.json() constructs a lazy union per call, and wire visits every leaf of the pricing result.
const jsonLeaf = z.json();
/** The wire carries every Map entry and Set member, never JSON.stringify's empty object. */
function wire(value: unknown): z.infer<ReturnType<typeof z.json>> {
  if (value instanceof Map)
    return Object.fromEntries([...value].map(([key, item]) => [String(key), wire(item)]));
  if (value instanceof Set) return [...value].map(wire);
  if (Array.isArray(value)) return value.map(wire);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, wire(item)]),
    );
  return jsonLeaf.parse(value);
}
export const ductsPricing = body(contracts.pricing, async function(ctx, args) {
    const network = await ctx.read(ductsNetwork, args);
    const layers = await ctx.read(designLayers, args.target),
      catalog = await ctx.read(catalogs, args.target);
    const tables = await ctx.read(native("ducts.tables"), {
      role: "acquire",
      target: { kind: "document", ref: args.target },
      request: { ids: [...TABLE_IDS] },
    });
    // Pricing requires the entire requested network; a refused batch remains visible on network Values.
    const roster = await ctx.read(ductsRoster, { target: args.target });
    const wanted = roster.systems.filter(
      (system) => args.system === "all" || args.system.includes(system.name),
    );
    if (
      wanted.some((system) => !network.systemReads.completed.includes(system.id)) ||
      network.systemReads.missing.length
    )
      throw Error("Pricing requires every requested system batch; read the network coverage");
    const fans = await ctx.read(fanRoster, { target: args.target });
    const options = await ctx.read(espOptions, {
      target: args.target,
      units: fans.rows.flatMap((row) => (row.uniqueId ? [row.uniqueId] : [])),
    });
    return ctx.compute(
      ductsPricingData,
      { roster, fans, network, layers, catalog, tables },
      ({ roster, fans, network, layers, catalog, tables }) => {
        const { sourceVersion: _version, systemReads: _coverage, ...snapshot } = network;
        const design = ductsDesign(layers.ducts, layers.fans);
        const stored = withStoredRulings(design, snapshot.store, snapshot) ?? design;
        // The fan calcs are the only pricing: one per roster port, each on this read's network and
        // inputs, the way the fans read builds one (`fan-sheet.ts`). No group result stands beside them.
        const work = workLayer(design);
        const inputs = resolveInputs({
          snapshot,
          work,
          versions: { Work: layers.revision },
          store: snapshot.store as Parameters<typeof resolveInputs>[0]["store"],
          firm: firmLayer(layers.firm, layers.settings),
          catalogs: catalog.tables,
        });
        // The ruled kinds and roles alone, as the fans roster reads them (`fan-sheet.ts` `rosterInputs`).
        const units = Object.entries(inputs.units);
        const suggested = suggestRoster(snapshot, [], {
          kinds: Object.fromEntries(units.flatMap(([id, u]) => (u.kind.status === "valid" ? [[id, u.kind.value]] : []))),
          roles: Object.fromEntries(units.flatMap(([id, u]) => (u.role.status === "valid" ? [[id, u.role.value]] : []))),
        });
        const ports = [...suggested.fans, ...suggested.suggestions];
        const grids = toGrids(tables.body);
        const calcs = z.array(ductsFanCalcSchema).parse(
          ports.map((fan) =>
            buildSheet({
              snapshot,
              grids,
              inputs,
              roster: ports,
              fan: { unitId: fan.unitId, portIndex: fan.portIndex },
              encounterRulings: encounterRulings({ work }),
            }),
          ),
        );
        const surveyed = survey(snapshot, design);
        const heal = healPlan(snapshot, design);
        const result = ductsPricingData.pick({ survey: true, analysis: true }).parse(
          wire({
            survey: {
              snapshot: surveyed.snapshot,
              flows: surveyed.flows,
              equipmentFlows: surveyed.equipmentFlows,
              roles: surveyed.roles,
              findings: surveyed.findings,
              edit: {
                ...stagedValues(stored, stored),
                designFriction: serveSetting(layers.settings, ["project", "firm"], ["designFriction"], z.number().positive(), DEFAULT_DESIGN_FRICTION_RATE).value!,
                parameters: ductParameterSlots(layers.settings),
              },
            },
            analysis: {
              heal,
              notes: systemNotes(surveyed, design, heal),
              systems: systemList(surveyed.snapshot, calcs),
              inference: inferJoints(snapshot, 1, stored),
            },
          }),
        );
        const priced = new Map(result.analysis.systems.map((row) => [row.key, row]));
        return {
          ...options,
          ...result,
          calcs,
          analysis: {
            ...result.analysis,
            systems: roster.rows.map((row) => priced.get(row.key) ?? row),
          },
          effectiveDesign: stored,
          fanRows: fans.rows,
          design,
          network,
          ductsWork: layers.ducts,
          fansWork: layers.fans,
          catalogFindings: catalog.findings,
          // Under Work: the store over the firm file, so a staged criterion draws beside what it replaces.
          criteria: resolveCriteria(null, snapshot.store as Parameters<typeof resolveCriteria>[1], firmLayer(layers.firm, layers.settings)),
          firm: "refused" in layers.firm ? layers.firm
            : { version: firmLayer(layers.firm, layers.settings).version, path: layers.firm.path, present: layers.firm.present },
          settings: { ducts: layers.settings } as Readonly<Record<string, typeof layers.settings>>,
        };
      },
    );
  });

export const reads = { roster: ductsRoster, network: ductsNetwork, pricing: ductsPricing };
