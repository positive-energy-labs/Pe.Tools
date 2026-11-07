import { z } from "zod";
import {
  DUCTS_SYSTEM_MAX,
  ductsRosterArgs,
  ductsRosterData,
  ductsNetworkArgs,
  ductsNetworkData,
  ductsPricingData,
  ductsDesign,
  stagedDucts,
} from "@pe/agent-contracts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { SYSTEMS_PER_READ, mergeSnapshots } from "@pe/ducts-domain/system-reads";
import { toGrids } from "@pe/ducts-domain/loss-grid";
import { TABLE_IDS } from "@pe/ducts-domain/pricing";
import { pricingResult } from "@pe/ducts-domain/pricing-result";
import { native, designLayers, catalogs } from "./ducts-inputs.ts";
import { read } from "./evaluator.ts";

export const ductsRoster = read("ducts.roster", {
  input: ductsRosterArgs,
  output: ductsRosterData,
  async run(ctx, { target }) {
    const saved = await ctx.read(designLayers, target),
      design = ductsDesign(saved.ducts, saved.fans);
    const staged = stagedDucts(design, design);
    const response = await ctx.read(native, {
      key: "ducts.snapshot.roster",
      target,
      request: {
        slots: staged.parameters,
        labelParameter: staged.labelParameter ?? undefined,
        selector: { kind: "roster" },
      },
    });
    if (!response.version) throw Error("Duct roster has no observation version");
    return {
      ...nativeResponseSchema("ducts.snapshot.roster").parse(response.body),
      sourceVersion: response.version,
    };
  },
});
const systems = read("ducts.systems", {
  input: ductsRosterArgs.extend({ systemIds: z.array(z.number()).max(SYSTEMS_PER_READ) }),
  output: ductsNetworkData,
  async run(ctx, { target, systemIds }) {
    const saved = await ctx.read(designLayers, target),
      design = ductsDesign(saved.ducts, saved.fans);
    const staged = stagedDucts(design, design);
    const response = await ctx.read(native, {
      key: "ducts.snapshot.walk",
      target,
      request: {
        slots: staged.parameters,
        labelParameter: staged.labelParameter ?? undefined,
        selector: { kind: "systems", systemIds },
      },
    });
    if (!response.version) throw Error("Duct network has no observation version");
    const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(response.body);
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
export const ductsNetwork = read("ducts.network", {
  input: ductsNetworkArgs,
  output: ductsNetworkData,
  async run(ctx, args) {
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
  },
});
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
  return z.json().parse(value);
}
export const ductsPricing = read("ducts.pricing", {
  input: ductsNetworkArgs,
  output: ductsPricingData,
  async run(ctx, args) {
    const network = await ctx.read(ductsNetwork, args);
    const layers = await ctx.read(designLayers, args.target),
      catalog = await ctx.read(catalogs, null);
    const tables = await ctx.read(native, {
      key: "ducts.tables",
      target: args.target,
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
    return ctx.compute(
      ductsPricingData,
      { network, layers, catalog, tables },
      ({ network, layers, catalog, tables }) => {
        const { sourceVersion: _version, systemReads: _coverage, ...snapshot } = network;
        return {
          ...ductsPricingData
            .omit({ network: true, ductsWork: true, fansWork: true, catalogFindings: true })
            .parse(
              wire(
                pricingResult(
                  snapshot,
                  toGrids(tables.body),
                  catalog.tables,
                  ductsDesign(layers.ducts, layers.fans),
                ),
              ),
            ),
          network,
          ductsWork: layers.ducts,
          fansWork: layers.fans,
          catalogFindings: catalog.findings,
        };
      },
    );
  },
});
