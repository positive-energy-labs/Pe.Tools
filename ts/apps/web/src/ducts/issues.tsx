import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * The one duct-issue taxonomy: every view, the tables, the legend and Chat read it from here.
 * C# emits only the kind (`DuctIssueKind`); what it means, what it blocks and how it is coloured
 * live here. Blocking semantics come from the shared ducts domain. Colour is one tone per `blocks` class (house law:
 * meaning rides `data-tone`); `shade` orders the kinds inside a class. Shades have no tokens yet
 * (owed in the design-system ledger), so a view draws `tone` and may use `shade` only as order.
 */
import {
  transitionPatches,
  type DuctFinding,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { ISSUE_BLOCKS, type Blocks, type IssueKind } from "@pe/ducts-domain/issues";
import { INFERRED_KINDS } from "@pe/ducts-domain/proximity";
import type { VerdictTone } from "@pe/kit/table/model";
export interface IssueKindInfo {
  /** One to three words. */
  label: string;
  /** One sentence. */
  what: string;
  blocks: Blocks;
  color: {
    tone: VerdictTone;
    shade: number;
  };
}
const TONE: Record<Blocks, VerdictTone> = {
  walkable: "alarm",
  budgetable: "caution",
  none: "mute",
};
const kind = (key: IssueKind, label: string, what: string, shade: number): IssueKindInfo => ({
  label,
  what,
  blocks: ISSUE_BLOCKS[key],
  color: { tone: TONE[ISSUE_BLOCKS[key]], shade },
});
export const ISSUE_KINDS: Record<IssueKind, IssueKindInfo> = {
  "open-end": kind(
    "open-end",
    "open end",
    "A connector with nothing attached; caps are not open ends.",
    1,
  ),
  loop: kind("loop", "loop", "The network closes on itself, so flow direction is ambiguous.", 2),
  "no-root": kind("no-root", "no root", "No equipment port feeds the network.", 3),
  "multi-root": kind(
    "multi-root",
    "many roots",
    "More than one equipment port feeds the network.",
    4,
  ),
  "no-terminal-flow": kind(
    "no-terminal-flow",
    "terminal no flow",
    "A terminal states no design flow.",
    5,
  ),
  "no-fan-static": kind(
    "no-fan-static",
    "no fan static",
    "The root equipment states no external static pressure.",
    1,
  ),
  "no-component-drop": kind(
    "no-component-drop",
    "no component drop",
    "An accessory in the path states no pressure drop.",
    2,
  ),
  "default-flex-roughness": kind(
    "default-flex-roughness",
    "default flex roughness",
    "Flex carries the rigid galvanized roughness Revit ships.",
    3,
  ),
  "no-flow-leg": kind(
    "no-flow-leg",
    "no-flow leg",
    "A tee or tap leg carries no flow; every table prices it 0, so the leg is not on the budget.",
    4,
  ),
  stub: kind("stub", "stub", "A duct under 3 in long, a connector stub between fittings.", 1),
  "implausible-size": kind(
    "implausible-size",
    "odd size",
    "A size or aspect ratio no real duct has.",
    2,
  ),
  "mixed-classification": kind(
    "mixed-classification",
    "mixed systems",
    "The network carries more than one system classification.",
    3,
  ),
  "high-velocity": kind(
    "high-velocity",
    "high velocity",
    "Revit reports 2000 fpm or more on the segment.",
    4,
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
/**
 * Who clears a finding, with proximity inferences their own warning tier first: a join the model
 * implies is never taken as correct (kaitpw 2026-10-19), so a person rules on each.
 */
const TIERS: { key: string; label: string; holds: (f: DuctFinding) => boolean }[] = [
  {
    key: "inferred",
    label: "person rules · inferred",
    holds: (f) => INFERRED_KINDS.has(f.kind) || f.kind === "loop-by-inference",
  },
  ...(["person", "pea", "route"] as const).map((clearer) => ({
    key: clearer,
    label: `${clearer} clears`,
    holds: (f: DuctFinding) => f.clearer === clearer,
  })),
];
const tierOf = (f: DuctFinding) => TIERS.find((t) => t.holds(f))!.key;
const RANK = { anomalous: 0, stretched: 1, "near-miss": 2 } as const;
const GRADE_TONE = { anomalous: "alarm", stretched: "caution", "near-miss": undefined } as const;
const verdictOf = (doc: DuctsRouteDocument | null, id: string, rung: "staged" | "proposal") => {
  const value = doc?.assumptions[id]?.[rung]?.value;
  return value?.kind === "verdict" ? value.verdict : null;
};
/**
 * The survey's findings, grouped by who clears them; what the route assumed is spelled out. An
 * inferred join shows its grade, worst first, and with Work a person's confirm: a staged `connect`
 * that makes the results resting on it final (Pea's proposal shows, and never confirms).
 */
export function FindingsList({
  findings,
  work,
}: {
  findings: readonly DuctFinding[];
  work?: {
    doc: DuctsRouteDocument | null;
    write: (patch: RouteStatePatch[]) => Promise<unknown>;
  };
}) {
  if (!findings.length) return null;
  const confirm = (id: string, on: boolean) =>
    work &&
    void work.write(
      transitionPatches(
        ["assumptions"],
        id,
        work.doc?.assumptions[id] ?? {},
        on
          ? { kind: "stage", rung: { value: { kind: "verdict", verdict: "connect" } } }
          : { kind: "unstage" },
      ),
    );
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 t-small" data-findings="">
      {TIERS.filter((t) => findings.some((f) => tierOf(f) === t.key)).map((tier) => (
        <div key={tier.key} className="contents" data-tier={tier.key}>
          <dt
            className={tier.key === "inferred" ? "t-upper" : "t-upper text-ink-2"}
            data-tone={tier.key === "inferred" ? "caution" : undefined}
          >
            {tier.label}
          </dt>
          <dd>
            {findings
              .filter((f) => tierOf(f) === tier.key)
              .sort((a, b) => (a.grade ? RANK[a.grade] : 3) - (b.grade ? RANK[b.grade] : 3))
              .map((f) => {
                const staged = verdictOf(work?.doc ?? null, f.id, "staged");
                const proposed = verdictOf(work?.doc ?? null, f.id, "proposal");
                return (
                  <div key={f.id} data-finding={f.id}>
                    <span data-tone={f.assumed || tier.key === "inferred" ? "caution" : "alarm"}>
                      {f.kind}
                    </span>{" "}
                    {f.grade ? (
                      <span
                        data-grade={f.grade}
                        data-tone={staged === "connect" ? undefined : GRADE_TONE[f.grade]}
                        className={staged === "connect" ? "text-ink-2" : undefined}
                      >
                        {staged === "connect" ? `${f.grade}, confirmed` : f.grade}
                      </span>
                    ) : null}{" "}
                    <span className="face-mono">{f.elementIds.join(" ")}</span> {f.note}
                    {f.assumed ? (
                      <span className="text-ink-2"> · assumed: {f.assumed}</span>
                    ) : null}
                    {f.grade && work ? (
                      <>
                        {" "}
                        <Button
                          data-confirm={f.id}
                          aria-pressed={staged === "connect"}
                          label={
                            staged === "connect"
                              ? "Take the confirmation back; results resting on this join turn provisional again"
                              : "Confirm this join: results resting on it stop being provisional"
                          }
                          onClick={() => confirm(f.id, staged !== "connect")}
                        >
                          {staged === "connect" ? "confirmed" : "confirm"}
                        </Button>
                        {proposed && proposed !== staged ? (
                          <TooltipHint content="Pea proposed this; it confirms nothing until a person stages it">
                            <span data-tone="pea"> Pea: {proposed}</span>
                          </TooltipHint>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                );
              })}
          </dd>
        </div>
      ))}
    </dl>
  );
}
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
                <TooltipHint key={key} content={info.what}>
                  <span data-tone={info.color.tone}>{info.label} </span>
                </TooltipHint>
              ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
