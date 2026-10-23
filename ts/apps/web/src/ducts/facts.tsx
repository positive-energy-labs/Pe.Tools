import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * What the drawings say about one element on hover or selection: its size, length and flows, each
 * value beside where it came from. A missing value is printed as missing, never left blank.
 */
import { ISSUE_KINDS } from "./issues";
import { SubjectText } from "./subject-text-view";
import type { DuctNode, Issue, Segment } from "./encoding";
const num = (value: number | null | undefined, unit: string, digits = 0) =>
  value == null ? null : `${value.toFixed(digits)} ${unit}`;

/** Precision belongs to the measured unit, not the binary float's string representation. */
export const factNumber = (value: number, unit: string) =>
  `${value.toFixed(({ cfm: 0, fpm: 0, deg: 1, in: 2, ft: 2, "in-wg": 4 } as Record<string, number>)[unit] ?? 3)} ${unit}`.trim();
type Row = [label: string, value: string | null, source: string];
function Rows({ rows }: { rows: readonly Row[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3">
      {rows.map(([label, value, source]) => (
        <div key={`${label}:${source}`} className="contents">
          <dt className="text-ink-2">{label}</dt>
          <dd className={value == null ? "text-ink-mute" : "face-mono"}>{value ?? "missing"}</dd>
          <dd className="text-ink-mute">{value == null ? "" : source}</dd>
        </div>
      ))}
    </dl>
  );
}
function Issues({ issues: all }: { issues: readonly Issue[] }) {
  // One line per finding as a person reads it: a unit in several groups repeats the same issue.
  const issues = all.filter(
    (issue, k) => all.findIndex((x) => x.kind === issue.kind && x.note === issue.note) === k,
  );
  if (!issues.length) return <p className="text-ink-2">no issue names it</p>;
  return (
    <ul>
      {issues.map((issue) => (
        <TooltipHint key={issue.id} content={ISSUE_KINDS[issue.kind].what}>
          <li>
            <span data-tone={ISSUE_KINDS[issue.kind].color.tone}>
              {ISSUE_KINDS[issue.kind].label}
            </span>{" "}
            <span className="text-ink-2">
              <SubjectText
                text={issue.note}
                ids={issue.elementId == null ? [] : [issue.elementId]}
              />
            </span>
          </li>
        </TooltipHint>
      ))}
    </ul>
  );
}
export function SegmentFactsView({
  segment,
  derivedCfm,
  issues,
}: {
  segment: Segment;
  derivedCfm: number | null;
  issues: readonly Issue[];
}) {
  const revit = segment.revit;
  return (
    <div className="flex flex-col gap-2" data-facts={segment.id}>
      <p>
        <SubjectText text={[{ id: segment.id }]} /> {segment.kind} · {segment.type ?? "no type"} ·{" "}
        {segment.systemName ?? "no system"}
      </p>
      <Rows
        rows={[
          ["size", `${segment.size} ${segment.shape}`, "geometry"],
          ["length", num(segment.lengthFt, "ft", 2), "geometry"],
          ["Pe flow", num(derivedCfm, "cfm"), "derived (pass 1)"],
          ["Revit flow", num(revit.flowCfm, "cfm"), "revit-reported"],
          ["velocity", num(revit.velocityFpm, "fpm"), "revit-reported"],
          ["friction", num(revit.frictionInWgPer100Ft, "in-wg/100 ft", 3), "revit-reported"],
          ["pressure drop", num(revit.pressureDropInWg, "in-wg", 4), "revit-reported"],
          ["roughness", num(segment.roughness.valueFt, "ft", 4), segment.roughness.provenance],
        ]}
      />
      <Issues issues={issues} />
    </div>
  );
}
export function NodeFactsView({ node, issues }: { node: DuctNode; issues: readonly Issue[] }) {
  return (
    <div className="flex flex-col gap-2" data-facts={node.id}>
      <p>
        <SubjectText text={[{ id: node.id }]} /> {node.kind} · {node.family ?? node.category}
        {node.type ? ` · ${node.type}` : ""} · {node.systemName ?? "no system"}
      </p>
      <Rows
        rows={[
          ["part", node.partType ?? null, "revit-reported"],
          ...node.facts.map(
            (fact): Row => [
              fact.key,
              fact.value != null ? factNumber(fact.value, fact.unit) : (fact.text ?? null),
              fact.provenance,
            ],
          ),
        ]}
      />
      <Issues issues={issues} />
    </div>
  );
}
