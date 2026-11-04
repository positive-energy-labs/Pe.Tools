import type {
  DuctsInputs,
  DuctsRosterResponse,
  DuctsSheetResponse,
  FittingPricing,
} from "@pe/agent-contracts";
import type { Immutable } from "../../../../../packages/agent-contracts/src/route-kernel-data.ts";

export type FanPort = DuctsRosterResponse["rows"][number];

export type Detail<K extends DuctsSheetResponse["kind"]> = Immutable<
  Extract<DuctsSheetResponse, { kind: K }>
>;

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

/**
 * The roster's status columns from the same sheet computation the ledger draws: the geometry-free
 * roster reading never computes, so a fan the sheet has priced takes its totals from that reading.
 */
export const withComputed = (roster: readonly FanPort[], computed: readonly FanPort[]) => {
  const priced = new Map(
    computed.filter((row) => row.complete !== undefined).map((row) => [fanKey(row), row]),
  );
  return roster.map((row) => {
    const sheet = priced.get(fanKey(row));
    return sheet
      ? {
          ...row,
          blockerCount: sheet.blockerCount,
          requiredEspInWg: sheet.requiredEspInWg,
          requiredEspAssumedInWg: sheet.requiredEspAssumedInWg,
          complete: sheet.complete,
        }
      : row;
  });
};

/** Mark is a display label; only the document's UniqueId and connector identify a fan port. */
export const stableFanKey = (fan: Pick<FanPort, "uniqueId" | "portIndex">) =>
  `${fan.uniqueId}@${fan.portIndex}`;

export function selectedFans<T extends Pick<FanPort, "uniqueId" | "portIndex">>(
  keys: string[] | "all",
  rows: readonly T[],
): T[] {
  if (keys === "all") return [...rows];
  return [...new Set(keys)].map((key) => {
    const row = rows.find((row) => stableFanKey(row) === key);
    if (row) return row;
    throw Error(
      `Fan link '${key}' is unavailable or uses a legacy mark/ElementId. Choose the fan from the roster to create a stable link.`,
    );
  });
}

type Labelled = Pick<FanPort, "mark" | "uniqueId" | "portIndex"> &
  Partial<Pick<FanPort, "level" | "system">>;
/** A duplicate mark is told apart by where it is (level, then system), else by its order; never by its key. */
export const fanLabel = (fan: Labelled, rows: readonly Labelled[]) => {
  const twins = rows.filter((row) => row.mark === fan.mark && row.uniqueId !== fan.uniqueId);
  const where = (["level", "system"] as const).find(
    (key) => fan[key] && twins.every((row) => row[key] !== fan[key]),
  );
  const units = [...new Set([fan, ...twins].map((row) => row.uniqueId))].sort();
  const place = !twins.length
    ? ""
    : where
      ? ` · ${fan[where]}`
      : ` (${units.indexOf(fan.uniqueId) + 1} of ${units.length})`;
  return `${fan.mark}${place} / port ${fan.portIndex}`;
};

export type SheetInputs = Immutable<DuctsInputs>;
export type SheetFitting = Immutable<FittingPricing>;

export const TIERS = ["taken", "accept", "preview"] as const;
export type Tier = (typeof TIERS)[number];
