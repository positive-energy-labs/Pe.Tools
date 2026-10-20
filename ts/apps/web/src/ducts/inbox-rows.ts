/**
 * The /ducts inbox in loop order, derived and never stored (modelled on `rooms/cards.ts`):
 * - Fix: what blocks a path to the fan (`bins.ts` `blocking`): no duct path to a fan, anomalous
 *   joins, open ends, loops, no or several roots, a catalog table missing or out of range.
 * - Set: an input a person owes: a terminal with no flow, a fan with no design flow, flex left on
 *   the rigid roughness. Each Set row deep-links to the cell on the tree row that holds it.
 * - Check: Pea's claims for this group awaiting a verdict, and Pea's proposals awaiting staging.
 * - Write: one row, armed only while Fix and Set are empty and the preview is fresh.
 * - Diagnostics: bridged joins (near miss, stretched); final, collapsed, and the only rows that may
 *   stand without a verb a person owes. "Object" stages the proximity `ignore` verdict, which
 *   withholds the join; the objection is a ruling, so it stays here with its take-back, and only
 *   what the break causes (an open end, a lost path) comes up under Fix.
 * A row exists only with a way to act on it: a verb, a deep link or select in Revit.
 */
import type { DuctFinding, DuctsRouteDocument } from "@pe/agent-contracts";
import { bin } from "@pe/ducts-domain/bins";
import { ruleByKey } from "@pe/ducts-domain/loss-rules";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import type { Claim } from "./legs";

export const INBOX_ORDER = ["fix", "set", "check", "write", "diagnostics"] as const;
export type InboxGroup = (typeof INBOX_ORDER)[number];
export const INBOX_LABELS: Record<InboxGroup, string> = {
  fix: "Fix",
  set: "Set",
  check: "Check",
  write: "Write",
  diagnostics: "Diagnostics",
};

/** The Work segments whose cell a tree row holds. */
export type CellSegment =
  | "flows"
  | "terminalDrops"
  | "equipmentFlows"
  | "esp"
  | "roles"
  | "componentDrops";
export interface CellRef {
  segment: CellSegment;
  id: number;
}

export type RowVerb =
  /** Stage a verdict on an assumption key; `on` is the staged verdict, pressing it again takes it back. */
  | {
      kind: "verdict";
      key: string;
      verdict: "capped" | "connect" | "ignore";
      label: string;
      says: string;
      on: boolean;
    }
  | { kind: "role"; id: number; role: "fan" | "passive"; label: string; says: string }
  /** Select the element on the drawing and focus the cell that holds the input. */
  | { kind: "focus"; cell: CellRef; label: string; says: string }
  | { kind: "claim"; claim: Claim }
  | {
      kind: "stage";
      segment: string;
      key: string;
      move: "accept" | "deny";
      label: string;
      says: string;
    }
  | { kind: "select"; ids: readonly number[] };

export interface InboxItem {
  key: string;
  group: Exclude<InboxGroup, "write">;
  kind: string;
  title: string;
  status: string;
  tone?: "alarm" | "caution" | "pea";
  /** The elements it lights and selects. */
  ids: readonly number[];
  /** Prose for the open row. */
  note: string | null;
  verbs: readonly RowVerb[];
}

export interface TriageInput {
  snapshot: Pick<DuctSnapshot, "groups" | "nodes" | "segments">;
  /** The chosen group; empty is every group. */
  group: string;
  findings: readonly DuctFinding[];
  flows: ReadonlyMap<number, { cfm: number | null }>;
  equipmentFlows: ReadonlyMap<number, { cfm: number | null }>;
  doc: DuctsRouteDocument | null;
  nameOf?: (id: number) => string;
  groupLabel?: (id: string) => string;
}

const verdictOf = (doc: DuctsRouteDocument | null, key: string) => {
  const value = doc?.assumptions[key]?.staged?.value;
  return value?.kind === "verdict" ? value.verdict : null;
};
const roleOf = (doc: DuctsRouteDocument | null, id: number) =>
  doc?.roles[String(id)]?.staged?.value.role ?? null;

const select = (ids: readonly number[]): RowVerb => ({ kind: "select", ids });
const verdict = (
  doc: DuctsRouteDocument | null,
  key: string,
  which: "capped" | "connect" | "ignore",
  label: string,
  says: string,
): RowVerb => ({
  kind: "verdict",
  key,
  verdict: which,
  label,
  says,
  on: verdictOf(doc, key) === which,
});

/** The element ids a proximity assumption key names: `proximity:12:0|34:1` or `proximity:12:0|34`. */
export const proximityIds = (key: string) =>
  key
    .slice("proximity:".length)
    .split("|")
    .map((part) => Number(part.split(":")[0]))
    .filter((id) => Number.isInteger(id));

/** Fix, Set, Check and Diagnostics, each in its own order. */
export function triage(input: TriageInput) {
  const { snapshot, group, findings, flows, equipmentFlows, doc } = input;
  const name = input.nameOf ?? String;
  const label = input.groupLabel ?? ((id: string) => id);
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const scope = group
    ? new Set([
        ...snapshot.nodes.filter((n) => n.groupId === group).map((n) => n.id),
        ...snapshot.segments.filter((s) => s.groupId === group).map((s) => s.id),
        ...(snapshot.groups.find((g) => g.id === group)?.rootIds ?? []),
      ])
    : null;
  const owned = group ? new Set(snapshot.groups.find((g) => g.id === group)?.issueIds ?? []) : null;
  const inScope = (f: DuctFinding) =>
    !scope ||
    (f.groupId != null
      ? f.groupId === group
      : owned!.has(f.id) || f.elementIds.some((id) => scope.has(id)));
  const fanless = new Set(
    findings.flatMap((f) => (f.kind === "no-fan" && f.groupId ? [f.groupId] : [])),
  );
  const groupsOf = snapshot.groups.filter((g) => !group || g.id === group);

  const fix: InboxItem[] = [];
  const set: InboxItem[] = [];
  const diagnostics: InboxItem[] = [];
  const names = (ids: readonly number[]) => [...new Set(ids.map(name))].join(", ");

  for (const f of findings) {
    if (!inScope(f) || f.kind === "no-flow" || f.kind === "no-terminal-flow") continue;
    const base = { key: f.id, ids: f.elementIds, note: f.note };
    if (f.grade && f.grade !== "anomalous") {
      diagnostics.push({
        ...base,
        group: "diagnostics",
        kind: "join",
        title: names(f.elementIds) || f.id,
        status: f.grade,
        verbs: [
          verdict(
            doc,
            f.id,
            "ignore",
            "object",
            "Object: withhold this bridged join. The path breaks here and the break comes up under Fix.",
          ),
          select(f.elementIds),
        ],
      });
      continue;
    }
    if (f.kind === "default-flex-roughness") {
      set.push({
        ...base,
        group: "set",
        kind: f.kind,
        title: "Flex on the rigid default roughness",
        status: verdictOf(doc, f.id) ?? "default",
        verbs: [
          verdict(
            doc,
            f.id,
            "ignore",
            "keep the default",
            "Ignore: price this flex on the default roughness",
          ),
          select(f.elementIds),
        ],
      });
      continue;
    }
    if (bin(f) !== "blocking") continue;
    const item = { ...base, group: "fix" as const, kind: f.kind, tone: "alarm" as const };
    switch (f.kind) {
      case "no-fan": {
        const roots = (snapshot.groups.find((g) => g.id === f.groupId)?.rootIds ?? []).filter(
          (id) => roleOf(doc, id) === "passive",
        );
        fix.push({
          ...item,
          title: "No duct path to a fan",
          status: label(f.groupId!),
          verbs: [
            ...roots.map(
              (id): RowVerb => ({
                kind: "role",
                id,
                role: "fan",
                label: `${name(id)} is a fan`,
                says: `Stage ${name(id)} as the fan; a group needs an air mover to price`,
              }),
            ),
            select(f.elementIds),
          ],
        });
        break;
      }
      case "open-end":
        fix.push({
          ...item,
          title: `Open end at ${names(f.elementIds) || f.id}`,
          status: verdictOf(doc, f.id) ?? "open",
          verbs: [
            verdict(doc, f.id, "capped", "capped", "Capped: this end carries no flow"),
            verdict(doc, f.id, "ignore", "ignore", "Ignore: leave this end out of the walk"),
            select(f.elementIds),
          ],
        });
        break;
      case "catalog-missing-table":
      case "catalog-out-of-range":
        fix.push({
          ...item,
          title: `${f.kind === "catalog-missing-table" ? "Catalog table not loaded" : "Out of catalog range"} at ${names(f.elementIds)}`,
          status: "no drop",
          verbs: [
            ...(f.elementIds[0] == null
              ? []
              : [
                  {
                    kind: "focus",
                    cell: { segment: "terminalDrops", id: f.elementIds[0] },
                    label: "state the drop",
                    says: "State this terminal's drop yourself in place of the catalog",
                  } satisfies RowVerb,
                ]),
            select(f.elementIds),
          ],
        });
        break;
      case "loop-by-inference": {
        // The inferred join that closes the loop is the one the finding is named for.
        const join = `proximity:${f.id.slice("loop-by-inference:".length)}`;
        fix.push({
          ...item,
          title: KIND_TITLE[f.kind]!,
          status: "blocks the path",
          verbs: [
            verdict(
              doc,
              join,
              "ignore",
              "break the join",
              "Ignore: withhold the inferred join that closes this loop",
            ),
            select(f.elementIds),
          ],
        });
        break;
      }
      case "multi-root": {
        const active = f.elementIds.filter((id) => roleOf(doc, id) !== "passive");
        fix.push({
          ...item,
          title: `Several roots: ${names(f.elementIds)}`,
          status: "blocks the path",
          verbs: [
            ...active.map(
              (id): RowVerb => ({
                kind: "role",
                id,
                role: "passive",
                label: `${name(id)} is passive`,
                says: `Stage ${name(id)} as passive (it moves no design air); the other root is the fan`,
              }),
            ),
            select(f.elementIds),
          ],
        });
        break;
      }
      default: {
        const grade = f.grade === "anomalous";
        fix.push({
          ...item,
          title: grade
            ? `Anomalous join at ${names(f.elementIds)}`
            : (KIND_TITLE[f.kind] ?? f.kind),
          status: grade ? "anomalous" : "blocks the path",
          verbs: [
            ...(grade
              ? [
                  verdict(doc, f.id, "connect", "keep the join", "Connect: keep this join as drawn"),
                  verdict(doc, f.id, "ignore", "break the join", "Ignore: withhold this join"),
                ]
              : []),
            select(f.elementIds),
          ],
        });
      }
    }
  }

  // A join a person objected to is withheld, so its finding is gone. The objection is a person's
  // ruling, not a blocker: it sits in Diagnostics so it can be taken back, and never holds Write.
  for (const [key, cell] of Object.entries(doc?.assumptions ?? {})) {
    if (!key.startsWith("proximity:") || cell.staged?.value?.kind !== "verdict") continue;
    if (cell.staged.value.verdict !== "ignore") continue;
    const ids = proximityIds(key);
    if (scope && !ids.some((id) => scope.has(id))) continue;
    diagnostics.push({
      key,
      group: "diagnostics",
      kind: "objection",
      title: `Join objected: ${names(ids)}`,
      status: "withheld",
      tone: "caution",
      ids,
      note: "A person withheld this inferred join; the path breaks here.",
      verbs: [
        verdict(doc, key, "ignore", "withdraw", "Take the objection back; the join is bridged again"),
        select(ids),
      ],
    });
  }

  for (const n of snapshot.nodes) {
    if (n.kind !== "terminal" || !n.groupId || (group && n.groupId !== group)) continue;
    if (fanless.has(n.groupId) || flows.get(n.id)?.cfm != null) continue;
    set.push({
      key: `flows:${n.id}`,
      group: "set",
      kind: "terminal-flow",
      title: name(n.id),
      status: "no flow",
      ids: [n.id],
      note: "No override, load preview share or positive Revit flow reaches this terminal.",
      verbs: [
        {
          kind: "focus",
          cell: { segment: "flows", id: n.id },
          label: "enter a flow",
          says: "Select the terminal and enter its design flow",
        },
        select([n.id]),
      ],
    });
  }
  const units = new Set<number>();
  for (const g of groupsOf) {
    if (fanless.has(g.id)) continue;
    for (const id of g.rootIds) {
      if (units.has(id) || nodes.get(id)?.kind !== "equipment" || roleOf(doc, id) === "passive")
        continue;
      units.add(id);
      if (equipmentFlows.get(id)?.cfm != null) continue;
      set.push({
        key: `equipmentFlows:${id}`,
        group: "set",
        kind: "unit-flow",
        title: name(id),
        status: "no design flow",
        ids: [id],
        note: "Revit holds no fan flow for this unit and none is staged; apply writes the staged one.",
        verbs: [
          {
            kind: "focus",
            cell: { segment: "equipmentFlows", id },
            label: "enter a flow",
            says: "Select the unit and enter its design flow",
          },
          select([id]),
        ],
      });
    }
  }

  return { fix, set, diagnostics };
}

const KIND_TITLE: Record<string, string> = {
  loop: "Loop in the system",
  "loop-by-inference": "Loop through an inferred join",
  "no-root": "No root",
  "multi-root": "Several roots",
};

const ELEMENT_WORD: Record<string, string> = {
  flows: "Flow",
  equipmentFlows: "Unit flow",
  esp: "ESP",
  roles: "Role",
  terminalDrops: "Drop",
  componentDrops: "Drop",
};
const FOCUSABLE = new Set(["flows", "equipmentFlows", "esp", "roles", "terminalDrops"]);

const valueWord = (segment: string, value: unknown) => {
  const v = value as Record<string, unknown> | undefined;
  if (!v) return "delete";
  if (segment === "flows" || segment === "equipmentFlows") return `${v.cfm} cfm`;
  if (segment === "esp" || segment === "terminalDrops" || segment === "componentDrops")
    return `${v.inWg} in-wg`;
  if (segment === "roles") return String(v.role);
  if (segment === "rules" || segment === "catalogs") return String(v.table);
  return v.kind === "verdict" ? String(v.verdict) : "a value";
};

/** Pea's claims awaiting a verdict, then its proposals awaiting staging. */
export function checks(input: TriageInput & { claims: readonly Claim[] }): InboxItem[] {
  const { snapshot, group, findings, doc, claims } = input;
  const name = input.nameOf ?? String;
  const scope = group
    ? new Set([
        ...snapshot.nodes.filter((n) => n.groupId === group).map((n) => n.id),
        ...snapshot.segments.filter((s) => s.groupId === group).map((s) => s.id),
      ])
    : null;
  const items: InboxItem[] = claims
    .filter((claim) => !claim.verdict)
    .map((claim) => ({
      key: `claim:${claim.id}`,
      group: "check",
      kind: "claim",
      title: claim.text,
      status: claim.state,
      tone: "pea",
      ids: claim.at,
      note: `Pea says this is ${claim.state}`,
      verbs: [{ kind: "claim", claim }, select(claim.at)],
    }));
  const awaiting = (cells: Record<string, { proposal?: { value?: unknown }; staged?: unknown }> | undefined) =>
    Object.entries(cells ?? {}).filter(([, cell]) => cell.proposal && !cell.staged);
  const segments = doc as unknown as Record<
    string,
    Record<string, { proposal?: { value?: unknown }; staged?: unknown }> | undefined
  > | null;
  const proposal = (segment: string, key: string, title: string, value: unknown, ids: number[]) =>
    items.push({
      key: `${segment}:${key}`,
      group: "check",
      kind: "proposal",
      title,
      status: `Pea proposes ${valueWord(segment, value)}`,
      tone: "pea",
      ids,
      note: null,
      verbs: [
        {
          kind: "stage",
          segment,
          key,
          move: "accept",
          label: "accept",
          says: "Stage Pea's proposal",
        },
        { kind: "stage", segment, key, move: "deny", label: "reject", says: "Clear Pea's proposal" },
        ...(FOCUSABLE.has(segment) && ids[0] != null
          ? [
              {
                kind: "focus",
                cell: { segment: segment as CellSegment, id: ids[0] },
                label: "see it",
                says: "Select the element and focus its cell",
              } satisfies RowVerb,
            ]
          : []),
        select(ids),
      ],
    });
  for (const segment of Object.keys(ELEMENT_WORD))
    for (const [key, cell] of awaiting(segments?.[segment])) {
      const id = Number(key);
      if (scope && !scope.has(id)) continue;
      proposal(segment, key, `${ELEMENT_WORD[segment]} · ${name(id)}`, cell.proposal!.value, [id]);
    }
  for (const [key, cell] of awaiting(segments?.rules)) {
    const rule = ruleByKey(key);
    proposal(
      "rules",
      key,
      rule ? `Rule · ${rule.family} : ${rule.type}` : `Rule · ${key}`,
      cell.proposal!.value,
      [],
    );
  }
  for (const [key, cell] of awaiting(segments?.catalogs))
    proposal("catalogs", key, `Catalog link · ${key}`, cell.proposal!.value, []);
  const shown = new Set(findings.map((f) => f.id));
  for (const [key, cell] of awaiting(segments?.assumptions)) {
    if (!shown.has(key)) continue;
    const f = findings.find((x) => x.id === key)!;
    proposal("assumptions", key, `Ruling · ${f.note.slice(0, 60)}`, cell.proposal!.value, [
      ...f.elementIds,
    ]);
  }
  return items;
}

/** What the Write row needs from the page: staged cells, and the last preview's standing. */
export interface WriteState {
  staged: number;
  hasPreview: boolean;
  fresh: boolean;
  planned: number | null;
  refused: number | null;
}

/** The refusal sentence while Fix or Set rows remain; null when nothing stands in the way. */
export function writeBlocked(left: { fix: number; set: number }): string | null {
  if (!left.fix && !left.set) return null;
  const parts = [left.fix ? `${left.fix} to fix` : "", left.set ? `${left.set} to set` : ""];
  return `${parts.filter(Boolean).join(" and ")} before writing`;
}

export interface WriteRow {
  title: string;
  status: string;
  /** Why apply is not armed for Fix or Set; null when they are empty. The preview's own refusal is the action's. */
  blocked: string | null;
}

export function writeRow(left: { fix: number; set: number }, write: WriteState): WriteRow {
  return {
    title: write.fresh && write.planned ? `Write ${write.planned} to Revit` : "Write to Revit",
    status: !write.staged
      ? "nothing staged"
      : !write.hasPreview
        ? "not previewed"
        : !write.fresh
          ? "preview out of date"
          : `${write.planned ?? 0} planned · ${write.refused ?? 0} refused`,
    blocked: writeBlocked(left),
  };
}

/** The whole inbox: its groups in `INBOX_ORDER`, and the Write row. */
export function inboxRows(input: TriageInput & { claims: readonly Claim[]; write: WriteState }) {
  const { fix, set, diagnostics } = triage(input);
  return {
    fix,
    set,
    check: checks(input),
    write: writeRow({ fix: fix.length, set: set.length }, input.write),
    diagnostics,
  };
}
