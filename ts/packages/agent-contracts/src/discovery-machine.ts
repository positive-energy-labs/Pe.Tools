import type { HoldingsReading } from "./reading.ts";
import type { Machine, MachineSession } from "./machine.ts";
import type { DocumentHoldings } from "@pe/host-contracts/pe-revit-contract";

export type DiscoveryHoldings = Omit<DocumentHoldings, "holdings"> & {
  readonly detail:
    | { readonly state: "available"; readonly request: Omit<HoldingsReading, "kind" | "cursor"> }
    | { readonly state: "unavailable"; readonly reason: string };
  readonly holdings: Omit<DocumentHoldings["holdings"], "elements" | "worksets"> & {
    readonly elementCount: number;
    readonly worksetCount: number;
  };
};
export type DiscoveryMachine = Omit<Machine, "revit"> & {
  readonly revit: Omit<Machine["revit"], "sessions"> & {
    readonly sessions:
      | readonly (Omit<MachineSession, "holdings"> & {
          readonly holdings: readonly DiscoveryHoldings[] | null;
        })[]
      | null;
  };
};

/** Discovery names holdings without copying their potentially model-sized element arrays. */
export function discoveryMachine(machine: Machine | DiscoveryMachine): DiscoveryMachine {
  return {
    ...machine,
    revit: {
      ...machine.revit,
      sessions:
        machine.revit.sessions?.map((session) => ({
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
        })) ?? null,
    },
  };
}
