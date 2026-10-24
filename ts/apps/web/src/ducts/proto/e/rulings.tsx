/** Picture findings share domain identity and numbering with the inbox. */
import { useMemo } from "react";

import { healPlan, healFindings } from "@pe/ducts-domain/heal";
import { INFERRED_KINDS } from "@pe/ducts-domain/proximity";
import { survey } from "@pe/ducts-domain/survey";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Button } from "@pe/kit/lang/button";

import type { Label, Ruling } from "../../annotations";
import { VERDICTS } from "../../claims";
import { FindingsList, ISSUE_KINDS } from "../../issues";
import type { Claim } from "../../legs";
import type { Scene } from "../../scene";
import type { ProtoProps } from "../props";
import { fmtFt } from "./bar";
import { SubjectText } from "@pe/kit/lang/subject-text";

/** Cumulative effective length from the fan to each element, in equivalent feet, along priced paths. */
function cumulativeOf(priced: ProtoProps["priced"]): Map<number, number> {
  const out = new Map<number, number>();
  if (!priced) return out;
  for (const path of Object.values(priced.next.paths)) {
    let run = 0;
    for (const row of path.rows) {
      run += row.eqFt ?? 0;
      if (!out.has(row.id) || out.get(row.id)! < run) out.set(row.id, run);
    }
  }
  return out;
}

/** The rulings and labels over `scene`, numbered in reading order. */
export function useMarks({
  snapshot,
  priced,
  scene,
  claims,
  work,
  issueScope,
  annotated,
  pointOf,
}: {
  snapshot: DuctSnapshot;
  priced: ProtoProps["priced"];
  scene: Scene;
  claims: readonly Claim[];
  work: ProtoProps["work"];
  issueScope: ReadonlySet<string> | null;
  annotated: ReadonlySet<string>;
  pointOf: (id: number) => readonly number[] | null;
}) {
  const cumulative = useMemo(() => cumulativeOf(priced), [priced]);
  const sub = scene.subject ?? null;
  const drawn = useMemo(
    () =>
      new Set([...scene.segments.map((f) => f.segment.id), ...scene.nodes.map((f) => f.node.id)]),
    [scene],
  );

  const rulings = useMemo<Ruling[]>(() => {
    const out: (Ruling extends infer R ? (R extends Ruling ? Omit<R, "n"> : never) : never)[] = [];
    for (const claim of claims)
      if (claim.at[0] != null) out.push({ kind: "claim", at: claim.at[0], claim });
    const findings = healFindings(
      priced?.findings ?? survey(snapshot, work.doc).findings,
      healPlan(snapshot, work.doc),
    ).filter(
      (f) =>
        (INFERRED_KINDS.has(f.kind) || f.findingIds.length > 1) &&
        f.findingIds.some((id) => annotated.has(id)) &&
        f.elementIds.some((id) => drawn.has(id)),
    );
    for (const finding of findings)
      out.push({ kind: "inferred", at: finding.elementIds.find((id) => drawn.has(id))!, finding });
    for (const issue of snapshot.issues)
      if (
        !findings.some((f) => f.findingIds.includes(issue.id)) &&
        issue.elementId != null &&
        drawn.has(issue.elementId) &&
        annotated.has(issue.id) &&
        (!issueScope || issueScope.has(issue.id))
      )
        out.push({ kind: "issue", at: issue.elementId, issue });
    return out.flatMap((r, i) =>
      (r.kind === "inferred" ? r.finding.elementIds.filter((id) => drawn.has(id)) : [r.at]).map(
        (at) => ({ ...r, at, n: i + 1 }) as Ruling,
      ),
    );
  }, [claims, priced, snapshot, work.doc, drawn, issueScope, annotated]);

  // A subject's legs carry their totals; a group scene has none, so each terminal carries its path's.
  const labels = useMemo<Label[]>(
    () =>
      sub
        ? sub.cut.legs.flatMap((leg) => {
            const middle = leg.ids[Math.floor(leg.ids.length / 2)];
            const at = middle == null ? null : pointOf(middle);
            if (!at) return [];
            const end = [...leg.ids, leg.to.id].reverse().find((id) => cumulative.has(id));
            const text =
              end == null ? `${leg.name} · unpriced` : `Σ ${fmtFt(cumulative.get(end))} eq ft`;
            return [
              { key: `${leg.name}|${leg.ids[0]}`, at, text, ids: leg.ids, priced: end != null },
            ];
          })
        : scene.nodes.flatMap((f) => {
            if (f.node.kind !== "terminal") return [];
            const total = priced?.next.paths[f.node.id]?.tel;
            return [
              {
                key: String(f.node.id),
                ids: [f.node.id],
                at: f.node.point,
                text: total == null ? "unpriced" : `Σ ${fmtFt(total)} eq ft`,
                priced: total != null,
              },
            ];
          }),
    [sub, scene, priced, cumulative], // eslint-disable-line react-hooks/exhaustive-deps -- `pointOf` reads `snapshot`
  );

  return { rulings, labels, cumulative };
}

export function RulingBody({
  r,
  onVerdict,
}: {
  r: Ruling;
  onVerdict?: (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => void;
}) {
  if (r.kind === "claim")
    return (
      <div className="flex flex-col gap-2" data-ruling={r.n}>
        <p>
          <span className="face-mono">{r.n}</span> {r.claim.title} · {r.claim.state}
        </p>
        <p>
          <SubjectText text={r.claim.text} revit={r.claim.at} />
        </p>
        <span className="flex gap-1" role="group" aria-label="verdict">
          {VERDICTS.map((v) => (
            <Button
              key={v.value}
              type="button"
              kind="framed"
              label={v.word}
              reason={v.says}
              pressed={r.claim.verdict === v.value}
              data-verdict={v.value}
              onClick={() => onVerdict?.(r.claim, v.value)}
            >
              {v.word}
            </Button>
          ))}
        </span>
      </div>
    );
  if (r.kind === "inferred")
    return (
      <div className="flex flex-col gap-2" data-ruling={r.n}>
        <p>
          <span className="face-mono">{r.n}</span>{" "}
          {r.finding.kind === "open-end" ? "open ends, fix in Revit" : "inferred join, bridged"}
        </p>
        <FindingsList findings={[r.finding]} />
      </div>
    );
  const info = ISSUE_KINDS[r.issue.kind];
  return (
    <div className="flex flex-col gap-2" data-ruling={r.n}>
      <p>
        <span className="face-mono">{r.n}</span> snapshot issue ·{" "}
        <span data-tone={info.color.tone}>{info.label}</span>
      </p>
      <p>
        <SubjectText
          text={r.issue.note}
          revit={r.issue.elementId == null ? [] : [r.issue.elementId]}
        />
      </p>
      <p className="text-ink-2">{info.what} No verdict verb exists for a snapshot issue.</p>
    </div>
  );
}
