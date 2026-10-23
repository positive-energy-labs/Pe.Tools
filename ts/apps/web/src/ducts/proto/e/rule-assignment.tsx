import { transitionPatches } from "@pe/agent-contracts";
import { LOSS_RULES } from "@pe/ducts-domain/loss-rules";
import { useState } from "react";
import type { LossesWork } from "../../work";

type RuleWork = Pick<LossesWork, "doc" | "write">;

/** The inbox, sidebar and bar editor change one family-wide Work cell. */
export function assignFamilyRule(work: RuleWork, family: string, rule: string) {
  return work.write(
    transitionPatches(
      ["ruleAssignments"],
      family,
      work.doc?.ruleAssignments?.[family] ?? {},
      rule ? { kind: "stage", rung: { value: { rule } } } : { kind: "unstage" },
    ),
  );
}

/** The rules pane and inbox stage the same family-wide choice. Empty takes it back. */
export function RuleAssignment({ family, work }: { family: string; work: RuleWork }) {
  const cell = work.doc?.ruleAssignments?.[family] ?? {};
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="min-w-0">
      <select
        aria-label={`price ${family} as`}
        className="dl-control t-small max-w-full"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        value={cell.staged?.value.rule ?? ""}
        disabled={pending}
        onChange={async (event) => {
          setPending(true);
          setError(null);
          try {
            const refusal = await assignFamilyRule(work, family, event.target.value);
            setError(refusal?.message ?? null);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          } finally {
            setPending(false);
          }
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
      {error ? (
        <span role="alert" data-tone="alarm">
          {error}
        </span>
      ) : null}
    </span>
  );
}
