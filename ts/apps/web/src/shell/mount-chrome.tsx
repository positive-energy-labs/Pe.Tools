import { useMemo, useRef, useState, type ReactNode } from "react";
import type { RouteGraph } from "@pe/agent-contracts";
import { KeyScope, ScopeKeys, actionScopeKeys, useScopeKeys, type ScopeKey } from "@pe/kit/keys";
import { Button } from "@pe/kit/lang/button";
import {
  GraphLayoutView,
  type GraphLayoutState,
  type PaneApi,
} from "../../../../packages/kit/src/components/lang/graph-layout";
import { PrimaryRouteControls, useRouteKeysPrimary } from "../navigation/route-controls";
import { useRouteSearchSlice } from "../route/activity";
import { Ladder } from "../route/ladder";
import { bindGraphChords } from "./keys";
import { SituationFields } from "./situation-fields";
import { SituationBand, TimelineHead, rankVerbs } from "./situation-band";
import { subjectState, useSubjects } from "./subject";
import { CONFLICT_REFUSAL, graphFields, mountRefusals, type GraphMount } from "./mount-owner";
import { readLayoutState, writeLayoutState } from "./mount-page";
import { MountedPane, stageLayout, type RouteAdapters } from "./mount-pane";
import { GraphHistory } from "./mount-timeline";
import { GraphReview, GraphVerb, verbActions } from "./mount-verbs";
import { GraphTarget, journalKeys, routeOwnsKey } from "./mount-work";
import type { WorkScopeStatus } from "./use-work-scope";

export function Refused({ refusals }: { refusals: Readonly<ReturnType<typeof mountRefusals>> }) {
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

/** Mod+K navigates from the focused pane; Mod+Shift+K navigates everywhere. */
function navigatorKeys(
  graph: { key: string },
  navigate: (pane: string | null, everywhere: boolean) => void,
) {
  return actionScopeKeys([
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
        navigate(pane, false);
      },
    },
    {
      id: `${graph.key}.everywhere`,
      label: "Navigate everywhere",
      bindings: ["Mod+Shift+K"],
      options: { ignoreInputs: false },
      invoke: () => navigate(null, true),
    },
  ]);
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
  const mountElement = useRef<HTMLDivElement>(null);
  const primary = useRouteKeysPrimary(graph.key, hosted);
  const stageId = owner.stage();
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
  const { present, layout } = stageLayout(graph, stageId, active);
  const live = () => !hidden && current();
  const actions = verbActions(owner, Object.keys(graph.verbs), live);
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
  const journal = journalKeys(graph, owner, live, (event) =>
    routeOwnsKey(mountElement.current, primary, event),
  );
  const navigator = adapters.navigate ? navigatorKeys(graph, adapters.navigate) : [];
  const bodies = Object.fromEntries(
    [...present].map((id) => {
      const row = owner.paneRows.get(id);
      const paneBindings = bindGraphChords(graph, stageId, {
        actions: verbActions(owner, paneVerbs(id), live, row, `pane:${id}`),
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
    <KeyScope id={keys.tree.id} hidden={hidden} element={mountElement}>
      <ScopeKeys keys={[...keys.tree.keys, ...navigator]} />
      <DocumentKeys keys={journal} />
      <KeyScope key={stageKeys.id} id={stageKeys.id} element={mountElement}>
        <ScopeKeys keys={stageKeys.keys} />
        <div
          ref={mountElement}
          data-route-mount={graph.key}
          data-route-journal={owner.snapshot().work ? "" : undefined}
          role="region"
          aria-label={`${graph.name} route`}
          className="flex h-full min-h-0 flex-col"
        >
          {[...owner.reviews].map(([id, review]) => (
            <GraphReview
              key={review.ticket.press}
              id={id}
              owner={owner}
              enabled={!hidden && current()}
            />
          ))}
          {situation !== undefined ? (
            situation
          ) : (
            <GraphSituation
              graph={graph}
              owner={owner}
              enabled={!hidden && current()}
              status={status}
              hosted={hosted}
              thread={thread}
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

/** The route node's own rule (keys.tsx): bound on the document, so its chords reach a portaled Situation. */
function DocumentKeys({ keys }: { keys: readonly ScopeKey[] }) {
  useScopeKeys(keys, typeof document === "undefined" ? null : document.documentElement);
  return null;
}

function GraphSituation<P, W>({
  graph,
  owner,
  enabled,
  status,
  hosted,
  thread,
}: {
  graph: RouteGraph<P, W>;
  owner: GraphMount<P, W>;
  enabled: boolean;
  status: WorkScopeStatus;
  hosted: boolean;
  thread?: string;
}) {
  const stageId = owner.stage();
  const stage = graph.stages[stageId]!;
  useSubjects();
  const subjectLabel = subjectState(
    graph.key,
    useRouteSearchSlice((search) => search),
  ).label;
  const stageField = graphFields(graph).find(([, field]) => field.role === "stage")?.[0];
  const verbs = rankVerbs(owner.stageVerbs(), owner.verbs).map((id) => (
    <GraphVerb key={id} id={id} verb={owner.verbs[id]!} owner={owner} enabled={enabled} />
  ));
  const content = (
    <SituationBand
      name={graph.name}
      context={
        <>
          {graph.needs && <GraphTarget status={status} disabled={!enabled} />}
          {stageField && Object.keys(graph.stages).length > 1 ? (
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
          ) : graph.subject ? null : (
            <span>{stage.word}</span>
          )}
          {/* One subject projection (shell/subject.ts) titles the band, the Places and the window. */}
          {/* A declared subject field speaks only through its roster label; graph.subject(page) may hold raw keys. */}
          {(subjectLabel || (!graph.subjectField && graph.subject)) && (
            <span data-slot="situation-subject">
              {subjectLabel || graph.subject!(owner.view.read().page)}
            </span>
          )}
          <SituationFields graph={graph} owner={owner} enabled={enabled} />
        </>
      }
      alerts={
        <>
          {status.failure && <span role="alert">{status.failure}</span>}
          {owner.snapshot().conflict && (
            <span role="status">
              {CONFLICT_REFUSAL}
              <Button label="Read Work again" onClick={() => owner.reread()}>
                Read again
              </Button>
            </span>
          )}
          {owner.rejected() && (
            <span role="status">
              Unaccepted edit: {owner.verbs[owner.rejected()!.verb]?.label}
              <Button
                label="Retry edit"
                refusal={!enabled ? "This route is inactive" : owner.retryRefusal()}
                onClick={() => void owner.retry()}
              >
                Retry
              </Button>
              <Button label="Discard edit" onClick={() => owner.discard()}>
                Discard
              </Button>
            </span>
          )}
          {owner.busy() && (
            <Button label="Stop" onClick={() => owner.stop()}>
              Stop
            </Button>
          )}
          {owner.journalRefusal() && <span role="status">{owner.journalRefusal()}</span>}
        </>
      }
      verbs={verbs}
      timeline={
        <TimelineHead
          owner={owner}
          thread={thread}
          history={<GraphHistory owner={owner} label="Route log" />}
        />
      }
    />
  );
  return hosted ? (
    content
  ) : (
    <PrimaryRouteControls route={graph.key} slot="situation">
      {content}
    </PrimaryRouteControls>
  );
}
