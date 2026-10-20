/**
 * THROWAWAY (protoui round 2, E1/E2): the inbox. A row exists only when a person has a verb on it:
 * answer a claim, confirm an inferred join, enter an override (no fan static, no terminal flow), or
 * dismiss (the issue kinds canon gives a verdict). "Select in Revit" rides every row but never
 * makes one. Issues with no verb stay pins on the drawing. Issues are scoped by the group's
 * `issueIds`, never by element membership (round 1's B counted 38 where the group holds 18).
 */
import {
  ductOverrideKey,
  transitionPatches,
  type DuctFinding,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import type { IssueKind } from "@pe/ducts-domain/issues";
import { INFERRED_KINDS } from "@pe/ducts-domain/proximity";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Button } from "@pe/kit/lang/button";
import { cellFromTrichotomy, StateCell } from "@pe/kit/lang/cell";
import { reviewTransitions, type CellWire } from "#/components/work/band";

import { AssumptionCell } from "../../assumptions";
import { claimParts, ShowInRevit, VERDICTS, type Verdict } from "../../claims";
import { ISSUE_KINDS } from "../../issues";
import type { Claim } from "../../legs";

type Issue = DuctSnapshot["issues"][number];
export type InboxWork = {
  doc: DuctsRouteDocument | null;
  revision: number | null;
  write: (patch: RouteStatePatch[]) => Promise<unknown>;
};
type RevitDoc = { session: string; openId: string };

/** The issue kinds with a verb: an override to enter, or a canon verdict to dismiss with. */
const OVERRIDE: Partial<Record<IssueKind, "fan-static" | "flow">> = {
  "no-fan-static": "fan-static",
  "no-terminal-flow": "flow",
};
/** Mirrors the keys of CHOICES in assumptions.tsx (unexported there): the kinds a verdict answers. */
const DISMISS = new Set<IssueKind>(["open-end", "no-terminal-flow", "default-flex-roughness"]);
export const hasVerb = (issue: Issue) => issue.kind in OVERRIDE || DISMISS.has(issue.kind);

export type InboxRow =
  | { kind: "claim"; key: string; ids: readonly number[]; claim: Claim }
  | { kind: "join"; key: string; ids: readonly number[]; finding: DuctFinding }
  | { kind: "issue"; key: string; ids: readonly number[]; issue: Issue };

export function inboxRows({
  snapshot,
  group,
  scope,
  findings,
  claims,
}: {
  snapshot: DuctSnapshot;
  group: string;
  scope: ReadonlySet<number> | null;
  findings: readonly DuctFinding[];
  claims: readonly Claim[];
}): InboxRow[] {
  const inScope = (ids: readonly number[]) => !scope || ids.some((id) => scope.has(id));
  const owned = group
    ? new Set(snapshot.groups.find((g) => g.id === group)?.issueIds ?? [])
    : null;
  return [
    ...claims
      .filter((c) => inScope(c.at))
      .map((claim): InboxRow => ({ kind: "claim", key: claim.id, ids: claim.at, claim })),
    ...findings
      .filter((f) => INFERRED_KINDS.has(f.kind) && f.grade && inScope(f.elementIds))
      .map(
        (finding): InboxRow => ({ kind: "join", key: finding.id, ids: finding.elementIds, finding }),
      ),
    ...snapshot.issues
      .filter((i) => (!owned || owned.has(i.id)) && hasVerb(i))
      .map(
        (issue): InboxRow => ({
          kind: "issue",
          key: issue.id,
          ids: issue.elementId == null ? [] : [issue.elementId],
          issue,
        }),
      ),
  ];
}

/** The override for a no-fan-static or no-terminal-flow issue: empty until a person types one. */
function OverrideCell({ issue, work }: { issue: Issue; work: InboxWork }) {
  const what = OVERRIDE[issue.kind]!;
  const id = issue.elementId;
  if (id == null) return <span className="text-ink-mute">no element to hold an override</span>;
  const segment = what === "flow" ? "flows" : "assumptions";
  const key = what === "flow" ? String(id) : ductOverrideKey("fan-static", id);
  const cell = (what === "flow" ? work.doc?.flows[key] : work.doc?.assumptions[key]) ?? {};
  const authored = (cell.staged ?? cell.proposal)?.value as
    | { kind?: string; inWg?: number; cfm?: number }
    | undefined;
  const shown = what === "flow" ? authored?.cfm : authored?.inWg;
  const wire: CellWire = {
    segment,
    revision: work.revision,
    write: work.write as CellWire["write"],
  };
  return (
    <span className="inline-flex items-baseline gap-1" data-e-override={issue.id}>
      <StateCell
        {...cellFromTrichotomy(cell, { value: shown == null ? "" : String(shown), cap: "editable" })}
        scale="row"
        numeric={{ min: 0, digits: what === "flow" ? 0 : 4 }}
        placeholder={what === "flow" ? "design cfm" : "fan static"}
        onCommit={(text: string) =>
          (wire.write(
            transitionPatches([segment], key, cell, {
              kind: "stage",
              rung: {
                value:
                  what === "flow" ? { cfm: Number(text) } : { kind: "fan-static", inWg: Number(text) },
              },
            }),
          ) as Promise<{ message?: string } | undefined>).then((refused) => refused?.message)
        }
        transitions={reviewTransitions(wire, key, cell)}
      />
      <span className="text-ink-2 t-small whitespace-nowrap">{what === "flow" ? "cfm" : "in-wg"}</span>
    </span>
  );
}

const confirmed = (doc: DuctsRouteDocument | null, id: string) => {
  const v = doc?.assumptions[id]?.staged?.value;
  return v?.kind === "verdict" && v.verdict === "connect";
};

function RevitVerb({ doc, ids, what }: { doc: RevitDoc | null; ids: readonly number[]; what: string }) {
  if (!ids.length) return null;
  return doc ? (
    <ShowInRevit doc={doc} elementIds={ids} what={what} />
  ) : (
    <Button kind="framed" label={`select ${what} in Revit`} refusal="no Revit document is connected">
      select in Revit
    </Button>
  );
}

const GRADE_TONE = { anomalous: "alarm", stretched: "caution", "near-miss": undefined } as const;

export function Inbox({
  rows,
  work,
  doc,
  nameOf,
  onVerdict,
  light,
  onSelect,
}: {
  rows: readonly InboxRow[];
  work: InboxWork;
  doc: RevitDoc | null;
  nameOf: (id: number) => string;
  onVerdict: ((claim: Claim, verdict: Verdict) => void) | null;
  light: (ids: readonly number[] | null) => void;
  onSelect: (id: number | null) => void;
}) {
  const names = (ids: readonly number[]) => [...new Set(ids.map(nameOf))].join(", ");
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <ol className="flex flex-col" aria-label="inbox" onMouseLeave={() => light(null)}>
      {rows.map((row) => (
        <li
          key={row.key}
          data-e-inbox={row.kind}
          className="border-line flex cursor-pointer flex-col gap-1 border-b px-2 py-1.5 hover:bg-(--pe-recess)"
          onMouseEnter={() => light(row.ids)}
          onClick={() => onSelect(row.ids[0] ?? null)}
        >
          {row.kind === "claim" ? (
            <>
              <span className="t-small text-ink-2">Pea claim · {row.claim.state}</span>
              <span>
                {claimParts(row.claim.text, nameOf).map((p, j) =>
                  typeof p === "string" ? (
                    <span key={j}>{p}</span>
                  ) : (
                    <span key={j} className="underline decoration-dotted">
                      {p.name}
                    </span>
                  ),
                )}
              </span>
              <span className="flex flex-wrap gap-1" onClick={stop}>
                {VERDICTS.map((v) => (
                  <Button
                    key={v.value}
                    kind="framed"
                    label={v.word}
                    reason={v.says}
                    pressed={row.claim.verdict === v.value}
                    refusal={onVerdict ? null : "no subject: the verdict has nowhere to stage"}
                    onClick={() => onVerdict?.(row.claim, v.value)}
                  >
                    {v.word}
                  </Button>
                ))}
                <RevitVerb doc={doc} ids={row.ids} what="its elements" />
              </span>
            </>
          ) : row.kind === "join" ? (
            <>
              <span className="t-small text-ink-2">
                inferred join ·{" "}
                <span data-tone={row.finding.grade ? GRADE_TONE[row.finding.grade] : undefined}>
                  {row.finding.grade}
                </span>
              </span>
              <span>{names(row.ids)}</span>
              <span className="t-small text-ink-2">{row.finding.note}</span>
              <span className="flex flex-wrap gap-1" onClick={stop}>
                <Button
                  kind="framed"
                  label={
                    confirmed(work.doc, row.key) ? "take the confirmation back" : "confirm this join"
                  }
                  pressed={confirmed(work.doc, row.key)}
                  onClick={() =>
                    void work.write(
                      transitionPatches(
                        ["assumptions"],
                        row.key,
                        work.doc?.assumptions[row.key] ?? {},
                        confirmed(work.doc, row.key)
                          ? { kind: "unstage" }
                          : {
                              kind: "stage",
                              rung: { value: { kind: "verdict", verdict: "connect" } },
                            },
                      ),
                    )
                  }
                >
                  {confirmed(work.doc, row.key) ? "confirmed" : "confirm"}
                </Button>
                <RevitVerb doc={doc} ids={row.ids} what="the join" />
              </span>
            </>
          ) : (
            <>
              <span className="t-small">
                <span data-tone={ISSUE_KINDS[row.issue.kind].color.tone}>
                  {ISSUE_KINDS[row.issue.kind].label}
                </span>
                <span className="text-ink-2"> · {row.ids.length ? names(row.ids) : "no element"}</span>
              </span>
              <span className="t-small text-ink-2">{row.issue.note}</span>
              <span className="flex flex-wrap items-center gap-1" onClick={stop}>
                {row.issue.kind in OVERRIDE ? <OverrideCell issue={row.issue} work={work} /> : null}
                {DISMISS.has(row.issue.kind) ? (
                  <AssumptionCell issue={row.issue} work={work} />
                ) : null}
                <RevitVerb doc={doc} ids={row.ids} what="it" />
              </span>
            </>
          )}
        </li>
      ))}
    </ol>
  );
}
