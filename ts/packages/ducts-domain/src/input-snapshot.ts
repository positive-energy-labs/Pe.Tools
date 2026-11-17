import type { DuctSnapshot } from "./types.ts";
/** Issues and tolerances are C#'s model health (ducts LEDGER 2026-10-29); absent, no open end has a measured neighbourhood. */
export type SheetSnapshot = Pick<DuctSnapshot, "nodes" | "segments" | "document"> &
  Partial<Pick<DuctSnapshot, "slots" | "issues" | "tolerances" | "walk" | "reach" | "store" | "parameterCohorts">>;
