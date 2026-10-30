import type { DuctsSheetResponse, DuctsRosterResponse } from "@pe/agent-contracts";

export type FanPort = DuctsRosterResponse["rows"][number];

export type Detail<K extends DuctsSheetResponse["kind"]> = Extract<DuctsSheetResponse, { kind: K }>;

export const fanKey = (fan: Pick<FanPort, "unitId" | "portIndex">) =>
  `${fan.unitId}:${fan.portIndex}`;

export const pressure = (value: number | null | undefined) =>
  value == null ? "—" : value.toFixed(4);

export const rosterOrder = (rows: readonly FanPort[]) =>
  [...rows].sort((a, b) => {
    const rank = (row: FanPort) =>
      (row.blockerCount ?? 0) > 0 ? 0 : row.complete !== undefined ? 1 : 2;

    return (
      rank(a) - rank(b) ||
      (b.blockerCount ?? 0) - (a.blockerCount ?? 0) ||
      a.mark.localeCompare(b.mark) ||
      a.unitId - b.unitId ||
      a.portIndex - b.portIndex
    );
  });
