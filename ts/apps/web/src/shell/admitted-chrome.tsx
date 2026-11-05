import { HostedChrome } from "../route/hosted-chrome";
import { useMemo, useRef, useState, useEffect, useContext, type ReactNode } from "react";
import { z } from "zod";
import { Button } from "@pe/kit/lang/button";
import { NarrowChip } from "@pe/kit/lang/chip";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { KeyScope, ScopeKeys, actionScopeKeys, useScopeKeys, type ScopeKey } from "@pe/kit/keys";
import {
  GraphLayoutView,
  type GraphLayoutState,
} from "../../../../packages/kit/src/components/lang/graph-layout";
import { catalogWorkCommands, catalogWorks, refusalText, workKey, workHandleSchema, type LayoutNode } from "@pe/agent-contracts";
import { CatalogWorkReview, type CatalogWorkClient } from "../components/work/catalog-work";
import { peReadings } from "#/readings";
import { browserWorkPorts } from "./work-feed-client";
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
import { SituationBand, TimelineHead, consentThread } from "./situation-band";
import { ReviewSurface } from "./review-surface";
import { WriteAction, writeWord, type WriteCell, type WriteRun } from "@pe/kit/lang/write-action";
import { writeResponseSchema } from "@pe/agent-contracts";
import { harnessClient } from "#/workbench/provider/harness-client";
import { resolveWorkbenchConfig } from "#/workbench/config";
import { projectTimeline } from "./timeline";
import { GraphHistory } from "./mount-timeline";
import { PointerList } from "./pointer-list";
import { secondsLeft } from "./countdown";
import { worksharingOf } from "./verbs";
import type { TimelineEntry } from "./timeline";

import { RouteVisibility } from "../route/activity";
import { SubjectDoor, type AdmittedSubject } from "./subject";
import { PaneActionSlots, usePaneActionSlot } from "./pane-actions";
import { openSet, type OpenSet } from "./open-set.neutral";

const catalogSnapshot = z.object({ doc: z.unknown(), handle: workHandleSchema });
const catalogClient: CatalogWorkClient = {
  watch: (key, receive, fail) => peReadings.subscribe({ ...key, kind: "work" }, (frame) => {
    if (frame.kind === "failure") return fail(frame.error);
    if (frame.kind === "gap" || ("stale" in frame && frame.stale)) return fail("Read the current Work before editing");
    if (frame.kind !== "snapshot") return;
    const parsed = catalogSnapshot.safeParse(frame.value);
    if (parsed.success) receive(parsed.data);
    else fail(parsed.error.message);
  }),
  write: async (handle, patches, label) => {
    const result = await browserWorkPorts.write(handle.key, {
      kind: "apply", press: crypto.randomUUID(), expectedRevision: handle.revision,
      patches, label,
    });
    return result.ok ? null : { code: "refused", message: refusalText(result) };
  },
  submit: async (admission) => {
    const result = await browserWorkPorts.submit(admission);
    if (result.state === "detached") throw Error("Write transport detached; inspect History before retrying");
    return result;
  },
};

function CatalogWorkReviews({ mount }: { mount: AdmittedMount }) {
  const visible = useContext(RouteVisibility);
  const key = mount.work()?.handle.key;
  const target = mount.workBasis()?.token.scope.identity.target;
  const identity = key ? workKey(key) : null;
  const owners = useMemo(() => key
    ? (Object.keys(catalogWorks) as (keyof typeof catalogWorks)[]).map((owner) => ({ owner, at: { ...key, route: owner } }))
    : [], [identity]);
  if (!visible || !key || target?.kind !== "document") return null;
  return <details>
    <summary>Work</summary>
    {owners.map(({ owner, at }) => {
      const apply = Object.entries(catalogWorkCommands).find(([, command]) =>
        command.work.route === owner && command.writeBoundary.phase === "apply")![0];
      return <CatalogWorkReview key={owner} owner={owner} at={at} target={target.ref} client={catalogClient}
        reject={writeReject(mount.timeline(), [apply], (thread, requestId) =>
          void harnessClient(resolveWorkbenchConfig().origin).permission(thread, requestId, "stop_writes"),
          typeof mount.page.read().thread === "string" ? String(mount.page.read().thread) : undefined)} />;
    })}
  </details>;
}

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
/** The subject field as one read: its roster, what is open, which member is active, and the
 * moves every door shares (`openSet`). */
export function subjectOf(mount: AdmittedMount, data: RouteGraphJson) {
  const field = data.fields[data.subject.field];
  if (field?.role !== "subject") return null;
  const options = rosterSchema.parse(mount.picker(data.subject.field) ?? []);
  const value = mount.page.read()[data.subject.field];
  const many = field.cardinality === "many";
  const known = (id: unknown) => options.some((o) => identity(o.id) === identity(id));
  const set = openSet(
    identity,
    options.map((o) => o.id),
  );
  const current = (
    many ? value : { kind: "ids", ids: value == null ? [] : [value] }
  ) as OpenSet<unknown>;
  const all = current.kind === "all";
  const ids = set.members(current);
  // Ids outside the roster stay out of every move; the alert below names that they were dropped.
  const open: OpenSet<unknown> =
    current.kind === "all"
      ? current
      : {
          kind: "ids",
          ids: ids.filter(known),
          ...(current.active !== undefined && known(current.active)
            ? { active: current.active }
            : {}),
        };
  const move = (next: OpenSet<unknown>) =>
    next === open ? undefined : mount.controls.subject(next);
  const one = (id: unknown) => mount.controls.subject(id ?? null);
  return {
    options,
    many,
    all,
    selected: set.members(open).map(identity),
    active: set.active(open) === undefined ? null : identity(set.active(open)),
    unknown: !all && set.members(open).length < ids.length,
    clear: () => (many ? move({ kind: "ids", ids: [] }) : one(null)),
    toggle: (id: unknown) => (many ? move(set.toggle(open, id)) : one(id)),
    select: (ids: readonly unknown[]) => (many ? move(set.select(open, ids)) : one(ids.at(-1))),
    add: (more: readonly unknown[]) => (many ? move(set.add(open, more)) : one(more.at(-1))),
    remove: (id: unknown) => (many ? move(set.remove(open, id)) : one(null)),
    setActive: (id: unknown) => (many ? move(set.setActive(open, id)) : one(id)),
  };
}
export function AdmittedSubjectPicker({
  mount,
  data,
}: {
  mount: AdmittedMount;
  data: RouteGraphJson;
}) {
  const subject = subjectOf(mount, data);
  if (!subject) return null;
  const { options, many, all, selected, active, unknown } = subject;
  const noun = data.subject.noun;
  const open = options.filter((o) => selected.includes(identity(o.id)));
  return (
    <>
      {/* Many: every open subject is its own chip with its own ×; the trigger only adds. */}
      {many &&
        (all ? (
          <NarrowChip
            label={`All ${noun}`}
            title={`Every ${noun} is open`}
            onRemove={subject.clear}
          />
        ) : (
          open.map((o) => (
            <NarrowChip
              key={identity(o.id)}
              label={o.label}
              selected={identity(o.id) === active}
              title={`Close this ${noun}; the others stay open`}
              onRemove={() => subject.remove(o.id)}
            />
          ))
        ))}
      <ListPopup
        anchor="trigger"
        face="control"
        triggerLabel={`Choose ${noun}`}
        trigger={many ? `Choose ${noun}` : open.map((o) => o.label).join(", ") || `Choose ${noun}`}
        aria-label={noun}
        items={options}
        keyOf={(o) => identity(o.id)}
        labelOf={(o) => o.label}
        filter="substring"
        select={many ? "multi" : "single"}
        selected={selected}
        empty={`No ${noun} available`}
        row={(o) => ({ label: o.label })}
        onPick={(option) => subject.toggle(option.id)}
        onSelectedChange={
          many
            ? (keys) =>
                subject.select(
                  options.filter((o) => keys.includes(identity(o.id))).map((o) => o.id),
                )
            : undefined
        }
      />
      {many && (
        <>
          <Button label={`All ${noun}`} onClick={() => mount.controls.subject({ kind: "all" })}>
            All
          </Button>
          <Button label={`No ${noun}`} onClick={subject.clear}>
            None
          </Button>
        </>
      )}
      {unknown && (
        <span role="alert">Some selected {noun} are outside the current roster. Choose again.</span>
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
/** A reviewed command is a write: the one kit button draws it (ADR 0030 rule 6). */
const drawsWrite = (verb: RouteGraphJson["verbs"][string] | undefined) =>
  verb?.kind === "command" && verb.review === "shown";
/** The open Reject? window on this verb's receipt; the ActionJournal receipt is its only source. */
export function writeReject(
  entries: readonly TimelineEntry[],
  ids: readonly string[],
  reject: (thread: string, requestId: string) => void,
  boundThread?: string,
) {
  const open = projectTimeline(entries, {}).find((row) => {
    const key = (row.entry.basis as { receipt?: { key?: string } } | undefined)?.receipt?.key;
    return row.kind === "consent" && ids.includes(key ?? row.entry.verb ?? "");
  });
  if (!open) return null;
  const thread = consentThread(open.entry, boundThread);
  if (!thread) return null;
  const requestId = open.outcome!.consentWindow!.requestId;
  return {
    until: open.consentUntil ? `${secondsLeft(open.consentUntil)}s` : "awaiting approval",
    run: () => reject(thread, requestId),
  };
}
/** What a held plan says: armed only from a sealed Read; any consumed change makes it stale. */
export function writeHeld(
  label: string,
  review: {
    preview?: unknown;
    sentence: string | null;
    rows: readonly string[];
    cells?: readonly WriteCell[];
    stale: boolean;
  } | null,
) {
  if (!review) return { held: null, stale: null, sealed: false };
  if (review.stale) return { held: null, stale: "changed since plan", sealed: false };
  const sealed = writeResponseSchema.safeParse(review.preview).success;
  return {
    // ponytail: the plan is a Read today; rehearsed=true waits on a declared ducts.rehearse-* receipt.
    // Cells replace the rows they describe; rows remain for presenters with no cell source.
    held: review.cells?.length
      ? { word: writeWord(label, review.cells.length, false), summary: review.sentence ?? "", cells: review.cells }
      : { word: writeWord(label, review.rows.length, false), summary: review.sentence ?? "", rows: review.rows },
    stale: null,
    sealed,
  };
}
const settled = async (run: () => unknown): WriteRun => {
  try {
    await run();
    return null;
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
};
export function AdmittedWrite({ mount, data, id }: { mount: AdmittedMount; data: RouteGraphJson; id: string }) {
  const verb = data.verbs[id]!;
  const review = mount.review(id);
  const { held, stale, sealed } = writeHeld(verb.label, review);
  return (
    <WriteAction
      label={`plan ${verb.label}`}
      says={`Plan ${verb.label} from the current Work`}
      held={held}
      stale={stale}
      // A plan that refuses after invoke returned lands in the mount's refusal, never a second outcome.
      failed={review ? null : (mount.reviewRefusal(id)?.message ?? null)}
      plan={() => settled(() => mount.invoke(id, {}))}
      apply={{
        label: verb.label,
        says: `${verb.label} what the plan sealed`,
        refusal: sealed ? null : "Plan the current Work first",
        run: () => settled(() => mount.confirm(id)),
        done: `${verb.label} sent`,
      }}
      reject={writeReject(mount.timeline(), [id, "entry" in verb ? verb.entry : id], (thread, requestId) =>
        void harnessClient(resolveWorkbenchConfig().origin).permission(thread, requestId, "stop_writes"),
        typeof mount.page.read().thread === "string" ? String(mount.page.read().thread) : undefined,
      )}
    />
  );
}
export function AdmittedActions({
  mount,
  data,
  ids,
}: {
  mount: AdmittedMount;
  data: RouteGraphJson;
  ids: readonly string[];
}) {
  return (
    <>
      {ids.map((id) =>
        drawsWrite(data.verbs[id]) ? (
          <AdmittedWrite key={id} mount={mount} data={data} id={id} />
        ) : (
        <Button
          key={id}
          label={data.verbs[id]!.label}
          onClick={() => {
            void mount.invoke(id, undefined);
          }}
        >
          {data.verbs[id]!.label}
        </Button>
        ),
      )}
    </>
  );
}
function History({ mount, data }: { mount: AdmittedMount; data: RouteGraphJson }) {
  // The Timeline projection owns moves, starts, receipts and feed rows; only refused edits stay here.
  return (
    <section aria-label="History">
      <GraphHistory owner={mount} verbs={data.verbs} />
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
  const slot = usePaneActionSlot();
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
            alerts={
              <>
                {children}
                <PointerList route={data.key} />
                <CatalogWorkReviews mount={mount} />
              </>
            }
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
                      // Open-subject chips need their label width; the title keeps its floor.
                      fit: id === data.subject.pane ? "wrap" : undefined,
                      actions: (
                        <>
                          {id === data.subject.pane && (
                            <AdmittedSubjectPicker mount={mount} data={data} />
                          )}
                          {/* Pane-owned controls only: route verbs render once, in the situation band
                           * (kaitpw 2026-11-03); a pane's declared verbs are what its body may invoke. */}
                          {slot(id)}
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
                        </>
                      ),
                    },
                  ),
              ]),
            )}
          />
        )}
        {/* A write's plan draws in its own button's popover; only other reviews take a portal. */}
        {mount.reviewIds().filter((id) => !drawsWrite(data.verbs[id])).map((id) => {
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

export function admittedSubjectDoor(mount: AdmittedMount, data: RouteGraphJson): AdmittedSubject {
  const field = data.fields[data.subject.field];
  return {
    toggle: (id) => subjectOf(mount, data)?.toggle(id),
    add: (ids) => subjectOf(mount, data)?.add(ids),
    remove: (id) => subjectOf(mount, data)?.remove(id),
    setActive: (id) => subjectOf(mount, data)?.setActive(id),
    all: () => { mount.controls.subject({ kind: "all" }); },
    clear: () => { mount.controls.subject(field?.role === "subject" && field.cardinality === "many" ? { kind: "ids", ids: [] } : null); },
  };
}

export function AdmittedChrome(props: {
  mount: AdmittedMount;
  data: RouteGraphJson;
  children?: ReactNode;
}) {
  const navigation = useHasGlobalNavigation();
  const primary = useContext(HostedChrome) == null;
  const { mount, data } = props;
  // Read at call time, so the door never holds a stale subject.
  const door = useMemo<AdmittedSubject>(
    () => admittedSubjectDoor(mount, data),
    [mount, data],
  );
  return (
    <SubjectDoor.Provider value={door}>
      <PaneActionSlots>
        {navigation ? (
          <NavigatedChrome {...props} />
        ) : (
          <Chrome {...props} primary={primary} portal={false} />
        )}
      </PaneActionSlots>
    </SubjectDoor.Provider>
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
