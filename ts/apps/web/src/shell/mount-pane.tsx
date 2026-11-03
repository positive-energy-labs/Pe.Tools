import { useEffect, useMemo, type ReactNode } from "react";
import type { RouteGraph } from "@pe/agent-contracts";
import { builtinAdmission, legacyBuiltinKeys } from "./legacy-route-door";
import { ScopeKeys, type ScopeKey } from "@pe/kit/keys";
import type { PaneApi } from "../../../../packages/kit/src/components/lang/graph-layout";
import { reduceLayout } from "../../../../packages/kit/src/components/lang/layout-graph";
import { useRouteSearchSlice } from "../route/activity";
import { publishSubjectRoster, registerSubject, subjectState, useSubjects } from "./subject";
import { PageControl } from "./situation-fields";
import { mountRefusals, type GraphMount, type MountAdapters } from "./mount-owner";
import { PaneHead } from "./mount-reading";
import { GraphHistory } from "./mount-timeline";
import { GraphVerb } from "./mount-verbs";

export interface MountBody<P, W> {
  owner: GraphMount<P, W>;
  page: P;
  /** Fold/route visibility controls expensive viewport leases as well as reading demand. */
  visible: boolean;
  thread?: string;
  /** Row-scoped controls share the same binding, ticket, owner and journal as the head. */
  verbs(this: void, row: unknown): ReactNode;
  /** The pane's selected/focused row is explicit; the kernel never guesses from an index. */
  focusRow(this: void, row: unknown): void;
}
/** Target, Work and their host write ports are the kernel's (`useWorkScope`); a route never passes them. */
export type RouteAdapters<P, W> = Omit<
  MountAdapters<P, W>,
  "getSnapshot" | "subscribe" | "write" | "subscribeAcceptedDeltas"
> & {
  bodies: Readonly<Record<string, (body: MountBody<P, W>) => ReactNode>>;
  furniture?: Readonly<Record<string, (body: MountBody<P, W>) => Parameters<PaneApi>[1]>>;
  /** Bodies with hook-derived furniture render through the same kernel frame. */
  frames?: Readonly<Record<string, (body: MountBody<P, W>, pane: PaneApi) => ReactNode>>;
  lease?(owner: GraphMount<P, W>): {
    context?: Record<string, unknown>;
    facts?: Record<string, unknown>;
  };
  /**
   * Shared view state for every pane body (attention, hover, one model projection computed once),
   * mounted once around the layout inside the owner's scopes. Context providers only: no host door,
   * no verbs, no keys, no layout; those belong to the graph (ADR 0026) and the guards refuse them.
   */
  wrap?(this: void, owner: GraphMount<P, W>, children: ReactNode): ReactNode;
};

/**
 * Admission runs before any owner or resource exists. Publish the subject only after every check.
 */
export function admitRoute<P, W>(graph: RouteGraph<P, W>, adapters: RouteAdapters<P, W>) {
  const refusals = mountRefusals(graph, adapters);
  // The private legacy census owns this temporary door, independently of retired graph hashes.
  const admission = legacyBuiltinKeys.includes(graph.key) ? builtinAdmission(graph) : null;
  if (admission) refusals.push({ code: "invalid-graph", path: "module", message: admission });
  for (const id of Object.keys(graph?.panes ?? {})) {
    if (!adapters.bodies[id] && !adapters.frames?.[id] && !graph.panes[id]?.history)
      refusals.push({
        code: "missing-pane",
        path: `panes.${id}`,
        message: `Missing pane body '${id}'`,
      });
    const receipts = graph.panes[id]?.history?.receipts;
    if (receipts && !graph.readings[receipts])
      refusals.push({
        code: "invalid-graph",
        path: `panes.${id}.history.receipts`,
        message: `Unknown reading '${receipts}'`,
      });
  }
  if (!refusals.length) registerSubject(graph.key, graph);
  return refusals;
}

/** The graph layout reduced by `active`, keeping only the panes the current stage declares. */
export function stageLayout<P, W>(
  graph: RouteGraph<P, W>,
  stageId: string,
  active: (when: string) => boolean,
) {
  const stage = graph.stages[stageId]!;
  const reduced = reduceLayout(graph.layout, active);
  const present = new Set<string>();
  const walk = (node: NonNullable<typeof reduced>) => {
    if (node.kind === "pane") {
      if (stage.panes.includes(node.id)) present.add(node.id);
    } else if (node.kind === "split") for (const child of node.children) walk(child);
  };
  if (reduced) walk(reduced);
  // Stage pane membership gates leaves as well as graph predicates.
  const keep = (node: typeof graph.layout): typeof graph.layout | null => {
    if (node.kind === "pane") return present.has(node.id) ? node : null;
    if (node.kind === "gate") return keep(node.child);
    const children = node.children.flatMap((child) => {
      const kept = keep(child);
      return kept ? [kept] : [];
    });
    return children.length > 1 ? { ...node, children } : (children[0] ?? null);
  };
  return { present, layout: reduced ? keep(reduced) : null };
}

export function MountedPane<P, W>({
  graph,
  adapters,
  owner,
  id,
  keys,
  enabled,
  thread,
  pane,
}: {
  graph: RouteGraph<P, W>;
  adapters: RouteAdapters<P, W>;
  owner: GraphMount<P, W>;
  id: string;
  keys: readonly ScopeKey[];
  enabled: boolean;
  thread?: string;
  pane: PaneApi;
}) {
  const declaration = graph.panes[id]!;
  const draws = useMemo(
    () => [
      ...new Set([
        ...declaration.draws,
        ...(declaration.history?.receipts ? [declaration.history.receipts] : []),
      ]),
    ],
    [declaration.draws, declaration.history?.receipts],
  );
  useEffect(() => (enabled ? owner.readings.mount(draws) : undefined), [owner, draws, enabled]);
  const ids = typeof declaration.verbs === "function" ? [] : declaration.verbs;
  const body: MountBody<P, W> = {
    owner,
    page: owner.view.read().page,
    visible: enabled,
    thread,
    focusRow: (row) => owner.focusRow(id, row),
    verbs: (row) => {
      const placement = declaration.verbs;
      const authored = typeof placement === "function" ? placement(row as never) : placement;
      if (typeof placement === "function" && authored.some((verb) => !placement.ids.includes(verb)))
        throw Error(`Undeclared row verb in ${id}`);
      return [...authored, ...owner.cellVerbs(row)].map((verb) => (
        <GraphVerb
          key={verb}
          id={verb}
          verb={owner.verbs[verb]!}
          owner={owner}
          row={row}
          pane={id}
          enabled={enabled}
        />
      ));
    },
  };
  const subject = graph.subjectField?.pane === id ? graph.subjectField : null;
  const subjectField = subject ? graph.fields[subject.field] : null;
  const search = useRouteSearchSlice((search) => search);
  useSubjects();
  const subjectStatus = subjectState(graph.key, search);
  const roster = subject ? owner.readings.get(subject.roster) : null;
  useEffect(() => {
    if (subjectField?.picker && roster?.complete)
      publishSubjectRoster(graph.key, search, subjectField.picker.options(roster.value));
  }, [graph.key, subjectField, roster?.version, roster?.complete, search]);
  const head = (
    <>
      {subject && subjectStatus.refusal && (
        <span role="alert" data-tone="alarm">
          {subjectStatus.refusal}
        </span>
      )}
      {subject && subjectField && !subjectStatus.refusal && (
        <PageControl
          id={subject.field}
          field={subjectField}
          value={owner.view.read().page[subject.field]}
          enabled={enabled}
          options={subjectField.picker?.options(owner.readings.get(subject.roster).value)}
          set={(value) => owner.view.setPage({ [subject.field]: value } as Partial<P>)}
        />
      )}
      <PaneHead owner={owner} draws={draws} enabled={enabled} refresh={graph.refresh} />
    </>
  );
  const renderPane: PaneApi = (content, furniture) =>
    pane(
      <>
        <ScopeKeys keys={enabled ? keys : []} />
        {ids.map((verb) => (
          <GraphVerb
            key={verb}
            id={verb}
            verb={owner.verbs[verb]!}
            owner={owner}
            enabled={enabled}
            pane={id}
          />
        ))}
        {content}
      </>,
      {
        ...furniture,
        actions: (
          <>
            {furniture?.actions}
            {head}
          </>
        ),
      },
    );
  if (adapters.frames?.[id]) return adapters.frames[id](body, renderPane);
  return renderPane(
    declaration.history ? (
      <GraphHistory owner={owner} receipts={declaration.history.receipts} />
    ) : (
      adapters.bodies[id]!(body)
    ),
    adapters.furniture?.[id]?.(body),
  );
}
