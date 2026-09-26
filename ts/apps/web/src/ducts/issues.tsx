/**
 * The one duct-issue taxonomy: every view, the tables, the legend and Chat read it from here.
 * C# emits only the kind (`DuctIssueKind`); what it means, what it blocks and how it is coloured
 * live here. Readiness derives from `blocks`. Colour is one tone per `blocks` class (house law:
 * meaning rides `data-tone`); `shade` orders the kinds inside a class. Shades have no tokens yet
 * (owed in the design-system ledger), so a view draws `tone` and may use `shade` only as order.
 */
import type { DuctsSnapshot } from "@pe/host-contracts/generated";

import type { VerdictTone } from "#/components/master-table/model";

export type IssueKind = DuctsSnapshot.Res.DuctIssueKind;
export type Blocks = "walkable" | "budgetable" | "none";

export interface IssueKindInfo {
  /** One to three words. */
  label: string;
  /** One sentence. */
  what: string;
  blocks: Blocks;
  color: { tone: VerdictTone; shade: number };
}

const TONE: Record<Blocks, VerdictTone> = {
  walkable: "alarm",
  budgetable: "caution",
  none: "mute",
};
const kind = (label: string, what: string, blocks: Blocks, shade: number): IssueKindInfo => ({
  label,
  what,
  blocks,
  color: { tone: TONE[blocks], shade },
});

export const ISSUE_KINDS: Record<IssueKind, IssueKindInfo> = {
  "open-end": kind(
    "open end",
    "A connector with nothing attached; caps are not open ends.",
    "walkable",
    1,
  ),
  loop: kind(
    "loop",
    "The network closes on itself, so flow direction is ambiguous.",
    "walkable",
    2,
  ),
  "no-root": kind("no root", "No equipment port feeds the network.", "walkable", 3),
  "multi-root": kind(
    "many roots",
    "More than one equipment port feeds the network.",
    "walkable",
    4,
  ),
  "no-terminal-flow": kind("terminal no flow", "A terminal states no design flow.", "walkable", 5),
  "no-fan-static": kind(
    "no fan static",
    "The root equipment states no external static pressure.",
    "budgetable",
    1,
  ),
  "no-component-drop": kind(
    "no component drop",
    "An accessory in the path states no pressure drop.",
    "budgetable",
    2,
  ),
  "default-flex-roughness": kind(
    "default flex roughness",
    "Flex carries the rigid galvanized roughness Revit ships.",
    "budgetable",
    3,
  ),
  stub: kind("stub", "A duct under 3 in long, a connector stub between fittings.", "none", 1),
  "implausible-size": kind("odd size", "A size or aspect ratio no real duct has.", "none", 2),
  "mixed-classification": kind(
    "mixed systems",
    "The network carries more than one system classification.",
    "none",
    3,
  ),
  "high-velocity": kind(
    "high velocity",
    "Revit reports 2000 fpm or more on the segment.",
    "none",
    4,
  ),
};

/** Solver diagnostics stay separate from captured model issues and never change snapshot readiness. */
export const PRESSURE_ISSUE_KINDS: Record<string, IssueKindInfo> = {
  "missing-connector": kind(
    "missing connector",
    "A referenced connector is absent.",
    "walkable",
    1,
  ),
  "self-loop": kind("self loop", "A part connects to itself.", "walkable", 2),
  "no-unique-root-path": kind(
    "no unique root",
    "No unique equipment path reaches this subtree.",
    "walkable",
    3,
  ),
  "multiple-root-ports": kind(
    "many root ports",
    "Flow cannot be assigned to one root port.",
    "walkable",
    4,
  ),
  "unknown-demand": kind(
    "unknown demand",
    "Only the known terminal demand is calculated.",
    "walkable",
    5,
  ),
  "cycle-boundary": kind("cycle boundary", "Demand through the cycle is unknown.", "walkable", 6),
  "unresolved-open-end": kind("unresolved end", "An open end has unknown demand.", "walkable", 7),
  "invalid-segment": kind(
    "invalid duct",
    "Dimensions or roughness prevent a friction calculation.",
    "walkable",
    8,
  ),
  "unknown-tap-position": kind(
    "unknown tap",
    "The tap cannot be placed along the duct.",
    "walkable",
    9,
  ),
  "invalid-fitting-size": kind(
    "invalid fitting",
    "The fitting reference area is missing.",
    "walkable",
    10,
  ),
  "no-terminal-path": kind(
    "no terminal path",
    "No terminal has a unique root path.",
    "walkable",
    11,
  ),
  "unknown-flex-compression": kind(
    "flex compression",
    "A compression multiplier is needed for the installation.",
    "budgetable",
    1,
  ),
  "unknown-component-drop": kind(
    "unknown component drop",
    "Rated external loss at design flow is absent.",
    "budgetable",
    2,
  ),
  "unknown-fan-static": kind(
    "unknown fan static",
    "Rated fan static at design flow is absent.",
    "budgetable",
    3,
  ),
  "mixed-classification": kind(
    "mixed circuit",
    "A mixed classification cannot define one fan circuit.",
    "budgetable",
    4,
  ),
  "incomplete-circuit": kind(
    "incomplete circuit",
    "Full TEL needs complete supply and return paths, or one exhaust group.",
    "budgetable",
    5,
  ),
  "noncircular-laminar": kind(
    "laminar approximation",
    "Hydraulic diameter approximates noncircular laminar friction.",
    "none",
    1,
  ),
  "transitional-flow": kind(
    "transition approximation",
    "Friction interpolates through the unstable transition region.",
    "none",
    2,
  ),
  "unmatched-fitting": kind(
    "assumed fitting loss",
    "One velocity head is assumed; it is not a rated coefficient or an upper bound.",
    "none",
    3,
  ),
};

/** The table's issue column: the kind's word in its class's tone. */
export const issueVerdict = (issueKind: IssueKind) => {
  const info = ISSUE_KINDS[issueKind];
  return { word: info.label, tone: info.color.tone, note: info.what };
};

const BLOCKS_WORD: Record<Blocks, string> = {
  walkable: "blocks walking",
  budgetable: "blocks the budget",
  none: "advisory",
};

/** The legend every view shows beside its issues: class, then kinds in shade order. */
export function IssueLegend() {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3">
      {(Object.keys(BLOCKS_WORD) as Blocks[]).map((blocks) => (
        <div key={blocks} className="contents">
          <dt data-tone={TONE[blocks]}>{BLOCKS_WORD[blocks]}</dt>
          <dd>
            {(Object.entries(ISSUE_KINDS) as [IssueKind, IssueKindInfo][])
              .filter(([, info]) => info.blocks === blocks)
              .sort(([, a], [, b]) => a.color.shade - b.color.shade)
              .map(([key, info]) => (
                <span key={key} title={info.what} data-tone={info.color.tone}>
                  {info.label}{" "}
                </span>
              ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
