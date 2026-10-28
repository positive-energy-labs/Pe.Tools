import { z } from "zod";
import {
  ductsRosterResponseSchema,
  ductsSheetResponseSchema,
  type DocumentRef,
  type DuctsSheetRequest,
  type DuctsSheetResponse,
  type DuctsRosterResponse,
} from "@pe/agent-contracts";
import { readPeError } from "@pe/host-contracts/pe-api";
import { hostFetch } from "#/host/runtime";

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

export class StaleSheet extends Error {}
async function post<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  const response = await hostFetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 409) throw new StaleSheet("Sheet changed; reading a new overview.");
  if (!response.ok) throw Error((await readPeError(response)).message);
  return schema.parse(await response.json());
}
export const readRoster = (target: DocumentRef, signal: AbortSignal) =>
  post("/pe/ducts/roster", { target }, ductsRosterResponseSchema, signal);
export const readSheet = (request: DuctsSheetRequest, signal: AbortSignal) =>
  post("/pe/ducts/sheet", request, ductsSheetResponseSchema, signal);
