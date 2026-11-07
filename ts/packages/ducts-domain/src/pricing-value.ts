import { z } from "zod";
import {
  ductsPricingData,
  ductsRosterData,
  ductsPricingCapability,
  ductsRosterCapability,
} from "@pe/agent-contracts";
import type { pricingResult } from "./pricing-result";
import type { systemList } from "./system-list";

type Pricing = ReturnType<typeof pricingResult>;
type PricingValue = Omit<z.output<typeof ductsPricingData>, keyof Pricing> & Pricing;
type RosterValue = Omit<z.output<typeof ductsRosterData>, "rows"> & {
  rows: ReturnType<typeof systemList>;
};

const numeric = <T>(record: Record<string, T>) =>
  new Map(Object.entries(record).map(([key, value]) => [Number(key), value]));
const decoded = z.custom<PricingValue>((value) => {
  const data = value as PricingValue | null;
  return (
    data?.priced?.flows instanceof Map &&
    data.priced.equipmentFlows instanceof Map &&
    data.priced.roles instanceof Map &&
    data.priced.fanFlows instanceof Map &&
    data.analysis?.notes instanceof Map &&
    data.analysis.heal.covered instanceof Set &&
    data.analysis.heal.hard instanceof Map &&
    ductsPricingData.safeParse(wire(data)).success
  );
});

/** Maps/Sets are a Value boundary concern, shared by every drawing and replay decoder. */
export const ductsPricingValue = z.codec(z.union([ductsPricingData, decoded]), decoded, {
  decode(data) {
    if (data.priced.flows instanceof Map) return data as PricingValue;
    const { priced, analysis } = data as z.output<typeof ductsPricingData>;
    return {
      ...data,
      priced: {
        ...priced,
        flows: numeric(priced.flows),
        equipmentFlows: numeric(priced.equipmentFlows),
        roles: numeric(priced.roles),
        fanFlows: new Map(
          Object.entries(priced.fanFlows).map(([key, flows]) => [key, numeric(flows)]),
        ),
      },
      analysis: {
        ...analysis,
        notes: new Map(Object.entries(analysis.notes)),
        heal: {
          ...analysis.heal,
          covered: new Set(analysis.heal.covered),
          hard: new Map(Object.entries(analysis.heal.hard)),
        },
      },
      // TODO: replace opaque circuit/row extension JSON with the domain schemas in the public contract.
    } as unknown as PricingValue;
  },
  encode: (data) => ductsPricingData.parse(wire(data)),
});

function wire(value: unknown): unknown {
  if (value instanceof Map)
    return Object.fromEntries([...value].map(([key, item]) => [String(key), wire(item)]));
  if (value instanceof Set) return [...value].map(wire);
  if (Array.isArray(value)) return value.map(wire);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, wire(item)]),
    );
  return value;
}

// The host retains extension fields as JSON; their complete domain type belongs at this boundary.
export const ductsRosterValue = ductsRosterData.transform((data) => data as unknown as RosterValue);
const pricingOutput = ductsPricingCapability.output.extend({
  value: ductsPricingCapability.output.shape.value
    .unwrap()
    .extend({ data: ductsPricingValue })
    .nullable(),
});
export const ductsPricingValueCapability = { ...ductsPricingCapability, output: pricingOutput };
export const ductsRosterValueCapability = {
  ...ductsRosterCapability,
  output: ductsRosterCapability.output.extend({
    value: ductsRosterCapability.output.shape.value
      .unwrap()
      .extend({ data: ductsRosterValue })
      .nullable(),
  }),
};
