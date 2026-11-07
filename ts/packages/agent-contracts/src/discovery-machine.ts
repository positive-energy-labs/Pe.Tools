import { z } from "zod";
import { sdkSchema } from "@pe/host-contracts/decoders";
import { holdingsReadingSchema } from "./holdings-reading.ts";
import { machineSchema, machineSessionSchema, type Machine } from "./machine.ts";

export const discoveryHoldingsSchema = z.lazy(() =>
  sdkSchema("DocumentHoldings")
    .extend({
      detail: z.discriminatedUnion("state", [
        z
          .object({
            state: z.literal("available"),
            request: holdingsReadingSchema.omit({ kind: true, cursor: true }),
          })
          .readonly(),
        z.object({ state: z.literal("unavailable"), reason: z.string() }).readonly(),
      ]),
      holdings: sdkSchema("Holdings")
        .omit({ elements: true, worksets: true })
        .extend({
          elementCount: z.number().int().nonnegative(),
          worksetCount: z.number().int().nonnegative(),
        })
        .readonly(),
    })
    .readonly(),
);
export const discoveryMachineSchema = z.lazy(() =>
  machineSchema
    .unwrap()
    .extend({
      revit: machineSchema
        .unwrap()
        .shape.revit.unwrap()
        .extend({
          sessions: z
            .array(
              machineSessionSchema
                .unwrap()
                .extend({
                  holdings: z.array(discoveryHoldingsSchema).readonly().nullable(),
                })
                .readonly(),
            )
            .readonly()
            .nullable(),
        })
        .readonly(),
    })
    .readonly(),
);
export type DiscoveryHoldings = z.infer<typeof discoveryHoldingsSchema>;
export type DiscoveryMachine = z.infer<typeof discoveryMachineSchema>;

/** Discovery names holdings without copying their potentially model-sized element arrays. */
export function discoveryMachine(machine: Machine | DiscoveryMachine): DiscoveryMachine {
  return {
    ...machine,
    revit: {
      ...machine.revit,
      sessions: machine.revit.sessions?.map((session) => boundedSession(session, 65536)) ?? null,
    },
  };
}

function boundedSession(
  session:
    | NonNullable<Machine["revit"]["sessions"]>[number]
    | NonNullable<DiscoveryMachine["revit"]["sessions"]>[number],
  budget: number,
): NonNullable<DiscoveryMachine["revit"]["sessions"]>[number] {
  try {
    const summary = {
      ...session,
      holdings:
        session.holdings?.map((document): DiscoveryHoldings => {
          if ("detail" in document) return document;
          const holdings = document.holdings;
          const { elements, worksets, ...facts } = holdings;
          return {
            openId: document.openId,
            title: document.title,
            detail:
              "process" in session.row &&
              session.row.process &&
              session.row.execution?.allowed === true &&
              !session.holdingsLeg.error &&
              !!session.holdingsLeg.observedAtUtc
                ? {
                    state: "available",
                    request: {
                      read: "holdings",
                      section: "elements",
                      session: { pid: session.row.process.pid },
                      processStartUtc: session.row.process.processStartUtc,
                      openId: document.openId,
                      limit: 50,
                    },
                  }
                : {
                    state: "unavailable",
                    reason:
                      session.holdingsLeg.error ??
                      session.row.execution?.detail ??
                      "Holdings detail has not been observed in an eligible process",
                  },
            holdings: {
              ...facts,
              elementCount: elements.length,
              worksetCount: worksets.length,
            },
          };
        }) ?? null,
    };
    if (new TextEncoder().encode(JSON.stringify(summary)).byteLength <= budget) return summary;
  } catch (error) {
    console.warn(
      "ts/packages/agent-contracts/src/discovery-machine.ts: fallback after failure",
      error,
    );
    // A bad SDK entry must not take every other session out of discovery.
  }
  const label =
    "id" in session.row
      ? session.row.id
      : "process" in session.row && session.row.process
        ? `pid ${session.row.process.pid}`
        : session.row.case;
  const error = `session ${label}: holdings too large or cannot be serialized. Choose another session, or read holdings for one document with a smaller page limit.`;
  return {
    ...session,
    holdings: null,
    holdingsLeg: { ...session.holdingsLeg, error },
  };
}
