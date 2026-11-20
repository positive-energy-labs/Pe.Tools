import { native } from "@pe/agent-contracts/handle";
import * as contracts from "@pe/duct-systems-contract/contract";
import { body } from "@pe/host-internal/read-graph";
import { z } from "zod";
import {
  DUCTS_DETAIL_LIMIT,
  ductDetailLimitMessage,
  ductsRosterArgs,
  ductsNetworkData,
  ductsPricingData,
} from "@pe/duct-systems-contract/ducts-read";
import { ductsDesign, stagedDucts } from "@pe/duct-systems-contract/ducts";
import { SYSTEMS_PER_READ, mergeSnapshots } from "@pe/ducts-domain/system-reads";
import { TABLE_IDS } from "@pe/ducts-domain/table-ids";
import { designLayers } from "@pe/ducts-host/design-layers";
import { firmLayer, workLayer } from "@pe/ducts-host/ducts-inputs";
import { ductsInputs } from "@pe/ducts-host/ducts-input-acquisition";
import { resolveCriteria } from "@pe/ducts-domain/calc/inputs";
import { pricingValue, pricingWire } from "@pe/duct-systems-domain/pricing-value";
import { catalogs } from "@pe/ducts-host/duct-catalogs";
import { read } from "@pe/host-internal/read-graph";
import { systemList } from "@pe/duct-systems-domain/system-list";
import { fanRoster, networkCalcs } from "@pe/fans-contract/fans-host-reads";
import { fanSystems } from "@pe/ducts-contract/fan-scope.neutral";

export const ductsRoster = body(contracts.roster, async function (ctx, { target }) {
  const input = await ctx.read(ductsInputs, target);
  if (!input.version) throw Error("Duct roster has no observation version");
  return {
    ...input.snapshot,
    rows: systemList(input.snapshot, null),
    sourceVersion: input.version,
    slotSources: input.flow.slotSources,
  };
});
export const ductsOverview = body(contracts.overview, async (ctx, args) => {
  const { rows, sourceVersion } = await ctx.read(ductsRoster, args);
  return { rows, sourceVersion };
});
const systems = read("ducts.systems", {
  input: ductsRosterArgs.extend({ systemIds: z.array(z.number()).max(SYSTEMS_PER_READ) }),
  output: ductsNetworkData,
  async run(ctx, { target, systemIds }) {
    const saved = await ctx.read(designLayers, target),
      design = ductsDesign(saved.ducts, saved.fans);
    const staged = stagedDucts(design, design);
    const { flow } = await ctx.read(ductsInputs, target);
    const response = await ctx.read(native("ducts.snapshot.walk"), {
      role: "acquire",
      target: { kind: "document", ref: target },
      request: {
        slots: flow.slots,
        labelParameter: staged.labelParameter ?? undefined,
        selector: { kind: "systems", systemIds },
      },
    });
    if (!response.version) throw Error("Duct network has no observation version");
    const snapshot = response.body;
    return {
      ...snapshot,
      sourceVersion: response.version,
      slotSources: flow.slotSources,
      systemReads: {
        completed: systemIds,
        missing: systemIds.filter((id) => !snapshot.systems.some((system) => system.id === id)),
      },
    };
  },
});
export const ductsNetwork = body(contracts.network, async function (ctx, args) {
  const roster = await ctx.read(ductsRoster, { target: args.target });
  // Roster base equipment misses unassigned fans. Walk the named port before resolving system names.
  const walk = args.fan
    ? await ctx.read(native("ducts.snapshot.walk"), {
        role: "acquire",
        target: { kind: "document", ref: args.target },
        request: {
          slots: roster.slots,
          selector: { kind: "from", unitId: args.fan.unitId, portIndex: args.fan.portIndex },
        },
      })
    : null;
  const names = walk ? fanSystems(walk.body, roster.systems) : [...new Set(args.system)];
  const unknown = names.filter((name) => !roster.systems.some((system) => system.name === name));
  if (unknown.length) throw Error(`System is not in this document: ${unknown.join(", ")}`);
  const wanted = [
    ...new Set(
      roster.systems.filter((system) => names.includes(system.name)).map((system) => system.id),
    ),
  ];
  if (wanted.length > DUCTS_DETAIL_LIMIT) throw Error(ductDetailLimitMessage);
  const parts = await ctx.collect(wanted, {
    read: systems,
    batch: SYSTEMS_PER_READ,
    args: (ids) => ({ target: args.target, systemIds: [...ids] }),
    covered: (value) => value.systemReads.completed,
  });
  return {
    ...(mergeSnapshots(parts) ?? roster),
    slotSources: parts.at(-1)?.slotSources ?? roster.slotSources,
    sourceVersion: parts.length
      ? parts.map((part) => part.sourceVersion).join("+")
      : roster.sourceVersion,
    systemReads: {
      completed: parts.flatMap((part) => part.systemReads.completed),
      missing: parts.flatMap((part) => part.systemReads.missing),
    },
  };
});
export const ductsPricing = body(contracts.pricing, async function (ctx, args) {
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
  const wanted = roster.systems.filter((system) =>
    args.fan
      ? network.systemReads.completed.includes(system.id)
      : args.system.includes(system.name),
  );
  if (
    wanted.some((system) => !network.systemReads.completed.includes(system.id)) ||
    network.systemReads.missing.length
  )
    throw Error("Pricing requires every requested system batch; read the network coverage");
  const fans = await ctx.read(fanRoster, { target: args.target });
  const {
    sourceVersion: _version,
    systemReads: _coverage,
    slotSources: _sources,
    ...acquired
  } = network;
  const calcs = await ctx.read(networkCalcs, {
    snapshot: acquired,
    tables: tables.body,
    catalogs: catalog.tables,
    design: ductsDesign(layers.ducts, layers.fans),
    firm: firmLayer(layers.firm, layers.settings),
    revision: layers.revision,
  });
  return ctx.compute(
    ductsPricingData,
    { roster, fans, network, snapshot: acquired, layers, catalog, calcs },
    ({ roster, fans, network, snapshot, layers, catalog, calcs }) => {
      const design = ductsDesign(layers.ducts, layers.fans);
      const result = pricingWire(pricingValue(snapshot, calcs, design, layers.settings));
      const priced = new Map(result.analysis.systems.map((row) => [row.key, row]));
      return {
        ...result,
        analysis: {
          ...result.analysis,
          systems: roster.rows.map((row) => priced.get(row.key) ?? row),
        },
        fanRows: fans.rows,
        design,
        network,
        ductSystemsWork: layers.ducts,
        fansWork: layers.fans,
        catalogFindings: catalog.findings,
        // The criteria as pricing resolved them (MAP invariant 5): the Work layer and revision `networkCalcs` prices on, over the home that serves each. The model store states none (ADR 0053).
        criteria: resolveCriteria(
          workLayer(design),
          firmLayer(layers.firm, layers.settings),
          null,
          { Work: layers.revision },
        ),
        firm:
          "refused" in layers.firm
            ? layers.firm
            : {
                version: firmLayer(layers.firm, layers.settings).version,
                path: layers.firm.path,
                present: layers.firm.present,
              },
        settings: { ducts: layers.settings } as Readonly<Record<string, typeof layers.settings>>,
      };
    },
  );
});

export const reads = {
  overview: ductsOverview,
  roster: ductsRoster,
  network: ductsNetwork,
  pricing: ductsPricing,
};
