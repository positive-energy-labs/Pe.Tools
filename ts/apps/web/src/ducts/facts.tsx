/**
 * What the drawings say about one element on hover or selection: its size, length and flows, each
 * value beside where it came from. A missing value is printed as missing, never left blank.
 */
import { ISSUE_KINDS } from "./issues";
import type { DuctNode, Issue, Segment } from "./encoding";

const num = (value: number | null | undefined, unit: string, digits = 0) =>
  value == null ? null : `${value.toFixed(digits)} ${unit}`;

type Row = [label: string, value: string | null, source: string];

function Rows({ rows }: { rows: readonly Row[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3">
      {rows.map(([label, value, source]) => (
        <div key={label} className="contents">
          <dt className="text-ink-2">{label}</dt>
          <dd className={value == null ? "text-ink-mute" : "face-mono"}>{value ?? "missing"}</dd>
          <dd className="text-ink-mute">{value == null ? "" : source}</dd>
        </div>
      ))}
    </dl>
  );
}

function Issues({ issues }: { issues: readonly Issue[] }) {
  if (!issues.length) return <p className="text-ink-2">no issue names it</p>;
  return (
    <ul>
      {issues.map((issue) => (
        <li key={issue.id} title={ISSUE_KINDS[issue.kind].what}>
          <span data-tone={ISSUE_KINDS[issue.kind].color.tone}>
            {ISSUE_KINDS[issue.kind].label}
          </span>{" "}
          <span className="text-ink-2">{issue.note}</span>
        </li>
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
        <span className="face-mono">{segment.id}</span> {segment.kind} · {segment.type ?? "no type"}{" "}
        · {segment.systemName ?? "no system"}
      </p>
      <Rows
        rows={[
          ["size", `${segment.size} ${segment.shape}`, "geometry"],
          ["length", num(segment.lengthFt, "ft", 2), "geometry"],
          ["flow", num(derivedCfm, "cfm"), "derived (pass 1)"],
          ["flow", num(revit.flowCfm, "cfm"), "revit-reported"],
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
        <span className="face-mono">{node.id}</span> {node.kind} · {node.family ?? node.category}
        {node.type ? ` · ${node.type}` : ""} · {node.systemName ?? "no system"}
      </p>
      <Rows
        rows={[
          ["part", node.partType ?? null, "revit-reported"],
          ...node.facts.map(
            (fact): Row => [
              fact.key,
              fact.value != null ? `${fact.value} ${fact.unit}` : (fact.text ?? null),
              fact.provenance,
            ],
          ),
        ]}
      />
      <Issues issues={issues} />
    </div>
  );
}
