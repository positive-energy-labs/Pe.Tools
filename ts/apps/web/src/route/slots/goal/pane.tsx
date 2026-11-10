import type { Goal } from "@pe/agent-contracts/slots";
import { goalView } from "./index.ts";

/*
 * The kernel's goal pane (ADR 0035 rule 8): what is left comes first, on every route the same way; the
 * answer stays greyed, with its sources, until nothing is unresolved.
 */
export function GoalPane({ ctx: { goal } }: { ctx: { goal: Goal | undefined } }) {
  if (!goal) return <p role="status">computing</p>;
  const view = goalView(goal);
  return (
    <section aria-label="Goal">
      <h3>Unresolved ({view.unresolved.length})</h3>
      <ol>{view.unresolved.map((c) => <li key={c.id} data-resolver={typeof c.resolver === "string" ? c.resolver : c.resolver.op}>{c.says}</li>)}</ol>
      {view.assumed.length ? <><h3>Assumed</h3><ul>{view.assumed.map((c) => <li key={c.id}>{c.says}</li>)}</ul></> : null}
      <p aria-label="Answer" aria-disabled={view.answer.greyed} className={view.answer.greyed ? "text-ink-3" : undefined}>
        {view.answer.value == null ? "No answer yet" : JSON.stringify(view.answer.value)}
        {view.answer.sources.length ? ` (estimate from ${view.answer.sources.join(", ")})` : ""}
      </p>
    </section>
  );
}
