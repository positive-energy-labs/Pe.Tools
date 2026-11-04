import { createRolePagePorts } from "./page-port";
import type { SettingsOwner } from "./settings";
import { z } from "zod";
import { admittedSubject } from "./subject";

import { type RouteGraph } from "@pe/agent-contracts";
import { createRouteOwner, makeAtomRegistry } from "#/shell/owner";
import { createViewOwner } from "../route/view-owner";
import { refuse, causeRefusal } from "../route/refusal";
import { type ReadingState } from "./readings";
import { graphFields, type MountAdapters } from "./mount-contracts";
/** Owns Page initialization, transitions, subject admission and stage selection. */
export function createMountPage<P, W>(
  graph: RouteGraph<P, W>,
  adapters: MountAdapters<P, W>,
  initial: Partial<P>,
  settings: SettingsOwner,
  readings: () => Readonly<Record<string, ReadingState>>,
) {
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

  adapters.selectPage?.(initialPage);
  const cleanSubject = () => {
    const subject = graph.subjectField;
    if (!subject) return;
    const state = readings()[subject.roster]!;
    const admitted =
      state.current && state.value != null
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
  let disposed = false;
  const ports = createRolePagePorts<P>(graph.fields, {
    readPage: () => ({ ...view.read().page, ...settings.read().values }),
    movePage(patch, origin) {
      if (disposed)
        return { kind: "refused", code: "page", message: "This Page is no longer mounted" };
      if (origin.source === "setting") {
        const state = settings.read();
        if (state.revision < 0 || state.pending)
          return {
            kind: "refused",
            code: "settings",
            message: "Wait for settings to finish loading or saving",
          };
        void settings
          .set(patch as Record<string, unknown>)
          .catch((cause) => view.fail(causeRefusal(cause)));
        return {
          kind: "accepted",
          revision: state.revision,
          changed: false,
          membership: "unresolved",
        };
      }
      const failure = view.move(patch, { history: origin.history });
      return failure
        ? { kind: "refused", code: "page", message: failure.message }
        : {
            kind: "accepted",
            revision: view.read().revision,
            changed: true,
            membership: "unresolved",
          };
    },
  });
  return {
    registry,
    base,
    view,
    ports,
    stage,
    cleanSubject,
    dispose() {
      disposed = true;
      view.dispose();
      base.dispose();
      registry.dispose();
    },
  };
}
export type MountPage<P, W> = ReturnType<typeof createMountPage<P, W>>;
