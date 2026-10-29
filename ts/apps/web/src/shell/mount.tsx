import {
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { type RouteGraph, type VerbDecl } from "@pe/agent-contracts";
import { Route as rootRoute } from "../routes/__root";
import { createRoute } from "@tanstack/react-router";
import { KeyScope, ScopeKeys, actionScopeKeys, useScopeLive, type ScopeKey } from "@pe/kit/keys";
import { Button } from "@pe/kit/lang/button";
import { Input, Label, Textarea } from "@pe/kit/lang/input";
import {
  GraphLayoutView,
  type GraphLayoutState,
} from "../../../../packages/kit/src/components/lang/graph-layout";
import { reduceLayout } from "../../../../packages/kit/src/components/lang/layout-graph";
import { PrimaryRouteControls } from "../navigation/route-controls";
import { RouteVisibility, useRouteCurrent } from "../route/activity";
import { routeSearch, useRouteOwner } from "../route/route-owner";
import { Ladder } from "../route/ladder";
import { useInitialUrlPage, useUrlPage } from "../route/url";
import { bindGraphChords } from "./keys";
import {
  createGraphMount,
  mountRefusals,
  graphFields,
  type GraphMount,
  type MountAdapters,
} from "./mount-owner";
import { graphUrlPage } from "./mount-page";

export type { GraphMount, MountAdapters, MountScope, MountBinding } from "./mount-owner";
export { createGraphMount } from "./mount-owner";

export interface MountBody<P, W> {
  owner: GraphMount<P, W>;
  page: P;
  /** Row-scoped controls share the same binding, ticket, owner and journal as the head. */
  verbs(this: void, row: unknown): ReactNode;
  /** The pane's selected/focused row is explicit; the kernel never guesses from an index. */
  focusRow(this: void, row: unknown): void;
}
export type RouteAdapters<P, W> = MountAdapters<P, W> & {
  bodies: Readonly<Record<string, (body: MountBody<P, W>) => ReactNode>>;
};
export interface MountRouteProps {
  hidden?: boolean;
}

function Refused({ refusals }: { refusals: Readonly<ReturnType<typeof mountRefusals>> }) {
  return (
    <section aria-label="Route refused" role="alert">
      {refusals.map((r, i) => (
        <p key={i}>
          {r.path}: {r.message}
        </p>
      ))}
    </section>
  );
}

/** One declaration produces one mounted owner. Admission runs before any owner or resource exists. */
export function mountRoute<P, W>(graph: RouteGraph<P, W>, adapters: RouteAdapters<P, W>) {
  const refusals = mountRefusals(graph, adapters);
  for (const id of Object.keys(graph?.panes ?? {}))
    if (!adapters.bodies[id])
      refusals.push({
        code: "missing-pane",
        path: `panes.${id}`,
        message: `Missing pane body '${id}'`,
      });
  if (refusals.length)
    return function RefusedRoute() {
      return <Refused refusals={refusals} />;
    };
  const url = graphUrlPage(graph);
  return function MountedRoute({ hidden = false }: MountRouteProps) {
    const initial = useInitialUrlPage(url);
    const owner = useRouteOwner(() => createGraphMount(graph, adapters, initial));
    useEffect(() => owner.connect(), [owner]);
    useUrlPage(url, owner.view);
    useSyncExternalStore(owner.subscribe, owner.version, owner.version);
    const visible = useContext(RouteVisibility);
    const current = useRouteCurrent();
    const live = useScopeLive();
    owner.setAvailable(() => !hidden && visible && live && current());
    return (
      <MountedGraph
        graph={graph}
        adapters={adapters}
        owner={owner}
        hidden={hidden || !visible || !live || !current()}
        current={current}
      />
    );
  };
}

/** A code route under the app root (S0c proved coexistence); the file-route generator stays untouched. */
export function routeFromGraph<P, W, const Path extends string>(
  graph: RouteGraph<P, W>,
  adapters: RouteAdapters<P, W>,
  path: Path = `/${graph.address.replace(/^\//, "")}` as Path,
) {
  const url = graphUrlPage(graph);
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    validateSearch: (search: Record<string, unknown>) => ({
      ...routeSearch(search),
      ...url.read(search),
    }),
    component: mountRoute(graph, adapters),
  });
}

function nativeUndo(event: KeyboardEvent) {
  const target = event.target;
  return (
    target instanceof Element &&
    !!target.closest(
      "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']",
    )
  );
}

function MountedGraph<P, W>({
  graph,
  adapters,
  owner,
  hidden,
  current,
}: {
  graph: RouteGraph<P, W>;
  adapters: RouteAdapters<P, W>;
  owner: GraphMount<P, W>;
  hidden: boolean;
  current: () => boolean;
}) {
  const stageId = owner.stage();
  const stage = graph.stages[stageId]!;
  const page = owner.view.read().page;
  const [layoutState, setLayoutState] = useState<GraphLayoutState>({});
  const active = useMemo(
    () => (when: string) =>
      when in graph.stages
        ? when === stageId
        : graph.predicates?.[when]?.(page, owner.snapshot().work?.doc ?? null) === true,
    [graph, stageId, page, owner, owner.snapshot().work],
  );
  const reduced = reduceLayout(graph.layout, active);
  const present = new Set<string>();
  const walk = (node: NonNullable<typeof reduced>) => {
    if (node.kind === "pane") {
      if (stage.panes.includes(node.id)) present.add(node.id);
    } else if (node.kind === "split") for (const child of node.children) walk(child);
  };
  if (reduced) walk(reduced);
  // Stage pane membership gates leaves as well as graph predicates.
  const stageLayout = (node: typeof graph.layout): typeof graph.layout | null => {
    if (node.kind === "pane") return present.has(node.id) ? node : null;
    if (node.kind === "gate") return stageLayout(node.child);
    const children = node.children.flatMap((child) => {
      const kept = stageLayout(child);
      return kept ? [kept] : [];
    });
    return children.length > 1 ? { ...node, children } : (children[0] ?? null);
  };
  const layout = reduced ? stageLayout(reduced) : null;
  const actions = Object.fromEntries(
    Object.keys(graph.verbs).map((id) => {
      const control = owner.control(id);
      return [
        id,
        {
          available: () => !hidden && current(),
          refusal: control.refusal,
          invoke: () => {
            if (!hidden && current()) void control.run();
          },
        },
      ];
    }),
  );
  const paneVerbs = (id: string) => {
    const placement = graph.panes[id]!.verbs;
    const row = owner.paneRows.get(id);
    return typeof placement === "function"
      ? row === undefined
        ? []
        : placement(row as never)
      : placement;
  };
  const keys = bindGraphChords(graph, stageId, {
    actions,
    panes: Object.fromEntries(
      [...present].map((id) => [
        id,
        {
          folded: layoutState[id]?.folded,
          verbs: paneVerbs(id),
        },
      ]),
    ),
  });
  if (!keys.ok) return <Refused refusals={keys.refusals} />;
  const stageKeys = keys.tree.children[0]!;
  const journalKeys = actionScopeKeys(
    (["undo", "redo"] as const).map((direction) => ({
      id: `${graph.key}.${direction}`,
      label: direction,
      bindings: [direction === "undo" ? ("Mod+Z" as const) : ("Mod+Shift+Z" as const)],
      options: { ignoreInputs: true, preventDefault: false, stopPropagation: false },
      invoke: (event?: KeyboardEvent) => {
        if (hidden || !current() || (event && nativeUndo(event))) return false;
        void owner.restore(direction);
      },
    })),
  );
  const navigatorKeys = actionScopeKeys([
    {
      id: `${graph.key}.navigate`,
      label: "Navigate",
      bindings: ["Mod+K"],
      options: { ignoreInputs: false },
      invoke: (event) => {
        const pane =
          event?.target instanceof Element
            ? (event.target.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId ?? null)
            : null;
        adapters.navigate?.(pane, false);
      },
    },
    {
      id: `${graph.key}.everywhere`,
      label: "Navigate everywhere",
      bindings: ["Mod+Shift+K"],
      options: { ignoreInputs: false },
      invoke: () => adapters.navigate?.(null, true),
    },
  ]);
  const bodies = Object.fromEntries(
    [...present].map((id) => {
      const row = owner.paneRows.get(id);
      const paneBindings = bindGraphChords(graph, stageId, {
        actions: Object.fromEntries(
          paneVerbs(id).map((verb) => {
            const control = owner.control(verb, row, `pane:${id}`);
            return [
              verb,
              {
                available: () => !hidden && current(),
                refusal: control.refusal,
                invoke: () => {
                  if (!hidden && current()) void control.run();
                },
              },
            ];
          }),
        ),
        panes: { [id]: { folded: layoutState[id]?.folded, verbs: paneVerbs(id) } },
      });
      return [
        id,
        (pane: (body: ReactNode) => ReactNode) =>
          pane(
            <MountedPane
              graph={graph}
              adapters={adapters}
              owner={owner}
              id={id}
              keys={
                paneBindings.ok
                  ? (paneBindings.tree.children[0]!.children.find((s) => s.id === id)?.keys ?? [])
                  : []
              }
              enabled={!hidden && !layoutState[id]?.folded}
            />,
          ),
      ];
    }),
  );
  return (
    <KeyScope id={keys.tree.id} hidden={hidden}>
      <ScopeKeys
        keys={[...keys.tree.keys, ...journalKeys, ...(adapters.navigate ? navigatorKeys : [])]}
      />
      <KeyScope key={stageKeys.id} id={stageKeys.id}>
        <ScopeKeys keys={stageKeys.keys} />
        <div
          role="region"
          aria-label={`${graph.name} route`}
          className="flex h-full min-h-0 flex-col"
        >
          <GraphSituation graph={graph} owner={owner} enabled={!hidden && current()} />
          {layout && (
            <GraphLayoutView
              layout={layout}
              panes={graph.panes}
              active={active}
              bodies={bodies}
              state={{ panes: layoutState, onChange: setLayoutState }}
            />
          )}
        </div>
      </KeyScope>
    </KeyScope>
  );
}

function MountedPane<P, W>({
  graph,
  adapters,
  owner,
  id,
  keys,
  enabled,
}: {
  graph: RouteGraph<P, W>;
  adapters: RouteAdapters<P, W>;
  owner: GraphMount<P, W>;
  id: string;
  keys: readonly ScopeKey[];
  enabled: boolean;
}) {
  const declaration = graph.panes[id]!;
  const signature = JSON.stringify(declaration.draws);
  useEffect(
    () => (enabled ? owner.readings.mount(declaration.draws) : undefined),
    [owner, signature, enabled, declaration.draws],
  );
  const ids = typeof declaration.verbs === "function" ? [] : declaration.verbs;
  return (
    <>
      <ScopeKeys keys={enabled ? keys : []} />
      {ids.map((verb) => (
        <GraphVerb
          key={verb}
          id={verb}
          verb={graph.verbs[verb]!}
          owner={owner}
          enabled={enabled}
          pane={id}
        />
      ))}
      {adapters.bodies[id]!({
        owner,
        page: owner.view.read().page,
        focusRow: (row) => owner.focusRow(id, row),
        verbs: (row) => {
          const placement = declaration.verbs;
          const verbs = typeof placement === "function" ? placement(row as never) : placement;
          if (
            typeof placement === "function" &&
            verbs.some((verb) => !placement.ids.includes(verb))
          )
            throw Error(`Undeclared row verb in ${id}`);
          return verbs.map((verb) => (
            <GraphVerb
              key={verb}
              id={verb}
              verb={graph.verbs[verb]!}
              owner={owner}
              row={row}
              pane={id}
              enabled={enabled}
            />
          ));
        },
      })}
    </>
  );
}

function GraphSituation<P, W>({
  graph,
  owner,
  enabled,
}: {
  graph: RouteGraph<P, W>;
  owner: GraphMount<P, W>;
  enabled: boolean;
}) {
  const stageId = owner.stage();
  const stage = graph.stages[stageId]!;
  const stageField = graphFields(graph).find(([, field]) => field.role === "stage")?.[0];
  return (
    <PrimaryRouteControls route={graph.key} slot="situation">
      <section
        aria-label="Situation"
        data-surface="page"
        className="flex flex-wrap items-center gap-2"
      >
        <b>{graph.name}</b>
        {graph.pick !== false && stageField && Object.keys(graph.stages).length > 1 ? (
          <Ladder
            disabled={!enabled}
            levels={[
              {
                key: "stage",
                label: stage.word,
                placeholder: "choose a stage",
                options: (graph.stageOrder ?? Object.keys(graph.stages)).map((id) => ({
                  id,
                  label: graph.stages[id]!.word,
                })),
                picked: (id) => id === stageId,
                pick: (id) => owner.view.setPage({ [stageField]: id } as Partial<P>),
              },
            ]}
          />
        ) : (
          <span>{stage.word}</span>
        )}
        {graphFields(graph)
          .filter(([, field]) => ["subject", "query", "selection", "draft"].includes(field.role))
          .map(([id, field]) => (
            <Label key={id}>
              {id}
              <Input
                aria-label={id}
                disabled={!enabled}
                value={field.codec.encode(owner.view.read().page[id as keyof P])}
                onChange={(e) => {
                  const parsed = field.schema.safeParse(field.codec.decode(e.target.value));
                  if (parsed.success) owner.view.setPage({ [id]: parsed.data } as Partial<P>);
                }}
              />
            </Label>
          ))}
        {stage.verbs.map((id) => (
          <GraphVerb key={id} id={id} verb={graph.verbs[id]!} owner={owner} enabled={enabled} />
        ))}
        {owner.busy() && (
          <Button label="Stop" onClick={() => owner.stop()}>
            Stop
          </Button>
        )}
        {owner.journalRefusal() && <span role="status">{owner.journalRefusal()}</span>}
      </section>
    </PrimaryRouteControls>
  );
}

function GraphVerb<P, W>({
  id,
  verb,
  owner,
  row,
  enabled,
  pane,
}: {
  id: string;
  verb: VerbDecl;
  owner: GraphMount<P, W>;
  row?: unknown;
  enabled: boolean;
  pane?: string;
}) {
  const control = owner.control(id, row, pane ? `pane:${pane}` : "stage");
  const review = control.review;
  const result = owner.results.get(id);
  const [answers, setAnswers] = useState("");
  const [error, setError] = useState<string | null>(null);
  const press = () => {
    let value: unknown;
    if (review && answers.trim()) {
      try {
        value = JSON.parse(answers);
      } catch {
        setError("Review answers must be valid JSON");
        return;
      }
    }
    setError(null);
    void control.run(value);
  };
  return (
    <span
      role="group"
      aria-label={verb.label}
      onFocusCapture={() => {
        if (pane && row !== undefined) owner.focusRow(pane, row);
      }}
    >
      <Button
        kind={review ? "commit" : "framed"}
        label={verb.label}
        pressed={!!review}
        refusal={!enabled ? "This route is inactive" : control.refusal}
        onClick={press}
      >
        {review ? `Commit ${verb.label}` : verb.label}
      </Button>
      {review && (
        <span aria-label={`${verb.label} review`}>
          <output>{JSON.stringify(review.ticket.evidence)}</output>
          {verb.review === "required" && (
            <Label>
              Review answers
              <Textarea
                aria-label={`${verb.label} answers`}
                value={answers}
                onChange={(e) => setAnswers(e.target.value)}
              />
            </Label>
          )}
          <Button label={`Cancel ${verb.label}`} onClick={() => owner.stop()}>
            Cancel
          </Button>
        </span>
      )}
      {(error || (result && "refusal" in result)) && (
        <span role="status">
          {error ?? (result && "refusal" in result ? result.refusal.message : "")}
        </span>
      )}
    </span>
  );
}
