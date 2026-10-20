/**
 * THROWAWAY (protoui round 1, variant B): the inbox of everything a person rules on, one list
 * grouped by kind: inferred joins (graded), snapshot issues, Pea's claims, staged rule changes.
 * Rows name their elements; hover lights, click selects.
 */
import { useState } from "react";
import {
  stagedDucts,
  transitionPatches,
  type DuctFinding,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { INFERRED_KINDS } from "@pe/ducts-domain/proximity";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Button } from "@pe/kit/lang/button";
import { Row, RowGroupHead } from "@pe/kit/lang/row";

import { AssumptionCell } from "../../assumptions";
import { claimParts, VERDICTS, type Verdict } from "../../claims";
import { ISSUE_KINDS } from "../../issues";
import type { Claim } from "../../legs";

type Work = {
  doc: DuctsRouteDocument | null;
  write: (patch: RouteStatePatch[]) => Promise<unknown>;
};

const GRADE_TONE = { anomalous: "alarm", stretched: "caution", "near-miss": undefined } as const;

export function Rulings({
  snapshot,
  group,
  scope,
  findings,
  claims,
  work,
  nameOf,
  selected,
  onHover,
  onSelect,
  onSelectClaim,
  onVerdict,
}: {
  snapshot: DuctSnapshot;
  /** The chosen group id; "" = the whole document. */
  group: string;
  /** The chosen group's element ids; null = no scoping. */
  scope: ReadonlySet<number> | null;
  findings: readonly DuctFinding[];
  claims: readonly Claim[];
  work: Work;
  nameOf: (id: number) => string;
  selected: string;
  onHover: (id: number | null) => void;
  onSelect: (id: number | null) => void;
  onSelectClaim: (claim: Claim) => void;
  onVerdict: ((claim: Claim, verdict: Verdict) => void) | null;
}) {
  const [wide, setWide] = useState(false);
  const scoped = scope != null && !wide;
  const inScope = (ids: readonly number[]) => !scoped || ids.some((id) => scope.has(id));
  const allInferred = findings.filter(
    (f) => INFERRED_KINDS.has(f.kind) || f.kind === "loop-by-inference",
  );
  const inferred = allInferred.filter((f) => inScope(f.elementIds));
  const allIssues = snapshot.issues;
  const issues = allIssues.filter((i) =>
    !scoped ? true : i.groupId === group || (i.elementId != null && scope.has(i.elementId)),
  );
  const claimsShown = claims.filter((c) => inScope(c.at));
  const staged = stagedDucts(work.doc);
  const allChanges = [
    ...Object.entries(staged.rules).map(([key, value]) => ({
      key: `rule:${key}`,
      label: `${key} → ${JSON.stringify(value)}`,
      ids: [] as number[],
    })),
    ...Object.entries(staged.componentDrops).map(([id, value]) => ({
      key: `drop:${id}`,
      label: `stated drop ${JSON.stringify(value)}`,
      ids: [Number(id)],
    })),
    ...Object.entries(staged.terminalDrops).map(([id, value]) => ({
      key: `terminal:${id}`,
      label: `terminal drop ${JSON.stringify(value)}`,
      ids: [Number(id)],
    })),
  ];
  // Rules carry no element; they stay. A drop or terminal change is scoped by its element.
  const ruleChanges = allChanges.filter((c) => c.ids.length === 0 || inScope(c.ids));
  const names = (ids: readonly number[]) => [...new Set(ids.map(nameOf))].join(", ");
  const confirmed = (id: string) => {
    const v = work.doc?.assumptions[id]?.staged?.value;
    return v?.kind === "verdict" && v.verdict === "connect";
  };
  const confirm = (id: string, on: boolean) =>
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
  const hoverFirst = (ids: readonly number[]) => () => onHover(ids[0] ?? null);
  return (
    <div className="flex flex-col" onMouseLeave={() => onHover(null)} aria-label="rulings">
      <RowGroupHead label="inferred joins" count={inferred.length} />
      {inferred.length === 0 ? (
        <p className="text-ink-2 t-small px-2">no inferred join in this snapshot</p>
      ) : null}
      {inferred.map((f) => (
        <Row
          key={f.id}
          data-key={f.id}
          lines={2}
          label={names(f.elementIds)}
          aside={
            f.grade ? (
              <span data-tone={confirmed(f.id) ? undefined : GRADE_TONE[f.grade]}>
                {confirmed(f.id) ? `${f.grade}, confirmed` : f.grade}
              </span>
            ) : (
              f.kind
            )
          }
          sub={f.note}
          onMouseEnter={hoverFirst(f.elementIds)}
          onClick={() => onSelect(f.elementIds[0] ?? null)}
          actions={
            f.grade ? (
              <Button
                label={confirmed(f.id) ? "take the confirmation back" : "confirm this join"}
                pressed={confirmed(f.id)}
                onClick={() => confirm(f.id, !confirmed(f.id))}
              >
                {confirmed(f.id) ? "confirmed" : "confirm"}
              </Button>
            ) : null
          }
          meta={f.grade ? (confirmed(f.id) ? "confirmed" : "rule") : null}
        />
      ))}
      <RowGroupHead label="issues" count={issues.length} />
      {issues.length === 0 ? (
        <p className="text-ink-2 t-small px-2">the snapshot raises no issue</p>
      ) : null}
      {issues.map((issue) => (
        <Row
          key={issue.id}
          data-key={issue.id}
          lines={2}
          selected={selected === String(issue.elementId)}
          label={issue.elementId == null ? "no element" : nameOf(issue.elementId)}
          aside={<span data-tone={ISSUE_KINDS[issue.kind].color.tone}>{ISSUE_KINDS[issue.kind].label}</span>}
          sub={
            <span className="flex items-center gap-2">
              <span className="truncate">{issue.note}</span>
              <span onClick={(e) => e.stopPropagation()}>
                <AssumptionCell issue={issue} work={work} />
              </span>
            </span>
          }
          onMouseEnter={() => onHover(issue.elementId ?? null)}
          onClick={() => onSelect(issue.elementId ?? null)}
        />
      ))}
      <RowGroupHead label="Pea claims" count={claimsShown.length} />
      {claimsShown.length === 0 ? (
        <p className="text-ink-2 t-small px-2">no claim on this subject</p>
      ) : null}
      {claimsShown.map((claim, i) => (
        <Row
          key={claim.id}
          data-key={claim.id}
          lines={2}
          selected={selected === claim.id}
          label={
            <span>
              {i + 1}.{" "}
              {claimParts(claim.text, nameOf).map((p, j) =>
                typeof p === "string" ? <span key={j}>{p}</span> : <b key={j} className="font-normal underline decoration-dotted">{p.name}</b>,
              )}
            </span>
          }
          sub={
            <span className="flex items-center gap-1">
              <span className="text-ink-2 truncate">
                {claim.state} · at {names(claim.at)}
              </span>
              <span onClick={(e) => e.stopPropagation()} className="flex gap-1">
                {VERDICTS.map((v) => (
                  <Button
                    key={v.value}
                    kind="framed"
                    label={v.word}
                    reason={v.says}
                    pressed={claim.verdict === v.value}
                    refusal={onVerdict ? null : "no subject: the verdict has nowhere to stage"}
                    onClick={() => onVerdict?.(claim, v.value)}
                  >
                    {v.word}
                  </Button>
                ))}
              </span>
            </span>
          }
          onMouseEnter={hoverFirst(claim.at)}
          onClick={() => onSelectClaim(claim)}
        />
      ))}
      <RowGroupHead label="staged rule changes" count={ruleChanges.length} />
      {ruleChanges.length === 0 ? (
        <p className="text-ink-2 t-small px-2">nothing staged: no rule, drop or terminal change</p>
      ) : null}
      {ruleChanges.map((change) => (
        <Row
          key={change.key}
          data-key={change.key}
          label={change.ids.length ? names(change.ids) : change.label}
          aside={change.ids.length ? change.label : undefined}
          onMouseEnter={hoverFirst(change.ids)}
          onClick={() => onSelect(change.ids[0] ?? null)}
        />
      ))}
      {scope ? (
        <button
          type="button"
          className="text-ink-2 t-small cursor-pointer px-2 py-2 text-left"
          onClick={() => setWide(!wide)}
        >
          {wide
            ? "showing the whole document · scope to this system"
            : `${
                allInferred.length - inferred.length +
                (allIssues.length - issues.length) +
                (claims.length - claimsShown.length) +
                (allChanges.length - ruleChanges.length)
              } more document-wide · show`}
        </button>
      ) : null}
    </div>
  );
}
