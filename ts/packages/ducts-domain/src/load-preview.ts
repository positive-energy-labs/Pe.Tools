/**
 * The load tool's Load Preview as pasted from Excel: tab-separated, one block per system. A block
 * opens with "System n <rooms served> <tag>" and the system's air flow, then "Ventilation",
 * "Misc. Return" and "Zone n" rows (skipped), then one row per room ("1-Golf Sim 005"), then a
 * blank row. The tag is the equipment Mark; the room number is the room's trailing token.
 * Header and instruction rows above the first system are tolerated: the CFM column is the one
 * whose header reads Air Flow (or Sys Act CFM); without a header it is the sixth column after the
 * name, the load tool's own export layout. Pure: text in, systems out.
 */
import type { DuctLoadPreview } from "@pe/agent-contracts";

export type LoadPreviewSystem = DuctLoadPreview["systems"][number];
export interface LoadPreviewFinding {
  kind: "no-tag" | "no-cfm" | "no-cfm-column" | "no-system";
  line: number;
  text: string;
}
export interface LoadPreview extends DuctLoadPreview {
  findings: LoadPreviewFinding[];
}

const TAG = /^[A-Z]{1,5}-\d+[A-Z]?$/;
const ROOM_NUMBER = /^\d+[A-Z]?$/;
const SYSTEM = /^System\s+\d+/i;
const SKIPPED = /^(Ventilation|Misc\.? Return|Zone \d+|Building)$/i;
const CFM_HEADER = /^(air ?flow|sys\.? act\.? cfm)$/i;
const DEFAULT_CFM_COLUMN = 6;

const tagOf = (name: string) =>
  name
    .split(/\s+/)
    .reverse()
    .find((token) => TAG.test(token)) ?? null;
const numberOf = (name: string) => {
  const last = name.split(/\s+/).at(-1) ?? "";
  return ROOM_NUMBER.test(last) ? last : null;
};
const cfmOf = (cell: string | undefined) => {
  const n = Number((cell ?? "").replace(/,/g, "").trim());
  return cell?.trim() && Number.isFinite(n) ? n : null;
};

export function parseLoadPreview(text: string): LoadPreview {
  const systems: LoadPreviewSystem[] = [];
  const findings: LoadPreviewFinding[] = [];
  let cfmColumn: number | null = null;
  let current: LoadPreviewSystem | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const cells = raw.split("\t").map((c) => c.trim());
    const name = cells[0] ?? "";
    const line = index + 1;
    const header = cells.findIndex((c) => CFM_HEADER.test(c));
    if (header > 0) {
      cfmColumn = header;
      return;
    }
    if (SYSTEM.test(name)) {
      if (cfmColumn == null) {
        cfmColumn = DEFAULT_CFM_COLUMN;
        findings.push({ kind: "no-cfm-column", line, text: name });
      }
      current = { name, tag: tagOf(name), cfm: cfmOf(cells[cfmColumn]), rooms: [] };
      systems.push(current);
      if (!current.tag) findings.push({ kind: "no-tag", line, text: name });
      if (current.cfm == null) findings.push({ kind: "no-cfm", line, text: name });
      return;
    }
    if (!name || SKIPPED.test(name)) return;
    if (!current) {
      if (cfmColumn != null) findings.push({ kind: "no-system", line, text: name });
      return;
    }
    current.rooms.push({ name, number: numberOf(name), cfm: cfmOf(cells[cfmColumn!]) });
  });
  return { systems, findings };
}
