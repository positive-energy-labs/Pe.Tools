/**
 * Every input this fan's walk reads, as rows that never vanish (kaitpw 2026-10-30: "whys that even
 * called an override"). A row is a value with its source: typed is a state of the row, not a list
 * of its own. Clearing a typed value returns the row to what lies under it (revit, firm,
 * suggested, none), so the person still sees what they would be redoing. A unit kind is one row
 * per [family, type], naming the units it covers (it was one raw-key row per instance).
 */
import {
  DUCT_UNIT_KINDS,
  type DuctUnitKind,
  type DuctsInputs,
  type DuctsRouteDocument,
  type DuctsSheetEdits,
  type Resolved,
} from "@pe/agent-contracts";
import { catalogLinkKey } from "@pe/ducts-domain/catalog";
import { END_KEY, FITTING_DROP_CELL, JOIN_KEY } from "@pe/ducts-domain/sheet/index";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { SubjectPart } from "@pe/kit/lang/subject-text";
import { kindDisabledReason, kindMeaning } from "./kind-meaning";
import type { WorkCell } from "./sheet-cell";

export type InputSection = "units" | "terminals" | "parts" | "rulings";
export const SECTION_WORDS: Record<InputSection, string> = {
  units: "Units",
  terminals: "Terminals",
  parts: "Parts and proposed paths",
  rulings: "Rulings",
};

export type InputControl =
  | {
      kind: "number";
      value: number | null;
      unit: string;
      digits: number;
      cell: WorkCell;
      positive?: boolean;
      edit: (value: number) => DuctsSheetEdits;
    }
  | {
      kind: "kind";
      value: DuctUnitKind;
      options: { kind: DuctUnitKind; meaning: string; disabled: string | null }[];
      /** The Work `kinds` cell (a Pea suggestion lives here) and its key; null key until the node arrives. */
      cell: WorkCell | undefined;
      cellKey: string | null;
      /** Null until the unit's snapshot node (its family and type) arrives. */
      edit: ((kind: DuctUnitKind) => DuctsSheetEdits) | null;
    }
  | { kind: "text"; value: string };

export type InputRow = {
  key: string;
  section: InputSection;
  /** The row's own words (Unit kind, Airflow, Drop, Join); a kind row's family and type in `title`. */
  label: string;
  title?: string;
  subject: SubjectPart[];
  ids: number[];
  source: string;
  typed: boolean;
  control: InputControl;
  /** What clearing writes (back to the source underneath); null when nothing is typed. */
  clear: DuctsSheetEdits | null;
};

export interface RowContext {
  snapshot: Pick<DuctSnapshot, "nodes">;
  doc: DuctsRouteDocument | null;
  inputs: DuctsInputs | null;
  /** The open fan's unit: its ESP is an input of this sheet; another unit's is not. */
  fanUnitId: number | null;
  /** Proposed path keys to the subject that names them (from the fittings census). */
  pathSubject?: (key: string) => SubjectPart[] | null;
}

export const sourceChip = ({ source, ref }: Resolved<unknown>) =>
  `${source}${ref ? ` ${ref}` : ""}`;
const subjectIds = (parts: readonly SubjectPart[]) =>
  parts.flatMap((p) => (typeof p === "string" ? [] : [p.id]));
const joinSubject = (pair: readonly string[]): SubjectPart[] => {
  const [a, b] = pair.map((end) => {
    const [id, connector] = end.split(":").map(Number);
    return { id: id!, connector: connector! };
  });
  return [a!, " ↔ ", b!];
};

export function inputRows(ctx: RowContext): InputRow[] {
  const inputs = ctx.inputs;
  if (!inputs) return [];
  const rows: InputRow[] = [];
  const nodes = new Map(ctx.snapshot.nodes.map((n) => [n.id, n]));
  const number = (
    key: string,
    section: InputSection,
    label: string,
    id: number,
    resolved: Resolved<number | null>,
    unit: string,
    digits: number,
    cell: WorkCell | undefined,
    edit: (value: number) => DuctsSheetEdits,
    clear: DuctsSheetEdits,
  ) =>
    rows.push({
      key,
      section,
      label,
      subject: [{ id }],
      ids: [id],
      source: sourceChip(resolved),
      typed: resolved.source === "typed",
      control: { kind: "number", value: resolved.value, unit, digits, cell: cell ?? {}, edit },
      clear: resolved.source === "typed" ? clear : null,
    });

  // Unit kinds: one row per [family, type] over every unit of it on this walk.
  const kinds = new Map<string, number[]>();
  for (const id of Object.keys(inputs.units)) {
    const node = nodes.get(Number(id));
    const key = node ? catalogLinkKey(node.family, node.type) : `unit:${id}`;
    kinds.set(key, [...(kinds.get(key) ?? []), Number(id)]);
  }
  for (const [kindKey, ids] of kinds) {
    const node = nodes.get(ids[0]!);
    const unit = inputs.units[String(ids[0])]!;
    const subject = ids.flatMap((id, i): SubjectPart[] => (i ? [", ", { id }] : [{ id }]));
    rows.push({
      key: `kind:${kindKey}`,
      section: "units",
      label: "Unit kind",
      ...(node ? { title: [node.family, node.type].filter(Boolean).join(" · ") } : {}),
      subject,
      ids,
      source: sourceChip(unit.kind),
      typed: unit.kind.source === "typed",
      control: {
        kind: "kind",
        value: unit.kind.value,
        options: DUCT_UNIT_KINDS.map((kind) => ({
          kind,
          meaning: node ? kindMeaning(node, kind, unit) : "wait for the element snapshot",
          // Only "this kind removes the unit from the fan list" disables; the rest stay pickable.
          disabled: node ? kindDisabledReason(node, kind, unit) : null,
        })),
        edit: node ? (kind) => ({ kinds: { [kindKey]: { kind } } }) : null,
        cell: node ? ctx.doc?.kinds[kindKey] : undefined,
        cellKey: node ? kindKey : null,
      },
      clear: node && unit.kind.source === "typed" ? { kinds: { [kindKey]: null } } : null,
    });
  }
  for (const [id, unit] of Object.entries(inputs.units)) {
    const n = Number(id);
    number(
      `unit:${id}:cfm`,
      "units",
      "Unit airflow",
      n,
      unit.cfm,
      "cfm",
      0,
      ctx.doc?.equipmentFlows[id],
      (cfm) => ({ equipmentFlows: { [id]: { cfm } } }),
      { equipmentFlows: { [id]: null } },
    );
    if (n === ctx.fanUnitId || unit.esp.source === "typed")
      number(
        `unit:${id}:esp`,
        "units",
        "Unit ESP",
        n,
        unit.esp,
        "in-wg",
        4,
        ctx.doc?.esp[id],
        (inWg) => ({ esp: { [id]: { inWg } } }),
        { esp: { [id]: null } },
      );
    if (unit.role.source === "typed")
      rows.push({
        key: `unit:${id}:role`,
        section: "units",
        label: "Unit role",
        subject: [{ id: n }],
        ids: [n],
        source: sourceChip(unit.role),
        typed: true,
        control: { kind: "text", value: unit.role.value },
        clear: { roles: { [id]: null } },
      });
  }
  for (const [id, t] of Object.entries(inputs.terminals)) {
    number(
      `terminal:${id}:cfm`,
      "terminals",
      "Terminal airflow",
      Number(id),
      t.cfm,
      "cfm",
      0,
      ctx.doc?.flows[id],
      (cfm) => ({ flows: { [id]: { cfm } } }),
      { flows: { [id]: null } },
    );
    number(
      `terminal:${id}:drop`,
      "terminals",
      "Terminal drop",
      Number(id),
      t.drop,
      "in-wg",
      4,
      ctx.doc?.terminalDrops[id],
      (inWg) => ({ terminalDrops: { [id]: { inWg } } }),
      { terminalDrops: { [id]: null } },
    );
  }
  for (const [id, c] of Object.entries(inputs.components))
    number(
      `component:${id}:drop`,
      "parts",
      "Part drop",
      Number(id),
      c.drop,
      "in-wg",
      4,
      ctx.doc?.componentDrops[id],
      (inWg) => ({ componentDrops: { [id]: { inWg } } }),
      { componentDrops: { [id]: null } },
    );
  for (const [key, drop] of Object.entries(inputs.fittingDrops)) {
    const subject = ctx.pathSubject?.(key) ?? [key];
    rows.push({
      key: `path:${key}`,
      section: "parts",
      label: "Proposed path drop",
      subject,
      ids: subjectIds(subject),
      source: sourceChip(drop),
      typed: drop.source === "typed",
      control: {
        kind: "number",
        value: drop.value,
        unit: "in-wg",
        digits: 4,
        cell: ctx.doc?.assumptions[FITTING_DROP_CELL(key)] ?? {},
        edit: (inWg) => ({ fittingDrops: { [key]: { inWg } } }),
      },
      clear: drop.source === "typed" ? { fittingDrops: { [key]: null } } : null,
    });
  }
  for (const ruling of inputs.rulings.joins) {
    if (ctx.doc?.assumptions[JOIN_KEY(ruling.pair)]?.edit?.value?.kind !== "verdict") continue;
    const subject = joinSubject(ruling.pair);
    rows.push({
      key: JOIN_KEY(ruling.pair),
      section: "rulings",
      label: "Join",
      subject,
      ids: subjectIds(subject),
      source: "typed",
      typed: true,
      control: { kind: "text", value: ruling.verdict },
      clear: { joins: [{ pair: ruling.pair, verdict: "clear" }] },
    });
  }
  for (const ruling of inputs.rulings.ends) {
    if (ctx.doc?.assumptions[END_KEY(ruling.end)]?.edit?.value?.kind !== "verdict") continue;
    rows.push({
      key: END_KEY(ruling.end),
      section: "rulings",
      label: "End",
      subject: [{ id: ruling.end.elementId, connector: ruling.end.connector }],
      ids: [ruling.end.elementId],
      source: "typed",
      typed: true,
      control: { kind: "text", value: ruling.verdict },
      clear: { ends: [{ end: ruling.end, verdict: "clear" }] },
    });
  }
  return rows;
}
