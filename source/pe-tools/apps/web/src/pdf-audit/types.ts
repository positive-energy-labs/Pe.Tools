/**
 * PDF audit primitives shared by the /family-audit and /family-doc routes and
 * their /api/pdf-audit/* server handlers. The document shape lives in the
 * standalone grounded-doc module; this module adds the audit-specific layer
 * (cell proposals keyed to grounded blocks).
 */
import type { GroundedBlock } from "#/grounded-doc/types";

export type {
  DocBBox as AuditBBox,
  GroundedBlock,
  ParsedDocView,
  ParsedPage,
} from "#/grounded-doc/types";

export type ProposalConfidence = "high" | "medium" | "low";

export interface CellProposal {
  /** Parameter name (table row) */
  row: string;
  /** Type name (table column) */
  column: string;
  value: string;
  confidence: ProposalConfidence;
  blockId: string | null;
  note?: string;
}

export interface MapRequestRow {
  name: string;
  description?: string;
}

export interface MapRequest {
  rows: MapRequestRow[];
  columns: string[];
  /** current[rowName][columnName] = displayed value */
  current: Record<string, Record<string, string>>;
  blocks: Array<Pick<GroundedBlock, "id" | "page" | "kind" | "md">>;
}

export interface MapResponse {
  engine: "anthropic" | "heuristic";
  proposals: CellProposal[];
  note?: string;
}

// Unit separator keeps keys collision-free for names containing spaces/colons.
export const CELL_KEY_SEPARATOR = String.fromCharCode(31);

export function cellKey(row: string, column: string): string {
  return row + CELL_KEY_SEPARATOR + column;
}

export function splitCellKey(key: string): [row: string, column: string] {
  const index = key.indexOf(CELL_KEY_SEPARATOR);
  return [key.slice(0, index), key.slice(index + 1)];
}
