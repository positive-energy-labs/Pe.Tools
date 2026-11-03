import { z } from "zod";
import { admittedSubject } from "./subject";

import { type RouteGraph } from "@pe/agent-contracts";
import { createRouteOwner, makeAtomRegistry } from "#/shell/owner";
import { createViewOwner } from "../route/view-owner";
import { refuse } from "../route/refusal";
import { type ReadingState } from "./readings";
import { graphFields, type MountAdapters } from "./mount-contracts";
/** Owns Page initialization, transitions, subject admission and stage selection. */
export function createMountPage<P,W>(graph: RouteGraph<P,W>, adapters: MountAdapters<P,W>, initial: Partial<P>, readings: () => Readonly<Record<string, ReadingState>>) {
  const schema = z.object(
    Object.fromEntries(
      graphFields(graph)
        .filter(([, f]) => f.role !== "setting")
        .map(([id, f]) => [id, f.schema]),
    ),
  ) as z.ZodType<P>;
  const incoming = { ...adapters.initialPage, ...initial };
  const admission = admittedSubject(graph, incoming);
  const parsedPage = schema.parse({ ...incoming, ...admission?.patch });
  const normalized = graph.transition?.(parsedPage, parsedPage, "initial", { readings: {} });
  if (normalized && "refusal" in normalized) throw Error(normalized.refusal.message);
  const initialPage = schema.parse({ ...parsedPage, ...normalized?.patch });
  const registry = makeAtomRegistry();
  const base = createRouteOwner(graph.key, registry);
  const view = createViewOwner(base, schema, initialPage, {
    transition:
      graph.transition &&
      ((current, patch, origin) =>
        graph.transition!(current, patch, origin, {
          readings: readings(),
        })),
  });
  if (admission) view.fail(refuse("not-ready", admission.refusal));
  adapters.fixture?.select?.(initialPage);

  const cleanSubject = () => {
    const subject = graph.subjectField;
    if (!subject) return;
    const state = readings()[subject.roster]!;
    const admitted = state.current
      ? admittedSubject(graph, view.read().page as Record<string, unknown>, state.value)
      : null;
    if (!admitted) return;
    view.setPage(admitted.patch as Partial<P>);
    view.fail(refuse("not-ready", admitted.refusal));
  };
  const stage = () => {
    const entry = graphFields(graph).find(([, f]) => f.role === "stage");
    const value = entry ? view.read().page[entry[0] as keyof P] : undefined;
    return typeof value === "string" && graph.stages[value]
      ? value
      : (graph.stageOrder ?? Object.keys(graph.stages))[0]!;
  };
  return { registry, base, view, stage, cleanSubject, dispose() { view.dispose(); base.dispose(); registry.dispose(); } };
}
export type MountPage<P,W> = ReturnType<typeof createMountPage<P,W>>;
