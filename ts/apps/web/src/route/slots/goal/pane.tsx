import { useList } from "@pe/kit/lang/collection";
import { PlainList } from "@pe/kit/lang/list-view";
import type { Closer, Goal } from "@pe/agent-contracts/slots";
import { goalView } from "./index.ts";

/*
 * The kernel's goal pane (ADR 0035 rule 8): what is left comes first, on every route the same way; the
 * answer stays greyed, with its sources, until nothing is unresolved.
 */
const resolverOf = (c: Closer) => (typeof c.resolver === "string" ? c.resolver : c.resolver.op);
function Closers({ closers, label, empty }: { closers: readonly Closer[]; label: string; empty: string }) {
  const list = useList({ items: closers, keyOf: (c) => c.id, search: (c) => ({ text: [c.says, resolverOf(c)] }) });
  return <PlainList list={list} aria-label={label} empty={{ message: empty, exit: "Nothing to resolve" }}
    row={(c) => ({ label: c.says, meta: resolverOf(c) })} />;
}

export function GoalPane({ ctx: { goal } }: { ctx: { goal: Goal | undefined } }) {
  if (!goal) return <p role="status">computing</p>;
  const view = goalView(goal);
  return (
    <section aria-label="Goal">
      <Closers closers={view.unresolved} label="unresolved" empty="nothing unresolved" />
      {view.assumed.length ? <Closers closers={view.assumed} label="assumed" empty="nothing assumed" /> : null}
      <p aria-label="Answer" aria-disabled={view.answer.greyed} className={view.answer.greyed ? "text-ink-mute" : undefined}>
        {view.answer.value == null ? "No answer yet" : JSON.stringify(view.answer.value)}
        {view.answer.sources.length ? ` (estimate from ${view.answer.sources.join(", ")})` : ""}
      </p>
    </section>
  );
}
