import { HostedChrome } from "../route/hosted-chrome";
import { useRef, useState, useEffect, useContext, type ReactNode } from "react";
import { z } from "zod";
import { Button } from "@pe/kit/lang/button";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { KeyScope, ScopeKeys, actionScopeKeys, useScopeKeys, type ScopeKey } from "@pe/kit/keys";
import {
  GraphLayoutView,
  type GraphLayoutState,
} from "../../../../packages/kit/src/components/lang/graph-layout";
import type { LayoutNode } from "@pe/agent-contracts";
import type {
  RouteGraphJson,
  LayoutJson,
} from "../../../../packages/agent-contracts/src/route-kernel-data";
import { canonicalEnvironmentInput as identity } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import type { AdmittedMount } from "./admitted-mount";
import { readLayoutState, writeLayoutState } from "./mount-page";
import { routeOwnsKey } from "./mount-work";
import {
  PrimaryRouteControls,
  useRouteKeysPrimary,
  useHasGlobalNavigation,
} from "../navigation/route-controls";
import { SituationBand, TimelineHead, JournalButtons } from "./situation-band";
import { ReviewSurface } from "./review-surface";
import { worksharingOf } from "./verbs";
import type { TimelineEntry } from "./timeline";

import { RouteVisibility } from "../route/activity";

/** K4 owns reading state and deduplicated pane closure refresh. */
const rosterSchema = z.array(z.object({ id: z.unknown(), label: z.string() }));
export function admittedJournalKeys(
  mount: AdmittedMount,
  live: () => boolean,
  owns: (event?: KeyboardEvent) => boolean,
): ScopeKey[] {
  return actionScopeKeys(
    (["undo", "redo"] as const).map((direction) => ({
      id: `work.${direction}`,
      label: direction,
      bindings: direction === "undo" ? ["Mod+Z"] : ["Mod+Shift+Z", "Mod+Y"],
      options: { ignoreInputs: true, preventDefault: false, conflictBehavior: "allow" as const },
      invoke: (event?: KeyboardEvent) => {
        if (
          !live() ||
          !owns(event) ||
          (event?.target instanceof Element &&
            event.target.closest(
              "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']",
            ))
        )
          return false;
        if (mount.journalRefusal()) return false;
        void mount.restoreWork(direction);
      },
    })),
  );
}
function DocumentKeys({ keys }: { keys: readonly ScopeKey[] }) {
  useScopeKeys(keys, typeof document === "undefined" ? null : document.documentElement);
  return null;
}
export function AdmittedSubjectPicker({
  mount,
  data,
}: {
  mount: AdmittedMount;
  data: RouteGraphJson;
}) {
  const field = data.fields[data.subject.field];
  if (field?.role !== "subject") return null;
  const options = rosterSchema.parse(mount.picker(data.subject.field) ?? []);
  const value = mount.page.read()[data.subject.field];
  const many = field.cardinality === "many";
  const all = many && (value as { kind: string })?.kind === "all";
  const ids = many
    ? ((value as { ids?: readonly unknown[] })?.ids ?? [])
    : value == null
      ? []
      : [value];
  const available = (all ? options.map((o) => o.id) : ids).filter((id) =>
    options.some((o) => identity(o.id) === identity(id)),
  );
  const selected = available.map(identity);
  const unknown = !all && available.length < ids.length;
  return (
    <>
      <ListPopup
        anchor="trigger"
        face="control"
        triggerLabel={`Choose ${data.subject.noun}`}
        trigger={
          all
            ? `All ${data.subject.noun}`
            : options
                .filter((o) => selected.includes(identity(o.id)))
                .map((o) => o.label)
                .join(", ") || `Choose ${data.subject.noun}`
        }
        aria-label={data.subject.noun}
        items={options}
        keyOf={(o) => identity(o.id)}
        labelOf={(o) => o.label}
        filter="substring"
        select={many ? "multi" : "single"}
        selected={selected}
        empty={`No ${data.subject.noun} available`}
        row={(o) => ({ label: o.label })}
        onPick={(option) =>
          mount.controls.subject(
            many
              ? {
                  kind: "ids",
                  ids: selected.includes(identity(option.id))
                    ? available.filter((id) => identity(id) !== identity(option.id))
                    : [...available, option.id],
                }
              : option.id,
          )
        }
      />
      {many && (
        <>
          <Button
            label={`All ${data.subject.noun}`}
            onClick={() => mount.controls.subject({ kind: "all" })}
          >
            All
          </Button>
          <Button
            label={`No ${data.subject.noun}`}
            onClick={() => mount.controls.subject({ kind: "ids", ids: [] })}
          >
            None
          </Button>
        </>
      )}
      {unknown && (
        <span role="alert">
          Some selected {data.subject.noun} are outside the current roster. Choose again.
        </span>
      )}
    </>
  );
}
export function admittedLayout(
  data: RouteGraphJson,
  mount: Pick<AdmittedMount, "visible" | "predicates" | "page">,
): LayoutNode | null {
  const field = Object.entries(data.fields).find(([, f]) => f.role === "stage")?.[0];
  const stage = String(field ? mount.page.read()[field] : data.stageOrder[0]);
  const members = data.stages[stage]?.panes ?? [];
  const visit = (node: LayoutJson): LayoutNode | null => {
    if (node.kind === "pane")
      return members.includes(node.id) && mount.visible(node.id) ? node : null;
    if (node.kind === "gate") return mount.predicates()[node.when] ? visit(node.child) : null;
    const children = node.children.flatMap((child) => {
      const value = visit(child);
      return value ? [value] : [];
    });
    return children.length > 1
      ? {
          ...node,
          children,
          sized: node.sized ?? "end",
          minSize: node.minSize ?? 80,
          minOtherSize: node.minOtherSize ?? 80,
          maxSize: node.maxSize,
        }
      : (children[0] ?? null);
  };
  return visit(data.layout);
}
/** Row bodies can render the same controls from mount.place's already-issued action projection. */
export function AdmittedActions({
  mount,
  data,
  ids,
  actions,
}: {
  mount: AdmittedMount;
  data: RouteGraphJson;
  ids: readonly string[];
  actions?: Readonly<Record<string, () => unknown>>;
}) {
  return (
    <>
      {ids.map((id) => (
        <Button
          key={id}
          label={data.verbs[id]!.label}
          onClick={() => {
            void (actions?.[id] ? actions[id]() : mount.invoke(id, undefined));
          }}
        >
          {data.verbs[id]!.label}
        </Button>
      ))}
    </>
  );
}
function History({ mount, data }: { mount: AdmittedMount; data: RouteGraphJson }) {
  const journal = mount.journal();
  const timeline: readonly TimelineEntry[] = mount.timeline();
  return (
    <section aria-label="History">
      <JournalButtons owner={mount} words />
      <ol>
        {journal?.moves.map((move) => (
          <li key={`${move.revision}:${move.kind}`}>
            {move.label} / {move.kind} / {move.by === "pea" ? "Pea" : "you"} / r{move.revision}
          </li>
        ))}
        {mount.activity().map((receipt) => (
          <li key={receipt.id}>
            {Object.values(data.verbs).find((v) => "entry" in v && v.entry === receipt.key)
              ?.label ?? "Command"}{" "}
            / {receipt.state}
            {["waiting", "running", "unknown"].includes(receipt.state) && (
              <Button label="Stop command" onClick={() => void mount.stopCommand(receipt.id)}>
                Stop
              </Button>
            )}
          </li>
        ))}
      </ol>
      {timeline
        .filter((entry) => entry.kind === "feed")
        .map((entry, index) => (
          <p key={`feed:${index}`} role="status">
            {typeof (entry.subject as { message?: unknown } | undefined)?.message === "string"
              ? (entry.subject as { message: string }).message
              : "Source update"}
          </p>
        ))}
      {mount.refusedEdits().map((edit) => (
        <p key={edit.id} role="status">
          Unaccepted edit: {edit.refusal.error}
          <Button
            label="Retry edit"
            refusal={mount.workBasis() ? null : "Work unavailable"}
            onClick={() => {
              const basis = mount.workBasis();
              if (basis) void mount.retryEdit(edit.id, basis);
            }}
          >
            Retry
          </Button>
          <Button label="Discard edit" onClick={() => mount.discardEdit(edit.id)}>
            Discard
          </Button>
        </p>
      ))}
    </section>
  );
}
function Chrome({
  mount,
  data,
  children,
  primary,
  portal,
}: {
  primary: boolean;
  portal: boolean;
  mount: AdmittedMount;
  data: RouteGraphJson;
  children?: ReactNode;
}) {
  const element = useRef<HTMLDivElement>(null);
  const visible = useContext(RouteVisibility);
  const storage = `pe.route.${data.key}.layout`;
  const [panes, setPanes] = useState<GraphLayoutState>(() => readLayoutState(storage));
  const layout = admittedLayout(data, mount);
  const field = Object.entries(data.fields).find(([, f]) => f.role === "stage")?.[0];
  const stageId = String(field ? mount.page.read()[field] : data.stageOrder[0]);
  const stage = data.stages[stageId];
  const keys = admittedJournalKeys(
    mount,
    () => visible && !!mount.work(),
    (event) => routeOwnsKey(element.current, primary, event),
  );
  const verbs = Object.fromEntries(
    Object.entries(data.verbs).map(([id, v]) => [id, { label: v.label, kind: v.kind }]),
  );
  for (const v of Object.values(data.verbs))
    if ("entry" in v) verbs[v.entry] = { label: v.label, kind: v.kind };
  const actionKeys = (ids: readonly string[]) =>
    actionScopeKeys(
      ids.flatMap((id) => {
        const verb = data.verbs[id]!;
        return verb.chord
          ? [
              {
                id: `${data.key}.${id}`,
                label: verb.label,
                bindings: [verb.chord as ScopeKey["hotkey"]],
                invoke: () => {
                  void mount.invoke(id, undefined);
                },
              },
            ]
          : [];
      }),
    );
  const demand = JSON.stringify(
    Object.keys(data.panes).map((id) => [
      id,
      visible && !!stage?.panes.includes(id) && mount.visible(id) && !panes[id]?.folded,
    ]),
  );
  useEffect(() => {
    for (const [id, wanted] of JSON.parse(demand) as [string, boolean][])
      mount.setPaneDemand(id, wanted);
  }, [mount, demand]);
  return (
    <KeyScope id={data.key} hidden={!visible}>
      <DocumentKeys keys={keys} />
      <div
        ref={element}
        data-route-mount={data.key}
        data-route-journal={mount.work() ? "" : undefined}
        className="flex h-full min-h-0 flex-col"
      >
        <ScopeKeys keys={actionKeys(stage?.verbs ?? [])} />
        <SituationPortal route={data.key} portal={portal}>
          <SituationBand
            name={data.name}
            context={
              <>
                {data.stageOrder.length > 1 && (
                  <ListPopup
                    anchor="trigger"
                    face="control"
                    trigger={stage?.word ?? "Choose stage"}
                    triggerLabel="Choose stage"
                    aria-label="Stage"
                    empty="No stages"
                    items={data.stageOrder}
                    keyOf={(id) => id}
                    labelOf={(id) => data.stages[id]!.word}
                    row={(id) => ({ label: data.stages[id]!.word })}
                    select="single"
                    selected={[stageId]}
                    onPick={(id) => mount.controls.stage(id)}
                  />
                )}
                <span>{mount.subjectDisplay()}</span>
              </>
            }
            alerts={children}
            verbs={(stage?.verbs ?? []).map((id) => (
              <AdmittedActions key={id} mount={mount} data={data} ids={[id]} />
            ))}
            timeline={
              <TimelineHead
                owner={mount}
                verbs={verbs}
                history={<History mount={mount} data={data} />}
              />
            }
          />
        </SituationPortal>
        {layout && (
          <GraphLayoutView
            layout={layout}
            panes={Object.fromEntries(
              Object.entries(data.panes).map(([id, pane]) => [
                id,
                { ...pane, verbs: [], draws: [] },
              ]),
            )}
            active={() => true}
            state={{
              panes,
              onChange: (next) => {
                setPanes(next);
                writeLayoutState(storage, next);
              },
            }}
            bodies={Object.fromEntries(
              Object.entries(data.panes).map(([id, declaration]) => [
                id,
                (pane) =>
                  pane(
                    <>
                      <ScopeKeys
                        keys={actionKeys(Array.isArray(declaration.verbs) ? declaration.verbs : [])}
                      />
                      {declaration.history ? (
                        <History mount={mount} data={data} />
                      ) : (
                        (mount.read(id) as ReactNode)
                      )}
                    </>,
                    {
                      actions: (
                        <>
                          {id === data.subject.pane && (
                            <AdmittedSubjectPicker mount={mount} data={data} />
                          )}
                          <PaneStatus mount={mount} draws={declaration.draws} />
                          {declaration.draws.length > 0 && (
                            <Button
                              label={`Refresh ${declaration.label}`}
                              onClick={() => {
                                mount.refreshPane(id);
                              }}
                            >
                              Refresh
                            </Button>
                          )}
                          {Array.isArray(declaration.verbs) && (
                            <AdmittedActions mount={mount} data={data} ids={declaration.verbs} />
                          )}
                        </>
                      ),
                    },
                  ),
              ]),
            )}
          />
        )}
        {mount.reviewIds().map((id) => {
          const review = mount.review(id)!;
          return (
            <ReviewSurface
              key={id}
              label={data.verbs[id]?.label ?? "Carry over"}
              sentence={review.sentence}
              rows={review.rows}
              worksharing={worksharingOf(review.preview)}
              enabled
              refusal={review.stale ? "Review is stale; prepare it again" : null}
              confirm={() => void mount.confirm(id)}
              cancel={() => mount.cancelReview(id)}
            />
          );
        })}
      </div>
    </KeyScope>
  );
}

function PaneStatus({ mount, draws }: { mount: AdmittedMount; draws: readonly string[] }) {
  const readings = draws.map((id) => mount.readingStatus(id));
  const problem = readings.find(
    (r) => r.snapshot.status === "unavailable" || r.snapshot.status === "failed",
  );
  if (problem && !problem.snapshot.current)
    return (
      <span role="status">
        {problem.previous !== undefined ? "Showing previous reading. " : ""}
        {problem.snapshot.reason}
      </span>
    );
  return readings.some((r) => !r.snapshot.current) ? <span role="status">Reading...</span> : null;
}

export function AdmittedChrome(props: {
  mount: AdmittedMount;
  data: RouteGraphJson;
  children?: ReactNode;
}) {
  const navigation = useHasGlobalNavigation();
  const primary = useContext(HostedChrome) == null;
  return navigation ? (
    <NavigatedChrome {...props} />
  ) : (
    <Chrome {...props} primary={primary} portal={false} />
  );
}
function NavigatedChrome(props: {
  mount: AdmittedMount;
  data: RouteGraphJson;
  children?: ReactNode;
}) {
  const hosted = useContext(HostedChrome) != null;
  const primary = useRouteKeysPrimary(props.data.key, hosted);
  return <Chrome {...props} primary={primary} portal />;
}
function SituationPortal({
  route,
  portal,
  children,
}: {
  route: string;
  portal: boolean;
  children: ReactNode;
}) {
  return portal ? (
    <PrimaryRouteControls route={route} slot="situation">
      {children}
    </PrimaryRouteControls>
  ) : (
    <>{children}</>
  );
}
