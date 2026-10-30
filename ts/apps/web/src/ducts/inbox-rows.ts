/** Derived inbox in loop order. Off-system findings stay in Diagnostics and never hold the ESP. */
import type { DuctFinding, DuctsRouteDocument } from "@pe/agent-contracts";
import { bin } from "@pe/ducts-domain/bins";
import { fanCandidates, type FanAssignment } from "@pe/ducts-domain/fan-assignment";
import { healFindings, type HealGroup, type HealItem, type HealPlan } from "@pe/ducts-domain/heal";
import { findingLabel, subjectName } from "@pe/ducts-domain/words";
import { ruleByKey } from "@pe/ducts-domain/loss-rules";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { slotWord, type AirflowOf, type AirflowOption } from "./airflow";
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

export function compactStatus(status: string): string {
  const read = /^(\d+) of (\d+) (?:terminals|units) read$/.exec(status);
  if (read) return `${read[1]}/${read[2]} read`;
  return (
    COMPACT[status] ??
    status
      .replace(/ · not on .*'s runs$/, "")
      .replace(/^not on .*'s runs$/, "off runs")
      .replace(/^ruled: /, "")
      .replace(/^Pea proposes /, "Pea: ")
      .replace(/ · ESP .* in-wg$/, "")
  );
}
const COMPACT: Record<string, string> = {
  "outside priced paths": "off path",
  "possible missed join": "missed join?",
  "priced per fan": "per fan",
  "priced as a tree": "as a tree",
  "no design flow": "no flow",
  "fix in Revit": "in Revit",
  "blocks the path": "blocks",
  "nothing edit": "none edit",
};

export type RowVerb =
  | { kind: "price-as"; family: string }
  | {
      kind: "verdict";
      key: string;
      verdict: "capped" | "connect" | "ignore";
      label: string;
      says: string;
      on: boolean;
    }
  | { kind: "role"; id: number; role: "fan" | "passive"; label: string; says: string }
  | {
      kind: "command";
      on: { verb: "heal"; group: string } | { verb: "fan"; unitId: number; systemId: number };
      label: string;
      says: string;
    }
  | { kind: "focus"; cell: CellRef; label: string; says: string }
  | { kind: "claim"; claim: Claim }
  | { kind: "airflow"; of?: AirflowOf; current: string; options: readonly AirflowOption[] }
  | {
      kind: "stage";
      segment: string;
      key: string;
      move: "take" | "unsuggest";
      label: string;
      says: string;
    }
  | { kind: "select"; ids: readonly number[] };

export interface InboxItem {
  key: string;
  findingIds?: readonly string[];
  group: Exclude<InboxGroup, "write">;
  kind: string;
  title: string;
  titleParts?: readonly import("@pe/kit/lang/subject-text").SubjectPart[];
  status: string;
  tone?: "alarm" | "caution" | "pea";
  ids: readonly number[];
  note: string | null;
  parts?: readonly import("@pe/kit/lang/subject-text").SubjectPart[];
  verbs: readonly RowVerb[];
  /** False on a Fix row that stands in no path (a Heal row covering only bridged joins, a heal result): it does not hold the ESP. */
  blocks?: false;
}

export interface TriageInput {
  snapshot: Pick<DuctSnapshot, "groups" | "nodes" | "segments"> &
    Partial<Pick<DuctSnapshot, "systems">>;
  scope: SystemScope | null;
  findings: readonly DuctFinding[];
  flows: ReadonlyMap<number, { cfm: number | null }>;
  equipmentFlows: ReadonlyMap<number, { cfm: number | null }>;
  doc: DuctsRouteDocument | null;
  nameOf?: (id: number) => string;
  groupLabel?: (id: string) => string;
  heal?: HealPlan | null;
  airflow?: { current: string; options: readonly AirflowOption[] };
  unitAirflow?: { current: string; options: readonly AirflowOption[] };
  roles?: ReadonlyMap<number, { role: "fan" | "passive"; why: string; reason: string }>;
}

export function fanVerbs(
  a: FanAssignment,
  name: (id: number) => string,
): Extract<RowVerb, { kind: "command" }>[] {
  const words = `make ${name(a.unitId)} the fan of ${a.system}`;
  return [
    {
      kind: "command",
      on: { verb: "fan", ...a },
      label: words,
      says: `Review ${words} in Revit, then commit the same request`,
    },
  ];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function healRow(
  g: HealGroup,
  blocks: boolean,
  name: (id: number) => string,
  label: (g: HealGroup) => string,
): InboxItem {
  const caps = g.items.filter((i) => i.kind === "cap").length;
  const joins = g.items.length - caps;
  const counts = [caps ? plural(caps, "cap") : "", joins ? plural(joins, "join") : ""]
    .filter(Boolean)
    .join(" · ");
  const line = (i: HealItem) => {
    const [a, b] = i.ids.map(name);
    if (i.kind === "cap") return `cap ${a} (end ${i.end.split(":")[1]})`;
    return `${i.how} ${a} to ${b}${i.gapIn > 0 ? `, ${i.gapIn.toFixed(2)} in` : ""}`;
  };
  return {
    key: `heal:${g.group}`,
    findingIds: g.items.flatMap((item) => item.covers),
    group: "fix",
    kind: "heal",
    title: `Heal ${label(g)}: ${counts}`,
    status: "review repairs",
    ...(blocks ? { tone: "alarm" as const } : { blocks: false as const }),
    ids: [...new Set(g.items.flatMap((i) => i.ids))],
    note: `${g.items.map(line).join("; ")}. Review runs each repair and Pe's check in Revit and rolls it back; commit applies the same request.`,
    verbs: [
      {
        kind: "command",
        on: { verb: "heal", group: g.group },
        label: "heal",
        says: `Review healing ${counts}, then commit in Revit`,
      },
      select(g.items.flatMap((i) => i.ids)),
    ],
  };
}

const verdictOf = (doc: DuctsRouteDocument | null, key: string) => {
  const value = doc?.assumptions[key]?.edit?.value;
  return value?.kind === "verdict" ? value.verdict : null;
};
const roleOf = (doc: DuctsRouteDocument | null, id: number) =>
  doc?.roles[String(id)]?.edit?.value.role ?? null;

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

const proximityIds = (key: string) =>
  key
    .slice("proximity:".length)
    .split("|")
    .map((part) => Number(part.split(":")[0]))
    .filter((id) => Number.isInteger(id));

export function triage(input: TriageInput) {
  const { snapshot, scope, findings, flows, equipmentFlows, doc } = input;
  // The role a unit plays now: the survey's (ruled, edit, else proposed), else Work's edit one.
  const roleNow = (id: number) => input.roles?.get(id)?.role ?? roleOf(doc, id);
  const name = (id: number) => subjectName("unnamed element", input.nameOf?.(id));
  const label = input.groupLabel ?? ((id: string) => id);
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const inGroups = new Set(scope?.groups ?? []);
  const owner = new Map(
    snapshot.groups.flatMap((g) =>
      inGroups.has(g.id) ? g.issueIds.map((i) => [i, g.id] as const) : [],
    ),
  );
  const inScope = (f: DuctFinding) =>
    !scope ||
    (f.groupId != null
      ? inGroups.has(f.groupId)
      : owner.has(f.id) || f.elementIds.some((id) => scope.members.has(id)));
  const pricesSystem = (f: DuctFinding) =>
    !scope ||
    (f.groupId != null
      ? scope.pricing.has(f.groupId)
      : f.elementIds.length
        ? f.elementIds.some((id) => scope.prices.has(id))
        : scope.pricing.has(owner.get(f.id) ?? ""));
  const fanless = new Set(
    findings.flatMap((f) => (f.kind === "no-fan" && f.groupId ? [f.groupId] : [])),
  );
  const groupsOf = snapshot.groups.filter((g) => !scope || scope.pricing.has(g.id));

  const fix: InboxItem[] = [];
  const set: InboxItem[] = [];
  const diagnostics: InboxItem[] = [];
  const names = (ids: readonly number[]) => [...new Set(ids.map(name))].join(", ");
  const namedFinding = (singular: string, ids: readonly number[]) => ({
    title: `${findingLabel(singular, ids.length)} at ${ids.map(name).join(" and ")}`,
    titleParts: [
      findingLabel(singular, ids.length) + " at ",
      ...ids.flatMap((id, i) => (i ? [" and ", { id }] : [{ id }])),
    ],
  });

  const heal = input.heal ?? null;
  // Heal rows lead Fix: what Pe can make real in Revit comes before what a person must.
  const blocking = new Set(
    findings.filter((f) => bin(f) === "blocking" && pricesSystem(f)).map((f) => f.id),
  );
  // A system offers a heal only when one of its items is the system's (2026-10-21: only what prices the
  // chosen system blocks it). A shared group is not membership, and its id changes with the read's scope.
  const healGroups = (heal?.groups ?? []).filter(
    (g) => !scope || g.items.some((i) => i.ids.some((id) => scope.members.has(id))),
  );
  const systemOf = new Map(
    [...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e.systemName ?? null]),
  );
  // The title names the systems of the ends it heals, never the group's: "Heal RA 37: 5 caps".
  const healed = (g: HealGroup) => {
    const names = [
      ...new Set(g.items.flatMap((i) => i.ids.flatMap((id) => systemOf.get(id)?.split(",") ?? []))),
    ]
      .map((n) => n.trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return names.length ? names.join(", ") : label(g.group);
  };
  for (const g of healGroups)
    fix.push(
      healRow(
        g,
        g.items.some((i) => i.covers.some((c) => blocking.has(c))),
        name,
        healed,
      ),
    );
  for (const f of healFindings(findings, heal)) {
    if (!inScope(f) || f.kind === "no-flow" || f.kind === "no-terminal-flow") continue;
    if (f.findingIds.some((id) => heal?.covered.has(id))) continue;
    const base = { key: f.id, findingIds: f.findingIds, ids: f.elementIds, note: f.note };
    // A Fix or Set row off the system's runs is another system's in a shared group: Diagnostics.
    const off = !pricesSystem(f);
    const offRow = ({ tone: _tone, ...item }: InboxItem): InboxItem => ({
      ...item,
      group: "diagnostics",
      status: `${item.status} · not on ${scope!.name}'s runs`,
    });
    const toFix = (item: InboxItem) => (off ? diagnostics : fix).push(off ? offRow(item) : item);
    const toSet = (item: InboxItem) => (off ? diagnostics : set).push(off ? offRow(item) : item);
    if (f.kind === "missed-join") {
      diagnostics.push({
        ...base,
        group: "diagnostics",
        kind: f.kind,
        ...namedFinding("Open end", f.elementIds),
        status: "possible missed join",
        verbs: [select(f.elementIds)],
      });
      continue;
    }
    if (f.grade && f.grade !== "anomalous") {
      // Bridged, so it prices; Revit still has no join here, and the note says whose repair it is.
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
      toSet({
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
    if (f.kind === "loop") {
      // A loop someone modelled is usually intended; it never holds the ESP, but the price is a tree's.
      diagnostics.push({
        ...base,
        group: "diagnostics",
        kind: f.kind,
        title: `Loop at ${names(f.elementIds) || f.id}`,
        status: "priced as a tree",
        note: "Priced as a tree cut where the walk reaches this joint a second time; the air is not split between the loop's two paths, so the paths through it may read high or low.",
        verbs: [select(f.elementIds)],
      });
      continue;
    }
    if (f.kind === "multi-fan") {
      // Several fans price per fan (ducts-domain `fan-sections.ts`); the split is named, never held.
      diagnostics.push({
        ...base,
        group: "diagnostics",
        kind: f.kind,
        title: `Several fans: ${names(f.elementIds)}`,
        status: "priced per fan",
        verbs: [
          ...f.elementIds.map(
            (id): RowVerb => ({
              kind: "role",
              id,
              role: "passive",
              label: `${name(id)} is passive`,
              says: `Rule ${name(id)} passive (it moves no design air); it then passes air through`,
            }),
          ),
          select(f.elementIds),
        ],
      });
      continue;
    }
    if (f.kind === "catalog-missing-table" || f.kind === "catalog-out-of-range") {
      // A terminal is priceable, never required: with no drop it prices as zero and holds nothing.
      diagnostics.push({
        ...base,
        group: "diagnostics",
        kind: f.kind,
        title: `Terminal not priced at ${names(f.elementIds)}`,
        status: "no drop",
        verbs: [
          ...(f.elementIds[0] == null
            ? []
            : [
                {
                  kind: "focus",
                  cell: { segment: "terminalDrops", id: f.elementIds[0] },
                  label: "state the drop",
                  says: "State this terminal's drop",
                } satisfies RowVerb,
              ]),
          select(f.elementIds),
        ],
      });
      continue;
    }
    if (f.kind === "no-rule") {
      const families = [
        ...new Set(
          f.elementIds.flatMap((id) => {
            const family = nodes.get(id)?.family;
            return family ? [family] : [];
          }),
        ),
      ];
      // No rule prices this fitting family. It surfaces the way a grille with no catalog drop does
      // (Diagnostics, priced as zero, a verb to state the drop; never holding the ESP back); the rules
      // pane also lists the family to price as an existing rule.
      diagnostics.push({
        ...base,
        group: "diagnostics",
        kind: f.kind,
        title: `No loss rule for ${names(f.elementIds)}`,
        status: "no drop",
        verbs: [
          ...families.map((family): RowVerb => ({ kind: "price-as", family })),
          ...(f.elementIds[0] == null
            ? []
            : [
                {
                  kind: "focus",
                  cell: { segment: "componentDrops", id: f.elementIds[0] },
                  label: "state the drop",
                  says: "State this fitting's drop, or price its family as a rule in the rules pane",
                } satisfies RowVerb,
              ]),
          select(f.elementIds),
        ],
      });
      continue;
    }
    if (bin(f) !== "blocking") continue;
    const item = { ...base, group: "fix" as const, kind: f.kind, tone: "alarm" as const };
    switch (f.kind) {
      case "no-fan": {
        const all = snapshot.groups.find((g) => g.id === f.groupId)?.rootIds ?? [];
        const roots = all.filter((id) => roleNow(id) === "passive");
        // One unit on the network: naming it the system's base equipment in Revit proposes it fan.
        // Scoped to a system, only that system is offered; the unit and its group come from the row.
        const based =
          all.length === 1
            ? fanCandidates(snapshot, all[0]!, f.groupId!).filter(
                (c) => !scope || c.system === scope.name,
              )
            : ([] as FanAssignment[]);
        toFix({
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
            ...based.flatMap((a) => fanVerbs(a, name)),
            select(f.elementIds),
          ],
        });
        break;
      }
      case "open-end": {
        const ruled = verdictOf(doc, f.id);
        const answered = ruled === "capped" || ruled === "ignore";
        const row = {
          ...item,
          ...namedFinding("Open end", f.elementIds),
          status: answered ? `ruled: ${ruled}` : "fix in Revit",
          verbs: [
            select(f.elementIds),
            ...(answered
              ? [
                  verdict(
                    doc,
                    f.id,
                    ruled,
                    "take back",
                    "Take the ruling back; the end comes up under Fix again",
                  ),
                ]
              : f.findingIds
                  .filter((id) => id.startsWith("open-end:"))
                  .map((id) =>
                    verdict(doc, id, "ignore", "ignore", "Ignore: leave this end out of the walk"),
                  )),
          ],
        };
        if (answered)
          diagnostics.push({
            ...row,
            group: "diagnostics",
            kind: "open-end-ruled",
            note: "A person ruled on this open end; the ruling lives in this route and writes nothing to Revit.",
          });
        else toFix(row);
        break;
      }
      case "loop-by-inference": {
        // The inferred join that closes the loop is the one the finding is named for.
        const join = `proximity:${f.id.slice("loop-by-inference:".length)}`;
        toFix({
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
      default: {
        const grade = f.grade === "anomalous";
        // An anomalous join is a person's repair in Revit (reversed connector, cross-class): no
        // verdict keeps it; breaking it is the one ruling, and the note says what to fix.
        toFix({
          ...item,
          title: grade
            ? `Anomalous join at ${names(f.elementIds)}`
            : (KIND_TITLE[f.kind] ?? f.kind),
          status: grade ? "fix in Revit" : "blocks the path",
          verbs: [
            select(f.elementIds),
            ...(grade
              ? [verdict(doc, f.id, "ignore", "break the join", "Ignore: withhold this join")]
              : []),
          ],
        });
      }
    }
  }

  // A join a person objected to is withheld, so its finding is gone. The objection is a person's
  // ruling, not a blocker: it sits in Diagnostics so it can be taken back, and never holds the ESP.
  for (const [key, cell] of Object.entries(doc?.assumptions ?? {})) {
    if (!key.startsWith("proximity:") || cell.edit?.value?.kind !== "verdict") continue;
    if (cell.edit.value.verdict !== "ignore") continue;
    const ids = proximityIds(key);
    if (scope && !ids.some((id) => scope.members.has(id))) continue;
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
        verdict(
          doc,
          key,
          "ignore",
          "withdraw",
          "Take the objection back; the join is bridged again",
        ),
        select(ids),
      ],
    });
  }

  const flowless: number[] = [];
  const othersFlowless: number[] = [];
  for (const n of snapshot.nodes) {
    if (n.kind !== "terminal" || !n.groupId || (scope && !inGroups.has(n.groupId))) continue;
    if (fanless.has(n.groupId) || flows.get(n.id)?.cfm != null) continue;
    if (scope && !scope.terminals.has(n.id)) {
      othersFlowless.push(n.id);
      continue;
    }
    flowless.push(n.id);
    set.push({
      key: `flows:${n.id}`,
      findingIds: findings
        .filter(
          (f) =>
            (f.kind === "no-flow" || f.kind === "no-terminal-flow") && f.elementIds.includes(n.id),
        )
        .map((f) => f.id),
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
  // The airflow source is the critical step: while a terminal has no flow, the first Set row asks
  // which parameter holds them, with each candidate's coverage, before any one terminal's row.
  if (flowless.length && input.airflow) {
    const { current, options } = input.airflow;
    const at = options.find((o) => o.slot === current);
    set.unshift({
      key: "airflow",
      group: "set",
      kind: "airflow",
      title: `Airflow from ${slotWord(current)}`,
      status: `${at?.have ?? 0} of ${at?.of ?? flowless.length} terminals read`,
      tone: "caution",
      ids: flowless,
      note: `${flowless.length} terminal${flowless.length === 1 ? "" : "s"} read no airflow from ${slotWord(current)}. Pick the parameter this project keeps design airflow in; each choice says how many terminals hold a value.`,
      verbs: [{ kind: "airflow", current, options }, select(flowless)],
    });
  }
  // Another system's grilles in a shared group: named, never held.
  if (othersFlowless.length)
    diagnostics.push({
      key: "flows:other-systems",
      group: "diagnostics",
      kind: "terminal-flow",
      title: `${plural(othersFlowless.length, "grille")} of the shared systems with no flow`,
      status: `not on ${scope!.name}'s runs`,
      ids: othersFlowless,
      note: "These terminals belong to another system in a group this one shares; pick that system to set them.",
      verbs: [select(othersFlowless)],
    });
  const units = new Set<number>();
  const unitFlowless: number[] = [];
  const firstUnitRow = set.length;
  for (const g of groupsOf) {
    if (fanless.has(g.id)) continue;
    for (const id of g.rootIds) {
      if (scope && !scope.units.has(id)) continue;
      if (units.has(id) || nodes.get(id)?.kind !== "equipment" || roleNow(id) === "passive")
        continue;
      units.add(id);
      if (equipmentFlows.get(id)?.cfm != null) continue;
      unitFlowless.push(id);
      set.push({
        key: `equipmentFlows:${id}`,
        group: "set",
        kind: "unit-flow",
        title: name(id),
        status: "no design flow",
        ids: [id],
        note: "Revit holds no fan flow for this unit and none is edit; apply writes the edit one.",
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

  // The unit airflow source leads the unit rows the way the terminal one leads the grilles': a
  // unit's flow proposes its role (`unit-roles.ts`), so which parameter holds it comes first.
  if (unitFlowless.length && input.unitAirflow) {
    const { current, options } = input.unitAirflow;
    const at = options.find((o) => o.slot === current);
    set.splice(firstUnitRow, 0, {
      key: "unit-airflow",
      group: "set",
      kind: "unit-airflow",
      title: `Unit airflow from ${slotWord(current)}`,
      status: `${at?.have ?? 0} of ${at?.of ?? unitFlowless.length} units read`,
      tone: "caution",
      ids: unitFlowless,
      note: `${unitFlowless.length} unit${unitFlowless.length === 1 ? "" : "s"} read no design flow from ${slotWord(current)}. Pick the parameter this project keeps unit airflow in; a unit with a flow is proposed a fan, one without beside it passive.`,
      verbs: [{ kind: "airflow", of: "unit", current, options }, select(unitFlowless)],
    });
  }

  return { fix, set, diagnostics };
}

const KIND_TITLE: Record<string, string> = {
  loop: "Loop in the system",
  "loop-by-inference": "Loop through an inferred join",
  "implausible-loss": "Implausible fitting loss, not priced",
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

function checks(input: TriageInput & { claims: readonly Claim[] }): InboxItem[] {
  const { scope, findings, doc, claims } = input;
  const name = (id: number) => subjectName("unnamed element", input.nameOf?.(id));
  const items: InboxItem[] = claims
    .filter((claim) => !claim.verdict)
    .map((claim) => ({
      key: `claim:${claim.id}`,
      group: "check",
      kind: "claim",
      title: claim.title,
      status: claim.state,
      tone: "pea",
      ids: claim.at,
      note: claim.text,
      verbs: [{ kind: "claim", claim }, select(claim.at)],
    }));
  const awaiting = (
    cells: Record<string, { suggestion?: { value?: unknown }; edit?: unknown }> | undefined,
  ) => Object.entries(cells ?? {}).filter(([, cell]) => cell.suggestion && !cell.edit);
  const segments = doc as unknown as Record<
    string,
    Record<string, { suggestion?: { value?: unknown }; edit?: unknown }> | undefined
  > | null;
  const suggestion = (segment: string, key: string, title: string, value: unknown, ids: number[]) =>
    items.push({
      key: `${segment}:${key}`,
      group: "check",
      kind: "suggestion",
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
          move: "take",
          label: "accept",
          says: "Stage Pea's suggestion",
        },
        {
          kind: "stage",
          segment,
          key,
          move: "unsuggest",
          label: "reject",
          says: "Clear Pea's suggestion",
        },
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
      if (scope && !scope.members.has(id)) continue;
      suggestion(segment, key, `${ELEMENT_WORD[segment]} · ${name(id)}`, cell.suggestion!.value, [
        id,
      ]);
    }
  for (const [key, cell] of awaiting(segments?.rules)) {
    const rule = ruleByKey(key);
    suggestion(
      "rules",
      key,
      rule ? `Rule · ${rule.family} : ${rule.type}` : `Rule · ${key}`,
      cell.suggestion!.value,
      [],
    );
  }
  for (const [key, cell] of awaiting(segments?.catalogs))
    suggestion("catalogs", key, `Catalog link · ${key}`, cell.suggestion!.value, []);
  const shown = new Set(findings.map((f) => f.id));
  for (const [key, cell] of awaiting(segments?.assumptions)) {
    if (!shown.has(key)) continue;
    const f = findings.find((x) => x.id === key)!;
    suggestion("assumptions", key, `Ruling · ${f.note.slice(0, 60)}`, cell.suggestion!.value, [
      ...f.elementIds,
    ]);
  }
  return items;
}

export interface WriteState {
  edit: number;
  esp: number;
}

/** Only ESP waits for a clean calc; rulings, slots and flows can write any time. */
export function espWaits(left: { fix: number; set: number }): string | null {
  if (!left.fix && !left.set) return null;
  const parts = [left.fix ? `${left.fix} to fix` : "", left.set ? `${left.set} to set` : ""];
  return `${parts.filter(Boolean).join(" and ")} before the ESP writes`;
}

export interface WriteRow {
  title: string;
  status: string;
  held: string | null;
}

function writeRow(left: { fix: number; set: number }, write: WriteState): WriteRow {
  const waits = write.esp ? espWaits(left) : null;
  return {
    title: "Write to Revit",
    status: `${write.edit ? `${write.edit} edit` : "nothing edit"}${waits ? " · ESP held" : ""}`,
    held: waits ? `${plural(write.esp, "edit ESP")} left out of this write: ${waits}` : null,
  };
}

export const holding = (fix: readonly InboxItem[]) => fix.filter((i) => i.blocks !== false).length;

export const inboxDamage = (row: InboxItem): string | null =>
  (row.group === "fix" && row.blocks !== false) || row.group === "set"
    ? compactStatus(row.status) || "blocked"
    : null;

export interface StageIssue {
  key: string;
  ids: readonly number[];
  findings: readonly string[];
  damage: string | null;
  priority?: number;
}

/** The inbox owns identity and severity; the stage only chooses how to draw it. */
export function stageIssues(
  rows: Pick<ReturnType<typeof inboxRows>, "fix" | "set" | "check" | "diagnostics">,
): StageIssue[] {
  return [...rows.fix, ...rows.set, ...rows.check, ...rows.diagnostics].map((row) => ({
    key: row.key,
    ids: row.ids,
    findings: row.findingIds ?? [row.key],
    damage: inboxDamage(row),
    priority: Number(row.key === "airflow" || row.key === "unit-airflow"),
  }));
}

/** Prefer an element's own input over a system-wide parameter picker on the same mesh. */
export function issueAt(
  issues: readonly StageIssue[],
  ids: readonly number[],
  preferred?: string | null,
) {
  const candidates = issues.filter((issue) => issue.ids.some((id) => ids.includes(id)));
  return (
    candidates.find((issue) => issue.key === preferred) ??
    candidates.sort(
      (a, b) =>
        Number(!!b.damage) - Number(!!a.damage) ||
        a.ids.length - b.ids.length ||
        Number(a.key === "airflow" || a.key === "unit-airflow") -
          Number(b.key === "airflow" || b.key === "unit-airflow"),
    )[0]
  );
}

export const diagnosticKind = (item: InboxItem) => (item.kind === "join" ? item.status : item.kind);

export function annotatedFindings(
  rows: { fix: readonly InboxItem[]; diagnostics: readonly InboxItem[] },
  heal: Pick<HealPlan, "groups"> | null,
  kind: string,
): ReadonlySet<string> {
  if (kind)
    return new Set(rows.diagnostics.filter((r) => diagnosticKind(r) === kind).map((r) => r.key));
  const covers = new Map(
    (heal?.groups ?? []).map((g) => [`heal:${g.group}`, g.items.flatMap((i) => i.covers)]),
  );
  return new Set(rows.fix.flatMap((r) => covers.get(r.key) ?? [r.key]));
}

export function inboxRows(input: TriageInput & { claims: readonly Claim[]; write: WriteState }) {
  const { fix, set, diagnostics } = triage(input);
  return {
    fix,
    set,
    check: checks(input),
    write: writeRow({ fix: holding(fix), set: set.length }, input.write),
    diagnostics,
  };
}

const FOCUS_SEGMENTS = new Set([
  "assumptions",
  "rules",
  "catalogs",
  "terminalDrops",
  "componentDrops",
  "flows",
  "esp",
  "equipmentFlows",
  "roles",
  "parameters",
  "calculation",
]);

export const cellFocus = (segment: string, key: string) => `${segment}:${key}`;

export function focusRow(issue: string, rowKeys: ReadonlySet<string>): string | null {
  if (!issue) return null;
  if (rowKeys.has(issue)) return issue;
  const at = issue.indexOf(":");
  if (at < 0 || !FOCUS_SEGMENTS.has(issue.slice(0, at))) return null;
  const rest = issue.slice(at + 1);
  return rowKeys.has(rest) ? rest : "write";
}
