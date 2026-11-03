import { z } from "zod";
import type {
  RouteGraphJson,
  LayoutJson,
} from "../../../../packages/agent-contracts/src/route-kernel-data";
import { freezePage } from "./page-port";

type Bodies = Readonly<Record<string, { run: (...args: any[]) => unknown }>>;
/** Global observers publish cached projections outside React's draw path. */
export function createAdmittedObservers(data: RouteGraphJson, bodies: Bodies) {
  let predicates: Readonly<Record<string, boolean>> = {};
  let subject: string | null = null;
  let text: string | null = null;
  let visible = new Set<string>();
  return {
    update(context: unknown) {
      const ctx = freezePage(context) as { page: Record<string, unknown> };
      const next = Object.fromEntries(
        Object.entries(data.predicates).map(([id, body]) => [
          id,
          z.boolean().parse(bodies[body]!.run(ctx)),
        ]),
      );
      const nextSubject = data.subject.show
        ? z.string().parse(bodies[data.subject.show]!.run(ctx.page[data.subject.field]))
        : null;
      const nextText = data.subjectText
        ? z.string().parse(bodies[data.subjectText]!.run(ctx))
        : null;
      const panes = new Set<string>();
      const visit = (node: LayoutJson) => {
        if (node.kind === "pane") panes.add(node.id);
        else if (node.kind === "gate") {
          if (next[node.when]) visit(node.child);
        } else node.children.forEach(visit);
      };
      visit(data.layout);
      predicates = Object.freeze(next);
      subject = nextSubject;
      text = nextText;
      visible = panes;
    },
    predicates: () => predicates,
    subject: () => subject,
    text: () => text,
    visible: (pane: string) => visible.has(pane),
  };
}
