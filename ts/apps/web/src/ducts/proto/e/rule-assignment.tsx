import {
  transitionPatches,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";
import { LOSS_RULES } from "@pe/ducts-domain/loss-rules";

/** The rules pane and inbox stage the same family-wide choice. Empty takes it back. */
export function RuleAssignment({
  family,
  work,
}: {
  family: string;
  work: { doc: DuctsRouteDocument | null; write: (patches: RouteStatePatch[]) => Promise<unknown> };
}) {
  const cell = work.doc?.ruleAssignments?.[family] ?? {};
  return (
    <select
      aria-label={`price ${family} as`}
      className="dl-control t-small max-w-full"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      value={cell.staged?.value.rule ?? ""}
      onChange={(event) => {
        const rule = event.target.value;
        void work.write(
          transitionPatches(
            ["ruleAssignments"],
            family,
            cell,
            rule ? { kind: "stage", rung: { value: { rule } } } : { kind: "unstage" },
          ),
        );
      }}
    >
      <option value="">price as…</option>
      {LOSS_RULES.map((rule) => (
        <option key={rule.key} value={rule.key}>
          {rule.family}
          {rule.type ? ` : ${rule.type}` : ""}
          {rule.cond ? ` · ${rule.cond}` : ""}
        </option>
      ))}
    </select>
  );
}
