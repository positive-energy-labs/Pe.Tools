import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { actionReceiptSchema, receiptsForWork, routeAddress } from "@pe/agent-contracts";
import type { RouteGraph, VerbDecl } from "@pe/agent-contracts";
import { Route as rootRoute } from "../routes/__root";
import { createRoute } from "@tanstack/react-router";
import { KeyScope, ScopeKeys, actionScopeKeys, useScopeLive, type ScopeKey } from "@pe/kit/keys";
import { Button } from "@pe/kit/lang/button";
import { Input, Label, Textarea } from "@pe/kit/lang/input";
import {
  GraphLayoutView,
  type GraphLayoutState,
  type PaneApi,
} from "../../../../packages/kit/src/components/lang/graph-layout";
import { reduceLayout } from "../../../../packages/kit/src/components/lang/layout-graph";
import { PrimaryRouteControls } from "../navigation/route-controls";
import { RouteVisibility, useRouteCurrent, useRouteSearchSlice } from "../route/activity";
import { routeSearch, useRouteOwner } from "../route/route-owner";
import { Ladder } from "../route/ladder";
import type { RouteHandle } from "../route/handle";
import { LadderPicker, useDocumentLadder } from "../route/situation-ladder";
import { useInitialUrlPage, useUrlPage } from "../route/url";
import { bindGraphChords } from "./keys";
import {
  CONFLICT_REFUSAL,
  createGraphMount,
  mountRefusals,
  graphFields,
  type GraphMount,
  type MountAdapters,
} from "./mount-owner";
import { graphUrlPage, readLayoutState, writeLayoutState } from "./mount-page";
import { settingFields } from "./settings";
import { useWorkScope, type WorkScopeStatus } from "./use-work-scope";

export type { GraphMount, MountAdapters, MountScope, MountBinding } from "./mount-owner";
export { createGraphMount } from "./mount-owner";

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
  /**
   * Shared view state for every pane body (attention, hover, one model projection computed once),
   * mounted once around the layout inside the owner's scopes. Context providers only: no host door,
   * no verbs, no keys, no layout; those belong to the graph (ADR 0026) and the guards refuse them.
   */
  wrap?(this: void, owner: GraphMount<P, W>, children: ReactNode): ReactNode;
};
export interface MountRouteProps {
  hidden?: boolean;
  url?: boolean;
  target?: string;
  work?: string;
  thread?: string;
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
  if (refusals.length)
    return function RefusedRoute() {
      return <Refused refusals={refusals} />;
    };
  return function MountedRoute(props: MountRouteProps) {
    const mount = useGraphRoute(graph, adapters, props);
    return <GraphRouteView graph={graph} adapters={adapters} {...mount} />;
  };
}

/** Custom route chrome uses the same owner, target door, URL and availability as mountRoute. */
export function useGraphRoute<P, W>(
  graph: RouteGraph<P, W>,
  adapters: RouteAdapters<P, W>,
  { hidden = false, url: projectUrl = true, thread, target, work }: MountRouteProps = {},
) {
  const addressThread = useRouteSearchSlice((search) => (projectUrl ? search.thread : undefined));
  const boundThread = thread ?? addressThread;
  const url = useMemo(
    () => graphUrlPage(graph, adapters.initialPage),
    [graph, adapters.initialPage],
  );
  const addressPage = useInitialUrlPage(projectUrl ? url : null);
  const initial = {
    ...addressPage,
    ...(work !== undefined && graph.workSubject ? { [graph.workSubject]: work } : {}),
  } as Partial<P>;
  // The door follows the owner's Page (its workSubject); before the owner exists, the URL's.
  // The mount re-renders on every Page change, so the next render reads the moved field.
  const mounted = useRef<GraphMount<P, W> | null>(null);
  const scope = useWorkScope(
    graph,
    mounted.current?.view.read().page ?? initial,
    projectUrl && target === undefined && work === undefined
      ? undefined
      : { target, work, thread: boundThread, url: projectUrl },
  );
  const owner = useRouteOwner(() => createGraphMount(graph, { ...adapters, ...scope }, initial));
  mounted.current = owner;
  useEffect(() => owner.connect(), [owner]);
  useEffect(() => {
    if (work !== undefined && graph.workSubject)
      owner.view.setPage({ [graph.workSubject]: work } as Partial<P>);
  }, [owner, graph.workSubject, work]);
  useUrlPage(projectUrl ? url : null, owner.view);
  useSyncExternalStore(owner.subscribe, owner.version, owner.version);
  const visible = useContext(RouteVisibility);
  const current = useRouteCurrent();
  const live = useScopeLive();
  // An unresolved or closed document's route still draws and reads; it arms no verb.
  const settings = owner.settings.read();
  const settingsReady =
    !Object.keys(settingFields(graph)).length ||
    (settings.revision >= 0 && !settings.pending && !settings.error);
  const armed = settingsReady && (!graph.needs || scope.status.resolution.kind === "resolved");
  owner.setAvailable(() => armed && !hidden && visible && live && current());
  return {
    owner,
    hidden: hidden || !visible || !live || !current(),
    current,
    status: scope.status,
    thread: boundThread,
    hosted: !projectUrl,
  };
}

/** A code route under the app root (S0c proved coexistence); the file-route generator stays untouched. */
export function routeFromGraph<P, W, const Path extends string>(
  graph: RouteGraph<P, W>,
  adapters: RouteAdapters<P, W>,
  path: Path = `/${graph.address.replace(/^\//, "")}` as Path,
) {
  const url = graphUrlPage(graph, adapters.initialPage);
  return createRoute({
    getParentRoute: () => rootRoute,
    path,
    // Type only the keys the URL carries: returning every field makes the router redirect to a
    // URL that spells out each default. Absent fields rest at their defaults in the mount.
    validateSearch: (search: Record<string, unknown>) => {
      const typed = url.read(search) as Record<string, unknown>;
      const present = Object.fromEntries(
        Object.entries(typed).filter(([id]) => id in search),
      ) as Partial<P>;
      return { ...routeSearch(search), ...present };
    },
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

export function GraphRouteView<P, W>({
  graph,
  adapters,
  owner,
  hidden,
  current,
  status,
  thread,
  hosted,
  situation,
  device,
}: {
  graph: RouteGraph<P, W>;
  adapters: RouteAdapters<P, W>;
  owner: GraphMount<P, W>;
  hidden: boolean;
  current: () => boolean;
  status: WorkScopeStatus;
  thread?: string;
  hosted: boolean;
  situation?: ReactNode;
  device?: { panes: GraphLayoutState; onChange(next: GraphLayoutState): void };
}) {
  const stageId = owner.stage();
  const stage = graph.stages[stageId]!;
  const page = owner.view.read().page;
  const layoutKey = `pe.route.${graph.key}.layout`;
  const [localLayout, setLayoutState] = useState<GraphLayoutState>(() =>
    readLayoutState(layoutKey),
  );
  const layoutState = device?.panes ?? localLayout;
  const changeLayout = (next: GraphLayoutState) => {
    if (device) {
      device.onChange(next);
      return;
    }
    setLayoutState(next);
    writeLayoutState(layoutKey, next);
  };
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
        (pane: PaneApi) => (
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
            thread={thread}
            pane={pane}
          />
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
          {situation !== undefined ? (
            situation
          ) : (
            <GraphSituation
              graph={graph}
              owner={owner}
              enabled={!hidden && current()}
              status={status}
              hosted={hosted}
            />
          )}
          {layout &&
            (adapters.wrap ?? ((_owner, children) => children))(
              owner,
              <GraphLayoutView
                layout={layout}
                panes={graph.panes}
                active={active}
                bodies={bodies}
                state={{ panes: layoutState, onChange: changeLayout }}
              />,
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
      furniture,
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

/** The old kernel's document ladder and resolution words, over the kernel's Target status. */
function GraphTarget({ status, disabled }: { status: WorkScopeStatus; disabled: boolean }) {
  // ponytail: useDocumentLadder reads only resolution, bindingLost, targetProvenance and readings.
  const ladder = useDocumentLadder({ readings: {}, ...status } as unknown as RouteHandle<
    unknown,
    string,
    unknown,
    string
  >);
  const { resolution } = status;
  return (
    <>
      <LadderPicker ladder={ladder} disabled={disabled} />
      {resolution.kind === "checking" ? (
        <span role="status" className="text-ink-2">
          checking the inventory
        </span>
      ) : resolution.kind === "failed" ? (
        <span role="alert" data-tone="caution">
          {resolution.message}
        </span>
      ) : resolution.kind === "choose" ? (
        <span role="status" data-tone="caution">
          {status.bindingLost?.sentence ??
            `choose a target — ${resolution.reason.replaceAll("-", " ")}`}
        </span>
      ) : null}
    </>
  );
}

function GraphSituation<P, W>({
  graph,
  owner,
  enabled,
  status,
  hosted,
}: {
  graph: RouteGraph<P, W>;
  owner: GraphMount<P, W>;
  enabled: boolean;
  status: WorkScopeStatus;
  hosted: boolean;
}) {
  const stageId = owner.stage();
  const stage = graph.stages[stageId]!;
  const stageField = graphFields(graph).find(([, field]) => field.role === "stage")?.[0];
  const content = (
    <section
      aria-label="Situation"
      data-surface="page"
      className="flex flex-wrap items-center gap-2"
    >
      <b>{graph.name}</b>
      {graph.needs && <GraphTarget status={status} disabled={!enabled} />}
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
      {/* The host's own sentence for Work it cannot read; recovery is the kernel review beside it. */}
      {status.failure && <span role="alert">{status.failure}</span>}
      {/* The stage's verbs, then each kernel recovery only while its predicate holds. */}
      {owner.stageVerbs().map((id) => (
        <GraphVerb key={id} id={id} verb={owner.verbs[id]!} owner={owner} enabled={enabled} />
      ))}
      {owner.snapshot().conflict && (
        <span role="status">
          {CONFLICT_REFUSAL}
          <Button label="Read Work again" onClick={() => owner.reread()}>
            Read again
          </Button>
        </span>
      )}
      {owner.busy() && (
        <Button label="Stop" onClick={() => owner.stop()}>
          Stop
        </Button>
      )}
      {owner.journalRefusal() && <span role="status">{owner.journalRefusal()}</span>}
    </section>
  );
  return hosted ? (
    content
  ) : (
    <PrimaryRouteControls route={graph.key} slot="situation">
      {content}
    </PrimaryRouteControls>
  );
}

/** One History presentation for graph panes: accepted calls and exact Work receipts. */
export function GraphHistory<P, W>({
  owner,
  receipts,
}: {
  owner: GraphMount<P, W>;
  receipts?: string;
}) {
  const [entries, setEntries] = useState(() => owner.timeline.read());
  useEffect(() => owner.timeline.subscribe(() => setEntries(owner.timeline.read())), [owner]);
  const reading = receipts ? owner.readings.get(receipts) : null;
  const parsed = actionReceiptSchema.array().safeParse(reading?.value);
  const key = owner.snapshot().work?.handle.key;
  const saved = parsed.success && key ? receiptsForWork(parsed.data, key) : [];
  const recorded = new Set(saved.map((receipt) => receipt.id));
  return (
    <section aria-label="History">
      {reading?.status === "failed" && <p role="alert">{reading.error}</p>}
      {!entries.length && !saved.length && <p>No activity yet</p>}
      <ol>
        {[
          ...entries
            .filter((entry) => !entry.receiptId || !recorded.has(entry.receiptId))
            .map((entry, index) => (
              <li key={`event:${index}`}>
                {entry.verb ?? entry.kind} · {entry.kind} · {String(entry.at)}
              </li>
            )),
          ...[...saved]
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
            .map((receipt) => (
              <li key={receipt.id}>
                <a href={routeAddress("ops").link({ actionId: receipt.id })}>{receipt.key}</a> ·{" "}
                {receipt.state} · {receipt.startedAt}
                {"error" in receipt && receipt.error ? ` · ${String(receipt.error)}` : ""}
              </li>
            )),
        ]}
      </ol>
    </section>
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
    // A recovery's one answer is the commit press itself.
    let value: unknown = review && verb.kind === "recovery" ? { confirm: true } : undefined;
    if (review && verb.kind !== "recovery" && answers.trim()) {
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
          {verb.review === "required" && verb.kind !== "recovery" && (
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
