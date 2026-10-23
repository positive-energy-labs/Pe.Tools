/**
 * The /ducts inbox in loop order, derived and never stored (modelled on `rooms/cards.ts`):
 * - Fix: one Heal row per group first: the caps and joins `ducts.heal` makes real in Revit
 *   (ducts-domain `heal.ts`), with preview and apply; the open ends and joins it covers make no row
 *   of their own. Then what blocks a path to the fan (`bins.ts` `blocking`): no duct path to a
 *   fan, anomalous joins, open ends a person must fix in Revit (the note says why), loops, no or
 *   several roots. A Heal row blocks Write only when it covers a blocking finding.
 * - Set: an input a person owes: first, while any terminal has no flow, which parameter the airflow
 *   is read from (`airflow.ts`); then a terminal with no flow, a fan with no design flow, flex left
 *   on the rigid roughness. Each Set row deep-links to the cell on the tree row that holds it.
 * - Check: Pea's claims for this group awaiting a verdict, and Pea's proposals awaiting staging.
 * - Write: one row, armed only while Fix and Set are empty and the preview is fresh.
 * - Diagnostics: bridged joins (near miss, stretched); final, collapsed, and the only rows that may
 *   stand without a verb a person owes. "Object" stages the proximity `ignore` verdict, which
 *   withholds the join; the objection is a ruling, so it stays here with its take-back, and only
 *   what the break causes (an open end, a lost path) comes up under Fix.
 * A row exists only with a way to act on it: a verb, a deep link or select in Revit.
 *
 * The scope is a Revit system (`system-scope.ts`): rows come from every group the system is in, but
 * only what prices the system (its runs, its own elements, its units) is Fix or Set. The rest of a
 * shared group is another system's: its rows stand in Diagnostics and never hold the ESP.
 */
import type { DuctFinding, DuctsRouteDocument } from "@pe/agent-contracts";
import { bin } from "@pe/ducts-domain/bins";
import { fanCandidates, type FanAssignment } from "@pe/ducts-domain/fan-assignment";
import type { HealGroup, HealItem, HealPlan } from "@pe/ducts-domain/heal";
import { ruleByKey } from "@pe/ducts-domain/loss-rules";
import type { SystemScope } from "@pe/ducts-domain/system-scope";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { slotWord, type AirflowOf, type AirflowOption } from "./airflow";
import type { Claim } from "./legs";
import type { DuctsFanRun, DuctsHealRun, DuctsPage } from "./manifest";

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

/** One preview's result as the popover shows it: the button's armed word, the counts, the items. */
export interface PreviewState {
  word: string;
  summary: string;
  lines: readonly PreviewLine[];
}
export interface PreviewLine {
  key: string;
  text: string;
  /** Planned or refused, when the preview ruled on this item; null when it did not. */
  state: "planned" | "refused" | null;
  reason: string | null;
}

/** The reason a held preview no longer holds. */
export const STALE_WORDS = "changed since preview";

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
  /**
   * A verb that previews before it does (kit `PreviewAction`): one button, its preview held in
   * `held` while it still describes the snapshot, `stale` naming why a held one no longer does.
   * `on` is what the route's preview and apply handles run with; `outcome` is the last apply in
   * words (a fan's), drawn beside the Inputs button.
   */
  | {
      kind: "preview";
      on: { verb: "heal"; group: string } | { verb: "fan"; unitId: number; systemId: number };
      label: string;
      says: string;
      held: PreviewState | null;
      stale: string | null;
      commit: { label: string; says: string; refusal: string | null };
      outcome: string | null;
    }
  /** Select the element on the drawing and focus the cell that holds the input. */
  | { kind: "focus"; cell: CellRef; label: string; says: string }
  | { kind: "claim"; claim: Claim }
  /** Choose the parameter every terminal's (or unit's) airflow is read from: one press per candidate. */
  | { kind: "airflow"; of?: AirflowOf; current: string; options: readonly AirflowOption[] }
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
  /** Findings represented by this row, including those folded into a Heal row. */
  findingIds?: readonly string[];
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
  /** False on a Fix row that stands in no path (a Heal row covering only bridged joins, a heal result): it does not hold the ESP. */
  blocks?: false;
}

/** The last heal run as the inbox shows it, mapped onto the current snapshot's group. */
export interface HealRunView {
  group: string;
  mode: "preview" | "apply";
  /** The preview still describes this snapshot: apply arms only then. */
  fresh: boolean;
  planned: number;
  healed: number;
  refused: number;
  /** Item key to the op's reason, for each refused item. */
  refusals: ReadonlyMap<string, string>;
  /** Item keys the preview passed: what apply sends. */
  passed: readonly string[];
  /** The elements the run made or touched, for select in Revit. */
  ids: readonly number[];
  /** Pe's ESP (largest path total) of the group before and after the apply, in-wg. */
  esp: { before: number | null; after: number | null } | null;
}

export interface TriageInput {
  snapshot: Pick<DuctSnapshot, "groups" | "nodes" | "segments"> &
    Partial<Pick<DuctSnapshot, "systems">>;
  /** The chosen system (`systemScope`); null is the whole document. */
  scope: SystemScope | null;
  findings: readonly DuctFinding[];
  flows: ReadonlyMap<number, { cfm: number | null }>;
  equipmentFlows: ReadonlyMap<number, { cfm: number | null }>;
  doc: DuctsRouteDocument | null;
  nameOf?: (id: number) => string;
  groupLabel?: (id: string) => string;
  /** What heals in Revit (ducts-domain `healPlan` over the raw snapshot); absent, nothing heals. */
  heal?: HealPlan | null;
  healRun?: HealRunView | null;
  /** The airflow read slot and its candidates in this scope (`airflowOptions`). */
  airflow?: { current: string; options: readonly AirflowOption[] };
  /** The unit airflow read slot (FanFlow) and its candidates in this scope. */
  unitAirflow?: { current: string; options: readonly AirflowOption[] };
  /** Every root unit's role with why: ruled, staged, proposed from its flow, or the default (survey). */
  roles?: ReadonlyMap<number, { role: "fan" | "passive"; why: string; reason: string }>;
  /** The last make-the-fan run and the page epoch it is fresh against. */
  fan?: { run: DuctsFanRun | null; epoch: number };
}

/**
 * The verb that makes a unit a system's fan in Revit: one preview button (rolled back), whose commit
 * is armed by a passing preview of this pair over this snapshot. Shared by the no-fan row and the
 * Inputs pane.
 */
export function fanVerbs(
  a: FanAssignment,
  name: (id: number) => string,
  fan: { run: DuctsFanRun | null; epoch: number } | undefined,
): Extract<RowVerb, { kind: "preview" }>[] {
  const run = fan?.run;
  const mine = run?.unitId === a.unitId && run.systemId === a.systemId ? run : null;
  const words = `make ${name(a.unitId)} the fan of ${a.system}`;
  const previewed = mine?.mode === "preview" ? mine : null;
  const fresh = previewed !== null && previewed.epoch === (fan?.epoch ?? 0);
  return [
    {
      kind: "preview",
      on: { verb: "fan", ...a },
      label: `preview: ${words}`,
      says: `Preview in Revit, rolled back: ${words} (its base equipment, Duct Systems > Select Equipment)`,
      held:
        previewed && fresh
          ? {
              word: `${words} · previewed`,
              summary: fanWords(previewed.response),
              lines: [],
            }
          : null,
      stale: previewed && !fresh ? STALE_WORDS : null,
      commit: {
        label: words,
        says: `${words[0]!.toUpperCase()}${words.slice(1)} in Revit; the system keeps its id, name and type`,
        refusal: fanRefusal(
          { fan: run ?? null, epoch: fan?.epoch ?? 0 },
          { unitId: a.unitId, systemId: a.systemId },
        ),
      },
      outcome: mine?.mode === "apply" ? `applied: ${fanWords(mine.response)}` : null,
    },
  ];
}

/**
 * The page's last heal run over the snapshot now. After an apply Revit has renumbered what it
 * rebuilt and the group id may be new: the group is found again by a root the run measured from,
 * else by an element it held; the ESP after is that group's (`espNow`).
 */
export function healRunView(
  run: DuctsHealRun,
  snapshot: Pick<DuctSnapshot, "groups" | "nodes" | "segments">,
  epoch: number,
  espNow: (group: string) => number | null,
): HealRunView {
  const holder = new Map(
    [...snapshot.nodes, ...snapshot.segments].map((e) => [e.id, e.groupId ?? null]),
  );
  // A unit sits in every group its ports reach (supply and return sides), so a root names the
  // group only when the run's own id is gone and every root it measured from is there.
  const group =
    run.mode === "preview" || snapshot.groups.some((g) => g.id === run.group)
      ? run.group
      : (snapshot.groups.find((g) => run.before.roots.every((r) => g.rootIds.includes(r)))?.id ??
        run.before.ids.map((id) => holder.get(id)).find((g): g is string => g != null) ??
        run.group);
  const items = run.response.groups.flatMap((g) => g.items);
  return {
    group,
    mode: run.mode,
    fresh: run.epoch === epoch,
    planned: run.response.counts.planned,
    healed: run.response.counts.healed,
    refused: run.response.counts.refused,
    refusals: new Map(
      items.filter((i) => i.outcome === "refused").map((i) => [i.key, i.reason ?? "refused"]),
    ),
    passed: items.filter((i) => i.outcome === "planned").map((i) => i.key),
    ids: run.mode === "apply" ? [...new Set(items.flatMap((i) => i.created))] : [],
    esp: run.mode === "apply" ? { before: run.before.esp, after: espNow(group) } : null,
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const inWg = (v: number | null) => (v == null ? "no path" : v.toFixed(3));

/** A heal run's standing in words: what the preview passed, or what the apply healed and its ESP. */
function healRunWords(run: HealRunView) {
  if (run.mode === "preview")
    return `previewed: ${run.planned} pass · ${run.refused} refused${run.fresh ? "" : " · out of date"}`;
  const esp = run.esp ? ` · ESP ${inWg(run.esp.before)} → ${inWg(run.esp.after)} in-wg` : "";
  return `healed ${run.healed}${run.refused ? ` · ${run.refused} refused` : ""}${esp}`;
}

const HEAL_NOTE =
  "Preview runs each repair and Pe's own check in Revit and rolls it all back; heal commits the group in one transaction, and an item that fails the check is refused and rolled back.";

/** One group's Heal row: its caps and joins, preview and heal, and the last run's standing. */
function healRow(
  g: HealGroup,
  run: HealRunView | null,
  blocks: boolean,
  name: (id: number) => string,
  label: (id: string) => string,
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
  const refused = run ? g.items.filter((i) => run.refusals.has(i.key)) : [];
  const apply =
    !run || run.mode !== "preview"
      ? "Preview the heal first"
      : !run.fresh
        ? "The snapshot changed since the preview; preview again"
        : !run.passed.length
          ? "Nothing passed the preview"
          : null;
  return {
    key: `heal:${g.group}`,
    findingIds: g.items.flatMap((item) => item.covers),
    group: "fix",
    kind: "heal",
    title: `Heal ${label(g.group)}: ${counts}`,
    status: run ? healRunWords(run) : "not previewed",
    ...(blocks ? { tone: "alarm" as const } : { blocks: false as const }),
    ids: [...new Set([...g.items.flatMap((i) => i.ids), ...(run?.ids ?? [])])],
    note: [
      `${g.items.map(line).join("; ")}.`,
      ...refused.map((i) => `Refused ${line(i)}: ${run!.refusals.get(i.key)}.`),
      HEAL_NOTE,
    ].join(" "),
    verbs: [
      {
        kind: "preview",
        on: { verb: "heal", group: g.group },
        label: "preview heal",
        says: `Preview healing ${counts} in Revit, rolled back`,
        held:
          run?.mode === "preview" && run.fresh
            ? {
                word: `heal · previewed ${run.passed.length}`,
                summary: `${run.passed.length} pass · ${run.refused} refused`,
                lines: g.items.map((i) => ({
                  key: i.key,
                  text: line(i),
                  state: run.refusals.has(i.key)
                    ? ("refused" as const)
                    : run.passed.includes(i.key)
                      ? ("planned" as const)
                      : null,
                  reason: run.refusals.get(i.key) ?? null,
                })),
              }
            : null,
        stale: run?.mode === "preview" && !run.fresh ? STALE_WORDS : null,
        commit: {
          label: "apply heal",
          says: "Heal the items the preview passed, in one transaction",
          refusal: apply,
        },
        outcome: null,
      },
      select(g.items.flatMap((i) => i.ids)),
    ],
  };
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
const proximityIds = (key: string) =>
  key
    .slice("proximity:".length)
    .split("|")
    .map((part) => Number(part.split(":")[0]))
    .filter((id) => Number.isInteger(id));

/** Fix, Set, Check and Diagnostics, each in its own order. */
export function triage(input: TriageInput) {
  const { snapshot, scope, findings, flows, equipmentFlows, doc } = input;
  // The role a unit plays now: the survey's (ruled, staged, else proposed), else Work's staged one.
  const roleNow = (id: number) => input.roles?.get(id)?.role ?? roleOf(doc, id);
  const ruled = (id: number) => ["ruled", "staged"].includes(input.roles?.get(id)?.why ?? "");
  const name = input.nameOf ?? String;
  const label = input.groupLabel ?? ((id: string) => id);
  const nodes = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const inGroups = new Set(scope?.groups ?? []);
  const owner = new Map(
    snapshot.groups.flatMap((g) =>
      inGroups.has(g.id) ? g.issueIds.map((i) => [i, g.id] as const) : [],
    ),
  );
  /** Shown: the finding sits in a group the system is in. */
  const inScope = (f: DuctFinding) =>
    !scope ||
    (f.groupId != null
      ? inGroups.has(f.groupId)
      : owner.has(f.id) || f.elementIds.some((id) => scope.members.has(id)));
  /** Blocks: the finding stands on a run that prices the system (else another system's, in Diagnostics). */
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

  const heal = input.heal ?? null;
  const run = input.healRun ?? null;
  // Heal rows lead Fix: what Pe can make real in Revit comes before what a person must.
  const blocking = new Set(
    findings.filter((f) => bin(f) === "blocking" && pricesSystem(f)).map((f) => f.id),
  );
  // The plan numbers the raw snapshot's groups; a survey that merged them still finds them by member.
  const healGroups = (heal?.groups ?? []).filter(
    (g) =>
      !scope ||
      inGroups.has(g.group) ||
      g.items.some((i) => i.ids.some((id) => scope.members.has(id))),
  );
  for (const g of healGroups)
    fix.push(
      healRow(
        g,
        run?.group === g.group ? run : null,
        g.items.some((i) => i.covers.some((c) => blocking.has(c))),
        name,
        label,
      ),
    );
  // An apply that healed its whole group leaves no Heal row to carry its result, so it keeps its own.
  if (
    run?.mode === "apply" &&
    (!scope || inGroups.has(run.group)) &&
    !healGroups.some((g) => g.group === run.group)
  )
    fix.push({
      key: `heal:${run.group}`,
      group: "fix",
      kind: "heal",
      title: `Healed ${label(run.group)}`,
      status: healRunWords(run),
      blocks: false,
      ids: run.ids,
      note: [...run.refusals].map(([key, why]) => `Refused ${key}: ${why}.`).join(" ") || null,
      verbs: [select(run.ids)],
    });
  /** A person's repair: what heal cannot do and why, then where to do it. */
  const inRevit = (f: DuctFinding) =>
    heal?.hard.get(f.id) ?? "Fix it in Revit; its own tools enforce the rules its API does not.";

  for (const f of findings) {
    if (!inScope(f) || f.kind === "no-flow" || f.kind === "no-terminal-flow") continue;
    if (heal?.covered.has(f.id)) continue;
    const base = { key: f.id, findingIds: [f.id], ids: f.elementIds, note: f.note };
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
        title: `Open ends ${f.gapIn?.toFixed(1) ?? "?"}″ apart: ${f.elementIds.join(" ↔ ")}`,
        status: "possible missed join",
        verbs: [select(f.elementIds)],
      });
      continue;
    }
    if (f.grade && f.grade !== "anomalous") {
      // Bridged, so it prices; Revit still has no join here, and the note says whose repair it is.
      diagnostics.push({
        ...base,
        note: heal?.hard.has(f.id) ? `${f.note}. ${heal.hard.get(f.id)}` : f.note,
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
            ...based.flatMap((a) => fanVerbs(a, name, input.fan)),
            select(f.elementIds),
          ],
        });
        break;
      }
      case "open-end": {
        // A person's ruling answers the end: it leaves Fix for Diagnostics, where it can be taken back.
        const ruled = verdictOf(doc, f.id);
        if (ruled === "capped" || ruled === "ignore") {
          diagnostics.push({
            key: f.id,
            group: "diagnostics",
            kind: "open-end-ruled",
            title: `Open end at ${names(f.elementIds) || f.id}`,
            status: `ruled: ${ruled}`,
            ids: f.elementIds,
            note: "A person ruled on this open end; the ruling lives in this route and writes nothing to Revit.",
            verbs: [
              verdict(
                doc,
                f.id,
                ruled,
                "take back",
                "Take the ruling back; the end comes up under Fix again",
              ),
              select(f.elementIds),
            ],
          });
          break;
        }
        // Caps and small joins heal in the Heal row; an end left here is a person's, in Revit.
        toFix({
          ...item,
          title: `Open end at ${names(f.elementIds) || f.id}`,
          status: "fix in Revit",
          note: inRevit(f),
          verbs: [
            select(f.elementIds),
            verdict(doc, f.id, "ignore", "ignore", "Ignore: leave this end out of the walk"),
          ],
        });
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
      case "multi-root": {
        // Two or more fans after the proposal: a person confirms each fan (the group then prices
        // per fan) or rules the inline gear passive.
        const active = f.elementIds.filter((id) => roleNow(id) !== "passive");
        const why = f.elementIds
          .map(
            (id) =>
              `${name(id)}: ${roleNow(id) ?? "fan"}, ${input.roles?.get(id)?.reason ?? "staged"}`,
          )
          .join("; ");
        toFix({
          ...item,
          title: `Several fans: ${names(active)}`,
          status: "blocks the path",
          note: `${why}. Confirm each fan to price the group per fan, or rule a unit passive.`,
          verbs: [
            ...active
              .filter((id) => !ruled(id))
              .map(
                (id): RowVerb => ({
                  kind: "role",
                  id,
                  role: "fan",
                  label: `${name(id)} is a fan`,
                  says: `Rule ${name(id)} a fan; once every fan is ruled the group prices per fan`,
                }),
              ),
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
        // An anomalous join is a person's repair in Revit (reversed connector, cross-class): no
        // verdict keeps it; breaking it is the one ruling, and the note says what to fix.
        toFix({
          ...item,
          title: grade
            ? `Anomalous join at ${names(f.elementIds)}`
            : (KIND_TITLE[f.kind] ?? f.kind),
          status: grade ? "fix in Revit" : "blocks the path",
          ...(grade ? { note: `${f.note} ${heal?.hard.get(f.id) ?? ""}`.trim() } : {}),
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
    if (!key.startsWith("proximity:") || cell.staged?.value?.kind !== "verdict") continue;
    if (cell.staged.value.verdict !== "ignore") continue;
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
  "no-root": "No root",
  "multi-root": "Several roots",
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

/** Pea's claims awaiting a verdict, then its proposals awaiting staging. */
function checks(input: TriageInput & { claims: readonly Claim[] }): InboxItem[] {
  const { scope, findings, doc, claims } = input;
  const name = input.nameOf ?? String;
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
  const awaiting = (
    cells: Record<string, { proposal?: { value?: unknown }; staged?: unknown }> | undefined,
  ) => Object.entries(cells ?? {}).filter(([, cell]) => cell.proposal && !cell.staged);
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
        {
          kind: "stage",
          segment,
          key,
          move: "deny",
          label: "reject",
          says: "Clear Pea's proposal",
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

/** What the Write row needs from the page: pending changes, and the last preview's standing. */
export interface WriteState {
  /** Staged cells and pending rulings: a ruling is a write to the model's store. */
  staged: number;
  hasPreview: boolean;
  fresh: boolean;
  planned: number | null;
  refused: number | null;
  /** Staged ESP cells: the one write that waits for a clean calc. */
  esp: number;
}

/**
 * Why the ESP number waits while Fix or Set rows remain (the calc it comes from is not clean);
 * null when none remain. Rulings, slots and flows write any time (kaitpw, 2026-10-21).
 */
export function espWaits(left: { fix: number; set: number }): string | null {
  if (!left.fix && !left.set) return null;
  const parts = [left.fix ? `${left.fix} to fix` : "", left.set ? `${left.set} to set` : ""];
  return `${parts.filter(Boolean).join(" and ")} before the ESP writes`;
}

export interface WriteRow {
  title: string;
  status: string;
  /** The staged ESP this write leaves out, and why; null when none is staged or nothing holds it. Apply's own refusal is the action's. */
  held: string | null;
}

function writeRow(left: { fix: number; set: number }, write: WriteState): WriteRow {
  const waits = write.esp ? espWaits(left) : null;
  return {
    title: write.fresh && write.planned ? `Write ${write.planned} to Revit` : "Write to Revit",
    status: `${
      !write.staged
        ? "nothing staged"
        : !write.hasPreview
          ? "not previewed"
          : !write.fresh
            ? "preview out of date"
            : `${write.planned ?? 0} planned · ${write.refused ?? 0} refused`
    }${waits ? " · ESP held" : ""}`,
    held: waits ? `${plural(write.esp, "staged ESP")} left out of this write: ${waits}` : null,
  };
}

/** The Fix rows that hold the ESP back: every one but a Heal row standing in no path. */
export const holding = (fix: readonly InboxItem[]) => fix.filter((i) => i.blocks !== false).length;

export interface StageIssue {
  key: string;
  ids: readonly number[];
  findings: readonly string[];
  blocking: boolean;
}

/** The inbox owns identity and severity; the stage only chooses how to draw it. */
export function stageIssues(
  rows: Pick<ReturnType<typeof triage>, "fix" | "set" | "diagnostics">,
): StageIssue[] {
  return [...rows.fix, ...rows.set, ...rows.diagnostics].map((row) => ({
    key: row.key,
    ids: row.ids,
    findings: row.findingIds ?? [row.key],
    blocking: (row.group === "fix" && row.blocks !== false) || row.group === "set",
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
        Number(b.blocking) - Number(a.blocking) ||
        a.ids.length - b.ids.length ||
        Number(a.key === "airflow" || a.key === "unit-airflow") -
          Number(b.key === "airflow" || b.key === "unit-airflow"),
    )[0]
  );
}

/** A Diagnostics row's kind in the key: a bridged join by its grade (its status), any other row by its kind. */
export const diagnosticKind = (item: InboxItem) => (item.kind === "join" ? item.status : item.kind);

/**
 * The finding ids the picture annotates: with no kind picked, the Fix rows' (a Heal row stands for
 * the findings it covers); with one, the Diagnostics rows of that kind.
 */
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

/** The whole inbox: its groups in `INBOX_ORDER`, and the Write row. */
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

/** A fan run's answer in words: the refusal, else the read back. */
export const fanWords = (response: DuctsFanRun["response"]) =>
  response.outcome === "refused"
    ? `refused: ${response.reason ?? "refused"}`
    : (response.check ?? response.outcome);

/** Why the fan apply is not armed for this pair, or null when a fresh preview of it passed. */
export const fanRefusal = (
  page: Pick<DuctsPage, "fan" | "epoch">,
  pair: { unitId: number; systemId: number } | undefined,
) => {
  if (!pair) return null;
  const run = page.fan;
  if (run?.mode !== "preview" || run.unitId !== pair.unitId || run.systemId !== pair.systemId)
    return "Preview it first";
  if (run.epoch !== page.epoch) return "The snapshot changed since the preview; preview again";
  return run.response.outcome === "planned"
    ? null
    : `The preview refused: ${run.response.reason ?? "refused"}`;
};

/** The Work segments a chat review can name; a `focus` page value is `<segment>:<cell key>`. */
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

/** The `issue` page value that lands on a Work cell's own place in the inbox. */
export const cellFocus = (segment: string, key: string) => `${segment}:${key}`;

/**
 * The inbox row the page's `issue` names: a row by its own key (a Fix row's issue id, a proposal
 * row's `<segment>:<key>`); a staged cell with no row of its own (a rule, a slot, a flow) lands on
 * the Write row, which is where staged cells are counted; a cell whose row is its issue id lands on
 * that row. Null when `issue` names nothing in the inbox.
 */
export function focusRow(issue: string, rowKeys: ReadonlySet<string>): string | null {
  if (!issue) return null;
  if (rowKeys.has(issue)) return issue;
  const at = issue.indexOf(":");
  if (at < 0 || !FOCUS_SEGMENTS.has(issue.slice(0, at))) return null;
  const rest = issue.slice(at + 1);
  return rowKeys.has(rest) ? rest : "write";
}
