/**
 * The Fittings census grouped by what a choice keys on (kaitpw 2026-10-30: "fittings list should
 * probably be grouped"). A table choice is per rule and document-wide (Work `rules`), so a matched
 * fitting sits under its rule; an assignment is per family for the fittings no rule matches (Work
 * `ruleAssignments`), so an unmatched fitting sits under its family; a proposed fitting no rule
 * prices stands alone. A choice already in Work that no fitting of this fan reads keeps its header,
 * so it can still be seen, cleared and restored. Each option says what it means (the ASHRAE
 * fitting the table describes), never the mechanism.
 */
import type { DuctsInputs, DuctsSheetEdits, FittingPricing } from "@pe/agent-contracts";
import { ruleByKey, ruleWords } from "@pe/ducts-domain/loss-rules";
import type { SubjectPart } from "@pe/kit/lang/subject-text";

/** "CD3-1  Elbow, Die Stamped, 90 Degree, r/D = 1.5 (UMC 1985, Report SRF785)" → the fitting words. */
export const tableMeaning = (
  id: string,
  titles: Readonly<Record<string, string>>,
): string | null => {
  const title = titles[id.toUpperCase()];
  if (!title) return null;
  return title
    .replace(new RegExp(`^\\s*${id.replace(/[-]/g, "\\-")}\\s*`, "i"), "")
    .replace(/\s*\([^()]*\)\s*$/, "")
    .trim();
};

export type GroupChoice = {
  key: string;
  label: string;
  /** What picking it means: the ASHRAE fitting, and how far the choice reaches. */
  sub: string;
  /** What it writes; null for the current choice. */
  edits: DuctsSheetEdits | null;
  current: boolean;
};

export type GroupMember = {
  key: string;
  subject: SubjectPart[];
  ids: number[];
  lossInWg: number | null;
  /** Why it is not priced, or the table it reads when that differs from its group's. */
  note: string | null;
};

export type FittingGroup = {
  key: string;
  kind: "rule" | "family" | "proposed";
  title: string;
  /** How far a choice in this header reaches. */
  reach: string;
  table: string | null;
  tableMeaning: string | null;
  /** default, typed, stored, fallback, assigned, or not priced. */
  source: string;
  choices: GroupChoice[];
  /** What clearing the person's choice writes; null when nothing is chosen. */
  clear: DuctsSheetEdits | null;
  members: GroupMember[];
  lossInWg: number | null;
  unpriced: number;
};

const endOf = (end: string) => {
  const [id, connector] = end.split(":").map(Number);
  return { id: id!, connector: connector! };
};
export function memberSubject(f: FittingPricing): SubjectPart[] {
  if (!f.proposed) return [{ id: f.elementId! }];
  const [a, b] = f.proposed.pair.map(endOf);
  const toward = f.proposed.toward;
  return [a!, " to ", b!, ...(toward == null ? [] : [" → ", { id: toward }])];
}
const idsOf = (parts: readonly SubjectPart[]) =>
  parts.flatMap((p) => (typeof p === "string" ? [] : [p.id]));

const ORDER = { proposed: 0, family: 1, rule: 2 } as const;

export function fittingGroups(
  fittings: readonly FittingPricing[],
  inputs: Pick<DuctsInputs, "tables" | "assignments"> | null,
  titles: Readonly<Record<string, string>> = {},
): FittingGroup[] {
  const groups = new Map<
    string,
    { kind: FittingGroup["kind"]; rows: FittingPricing[]; name: string }
  >();
  for (const f of fittings) {
    const [kind, name] =
      f.ruleSource === "matched" && f.rule
        ? (["rule", f.rule] as const)
        : f.proposed
          ? (["proposed", [...f.proposed.pair].sort().join("|")] as const)
          : (["family", f.family ?? ""] as const);
    const key = `${kind}:${name}`;
    const g = groups.get(key) ?? { kind, rows: [], name };
    g.rows.push(f);
    groups.set(key, g);
  }
  // A choice in Work that no fitting of this fan reads still has a header (it can be cleared).
  for (const rule of Object.keys(inputs?.tables ?? {}))
    if (![...groups.values()].some((g) => g.rows.some((f) => f.rule === rule)))
      groups.set(`rule:${rule}`, { kind: "rule", rows: [], name: rule });
  for (const family of Object.keys(inputs?.assignments ?? {}))
    if (!groups.has(`family:${family}`))
      groups.set(`family:${family}`, { kind: "family", rows: [], name: family });

  const meaning = (t: string) => tableMeaning(t, titles);
  const sub = (t: string, reach: string) =>
    `${meaning(t) ?? "not served by this Revit's ASHRAE set"} · ${reach}`;
  const out: FittingGroup[] = [];
  for (const [key, g] of groups) {
    const members = g.rows.map((f): GroupMember => {
      const subject = memberSubject(f);
      return {
        key: f.key,
        subject,
        ids: idsOf(subject),
        lossInWg: f.lossInWg,
        note: f.unpriced ?? (f.typed != null ? `typed ${f.typed} in-wg` : null),
      };
    });
    const known = g.rows.filter((f) => f.lossInWg != null);
    const lossInWg = known.length ? known.reduce((a, f) => a + f.lossInWg!, 0) : null;
    const unpriced = g.rows.filter((f) => f.unpriced != null).length;
    const base = { key, kind: g.kind, members, lossInWg, unpriced };
    if (g.kind === "rule") {
      const rule = ruleByKey(g.name);
      const chosen = inputs?.tables[g.name];
      const table = (chosen?.value ?? rule?.table ?? g.rows[0]?.table ?? "").toUpperCase() || null;
      const reach = "every fitting this rule matches in the document";
      const options = [
        ...new Set([
          ...(rule ? [rule.table, ...rule.options] : []),
          ...g.rows.flatMap((f) => f.options),
        ]),
      ];
      const fallback = g.rows.length > 0 && g.rows.every((f) => f.tableSource === "fallback");
      out.push({
        ...base,
        title: rule ? ruleWords(rule) : g.name,
        reach: g.rows.length ? reach : `${reach}; none on this fan's walk`,
        table,
        tableMeaning: table ? meaning(table) : null,
        source: chosen ? chosen.source : fallback ? "fallback" : "default",
        choices: options.map((t) => ({
          key: t,
          label: t === rule?.table ? `${t} · rule default` : t,
          sub: sub(t, reach),
          current: t === table,
          // Picking the rule's own table clears a choice instead of typing the default (r16 wrote
          // "typed CD3-2", which changed nothing and read as a person's choice).
          edits:
            t === table
              ? null
              : t === rule?.table
                ? { tables: { [g.name]: null } }
                : { tables: { [g.name]: { table: t } } },
        })),
        clear: chosen?.source === "typed" ? { tables: { [g.name]: null } } : null,
      });
      continue;
    }
    if (g.kind === "family") {
      const assigned = inputs?.assignments[g.name];
      const rule = assigned ? ruleByKey(assigned.value) : undefined;
      const table = g.rows.find((f) => f.table)?.table ?? rule?.table ?? null;
      const reach = `every ${g.name || "fitting"} no rule matches, document-wide`;
      const candidates = g.rows[0]?.candidates ?? [];
      out.push({
        ...base,
        title: g.name || "unknown family",
        reach: g.rows.length ? reach : `${reach}; none on this fan's walk`,
        table,
        tableMeaning: table ? meaning(table) : null,
        source: assigned
          ? rule
            ? `assigned ${ruleWords(rule)}`
            : "assigned"
          : unpriced
            ? "not priced"
            : "auto",
        choices: g.name
          ? candidates.flatMap((c) =>
              c.tables.map((t, i) => ({
                key: `${c.rule}|${t}`,
                label: `${t} · as ${c.words}`,
                sub: sub(t, i === 0 ? reach : `${reach}; also every ${c.rule} fitting reads ${t}`),
                current: assigned?.value === c.rule && table === t,
                edits:
                  assigned?.value === c.rule && table === t
                    ? null
                    : {
                        assignments: { [g.name]: { rule: c.rule } },
                        ...(i === 0 ? {} : { tables: { [c.rule]: { table: t } } }),
                      },
              })),
            )
          : [],
        clear: assigned?.source === "typed" ? { assignments: { [g.name]: null } } : null,
      });
      continue;
    }
    const first = g.rows[0]!;
    out.push({
      ...base,
      title: first.family ?? `proposed ${first.proposed?.kind ?? "fitting"}`,
      reach: "this proposed fitting only; type a path drop on its ledger row",
      table: first.table,
      tableMeaning: first.table ? meaning(first.table) : null,
      source: first.typed != null ? "typed" : unpriced ? "not priced" : "auto",
      choices: [],
      clear: null,
    });
  }
  return out.sort(
    (a, b) =>
      ORDER[a.kind] - ORDER[b.kind] || a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
  );
}
