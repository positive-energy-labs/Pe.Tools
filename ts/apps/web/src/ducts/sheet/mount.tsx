import { renderPicturePane } from "#/scene/picture/picture";
import { EspParameter } from "./esp-parameter";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { StateCell, cellFromDraft } from "@pe/kit/lang/cell";
import { reviewTransitions } from "#/components/work/band";
import { ChoiceCell } from "./choice-cell.tsx";
import { Button } from "@pe/kit/lang/button";
import { suggestKind, suggestRole } from "@pe/ducts-domain/roster";
import { AttentionRoot } from "#/attention";
import { PointerCite } from "#/shell/pointer-list";
import { pointerRefs } from "../pointer-refs";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { NativeObservationScope } from "#/revit/observation";
import { useRouteSearchSlice } from "#/route/activity";
import { picturePageMove } from "#/shell/picture-page";
import { useAdmittedSubject } from "#/shell/subject";

import type { DuctsSheetEdits, PicturePage, RouteStatePatch } from "@pe/agent-contracts";
import { cellPatches } from "@pe/agent-contracts";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import * as Atom from "effect/reactivity/Atom";
import { useMemo, useRef } from "react";
import type { FansDrawContext } from "../../fans/route.ts";
import { projectValue } from "../../route/typed-route.ts";
import { fansDocumentSchema } from "@pe/agent-contracts";
const scopeSchema = fansDocumentSchema.shape.writeIntent.unwrap().shape.edit.unwrap().unwrap().shape.value;
import { attentionSubjects } from "../cell-focus";
import { localId, localSubject, namesOf } from "../neutral.ts";
import { ductsLink } from "../neutral.ts";
import { subjectNamer } from "../subject-text";
import { describeCloser, type Closer } from "./closer";
import { editLabel, presentInputHistory, type EditMeta } from "./input-history.neutral";
import { InputsSurface } from "./inputs-surface";
import { rosterOrder, stableFanKey, type FanPort } from "./model";
import { SheetPicture } from "./picture";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { sheetSystems } from "./scoped-snapshot.ts";
import { EMPTY_SHEET_STATE } from "./state";
import { Ledger, Roster } from "./view";
type SheetContext = FansDrawContext;
function readingsOf(ctx: SheetContext) {
  return {
    sheet: ctx.value,
    fans: projectValue(ctx.value, (value) => value.fans),
    sheetSnapshot: projectValue(ctx.value, (value) => value.sheetSnapshot),
    sheetView: projectValue(ctx.value, (value) => value.sheetView),
  };
}
function useSheetData(ctx: SheetContext, snapshot: DuctSnapshot) {
  const authored = ctx.page.read();
  const reading = readingsOf(ctx).sheet;
  const value = reading.value;
  const sheet = value?.open ?? null;
  const fans = readingsOf(ctx).fans;
  const roster = rosterOrder(
    value?.rows ?? fans.value?.rows ?? [],
  );
  const nameOf = useMemo(() => subjectNamer(snapshot), [snapshot]);
  const selected = authored.selected.map(({ id }) => localSubject(id)).join(",");
  const changeInputs = async (
    edits: DuctsSheetEdits,
    history: EditMeta = { label: editLabel(edits, nameOf) },
  ) => {
    return ctx.cells.edit(edits, history).then((result) => result ?? undefined);
  };
  return {
    authored,
    snapshot,
    reading,
    value,
    sheet,
    fans,
    roster,
    nameOf,
    selected,
    changeInputs,
    busy: reading.status === "pending",
  };
}
const FAN_CELLS = ["terminalDrops", "componentDrops", "esp", "flows", "equipmentFlows"] as const;
/**
 * The person's explicit fan write scope (lossReady needs `writeIntent.walk`). Offered from the HOST
 * sheet's open fan and the cells staged on elements of that sheet's snapshot; staged only on a pick,
 * never from the Page or a plan. Another fan's standing scope is shown, not replaced on navigation.
 */
function WriteScope({
  ctx,
  snapshot,
  fan,
  write,
}: {
  ctx: SheetContext;
  snapshot: DuctSnapshot;
  fan: { unitId: number; portIndex: number; mark: string } | null;
  write: (
    patches: RouteStatePatch[],
    history?: EditMeta,
  ) => Promise<{ code: string; message: string } | null>;
}) {
  const intent = ctx.cells.doc?.writeIntent ?? {};
  const standing = intent.edit?.value;
  const here = new Set([...snapshot.nodes, ...snapshot.segments].map((e) => String(e.id)));
  const cells = FAN_CELLS.flatMap((segment) =>
    Object.entries(ctx.cells.doc?.[segment] ?? {})
      .filter(([id, cell]) => cell.edit != null && here.has(id))
      .map(([id]) => [segment, id] as [(typeof FAN_CELLS)[number], string]),
  );
  const offered = fan
    ? scopeSchema.safeParse({
        walk: { unitId: fan.unitId, portIndex: fan.portIndex },
        ...(cells.length ? { cells } : {}),
      })
    : null;
  const mine =
    !!fan && standing?.walk?.unitId === fan.unitId && standing.walk.portIndex === fan.portIndex;
  const current = mine ? "fan" : standing ? "other" : "none";
  const label = (value: unknown) => {
    const v = value as typeof standing;
    if (!v?.walk) return "None";
    return `${v.walk.unitId === fan?.unitId && v.walk.portIndex === fan?.portIndex ? fan.mark : `unit ${v.walk.unitId}`} · ${v.cells?.length ?? 0} staged`;
  };
  return (
    <span data-sheet-cell="Write scope" className="contents">
      <span>Write scope</span>
      <ChoiceCell
        label="Write scope"
        options={[
          ...(offered?.success
            ? [
                {
                  key: "fan",
                  label: label(offered.data),
                  description: "Write this fan's walk and its staged cells",
                },
              ]
            : []),
          ...(current === "other"
            ? [
                {
                  key: "other",
                  label: label(standing),
                  description: "Another fan's scope, still standing",
                },
              ]
            : []),
          { key: "none", label: "None", description: "Clear the write scope" },
        ]}
        current={current}
        cell={intent}
        path={null}
        show={label}
        refusal={
          !ctx.cells.ready
            ? "Read Work before editing"
            : !offered?.success
              ? "Open a fan first"
              : null
        }
        pick={(key) => {
          if (key === "fan" && offered?.success && ctx.cells.basis)
            void ctx.cells.patch([{ path: ["writeIntent"], value: { edit: { value: offered.data } } }], { label: "Choose write scope" });
          if (key === "none" && intent.edit)
            void write(cellPatches([], "writeIntent", intent, { kind: "clear" }), {
              label: "Clear write scope",
            });
        }}
      />
      <span />
    </span>
  );
}
export function RosterBody({
  ctx,
}: {
  ctx: SheetContext;
}) {
  const authored = ctx.page.read();
  const snapshot = sheetSnapshot(readingsOf(ctx).sheetSnapshot);
  const fans = readingsOf(ctx).fans;
  const roster = rosterOrder(
    readingsOf(ctx).sheet.value?.rows ?? fans.value?.rows ?? [],
  );
  const busy = readingsOf(ctx).sheet.status === "pending";
  const nameOf = useMemo(
    () => ("kind" in snapshot ? (id: number) => String(id) : subjectNamer(snapshot)),
    [snapshot],
  );
  const subject = useAdmittedSubject();
  const open = (row: FanPort) => subject?.toggle(localId("ducts-fan", stableFanKey(row)));
  const pickedFans = namesOf(authored.fan);
  const search = useRouteSearchSlice((search) => search);
  const ownPane = (
    <>
      <Roster
        props={{
          address: {
            scope: "fans",
            search: authored.rosterSearch,
            sort: authored.rosterSort,
            onChange: (rosterSearch, rosterSort) => ctx.page.query({ rosterSearch, rosterSort }),
          },
          nameOf,
          roster: roster,
          picked: pickedFans === "all" ? roster.map(stableFanKey) : pickedFans,
          open: open,
          busy: busy,
          loading: fans.status === "pending",
        }}
      />
      {("kind" in snapshot ? [] : sheetSystems(snapshot)).map((name) => (
        <a key={name} href={ductsLink([name], search)}>
          {name}
        </a>
      ))}
    </>
  );
  return (
    <SheetFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf}>
      {ownPane}
    </SheetFrame>
  );
}
function SheetEmpty({
  readings,
}: {
  readings: Pick<ReturnType<typeof readingsOf>, "sheetSnapshot" | "sheet">;
}) {
  if (readings.sheetSnapshot.status === "failed")
    return <p role="alert">{readings.sheetSnapshot.reason}</p>;
  return readings.sheetSnapshot.status === "pending" || readings.sheet.status === "pending" ? (
    <p role="status">computing</p>
  ) : (
    <p>Open a fan from the roster.</p>
  );
}
export function InputsBody({
  ctx,
}: {
  ctx: SheetContext;
}) {
  const snapshot = sheetSnapshot(readingsOf(ctx).sheetSnapshot);
  return "kind" in snapshot ? (
    <SheetEmpty readings={readingsOf(ctx)} />
  ) : (
    <InputsContent ctx={ctx} snapshot={snapshot} />
  );
}
function InputsContent({
  ctx,
  snapshot,
}: {
  ctx: SheetContext;
  snapshot: DuctSnapshot;
}) {
  const { sheet, fans, nameOf, selected, changeInputs, busy } = useSheetData(ctx, snapshot);
  const workDoc = sheetWork(ctx);
  const write = async (patches: RouteStatePatch[], history?: EditMeta) => {
    return ctx.cells.patch(patches, history);
  };
  const state = readingsOf(ctx).sheetView.value ?? EMPTY_SHEET_STATE;
  const selectedNumber = Number(selected.replaceAll('"', ""));
  const focused = state.blockers.find((blocker) => blocker.id === selected);
  const elementId =
    focused?.elementId ??
    (Number.isInteger(selectedNumber) && selectedNumber > 0 ? selectedNumber : null);
  const element =
    elementId == null
      ? null
      : {
          id: elementId,
          family: snapshot.nodes.find((node) => node.id === elementId)?.family ?? null,
        };
  const history = {
    ...presentInputHistory(ctx.cells.history?.entries ?? [], null),
    undo: () => {
      void ctx.cells.history?.undo();
    },
    redo: () => {
      void ctx.cells.history?.redo();
    },
    restore: (press: string) => {
      void ctx.cells.history?.undo(press);
    },
  };
  const fanReading = fans.value;
  const friction = ctx.cells.doc?.designFriction ?? {};
  const parameterTarget = ctx.cells.basis?.token.scope.identity.target;
  const ownPane = (
    <>
      <section
        aria-label="Fan settings"
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto] items-center gap-x-2 gap-y-1 p-1"
      >
        <WriteScope ctx={ctx} snapshot={snapshot} fan={sheet?.overview.fan ?? null} write={write} />
        <span data-sheet-cell="Design friction" aria-label="Design friction" className="contents">
          <span>Design friction</span>
          <span className="block min-w-0 h-(--item-h)">
            <StateCell
              {...cellFromDraft(friction, {
                value: String(friction.edit?.value ?? DEFAULT_DESIGN_FRICTION_RATE),
                cap: ctx.cells.ready ? "editable" : "locked",
                capReason: "Read Work before editing",
              })}
              scale="row"
              numeric={{ min: 0, digits: 3 }}
              unit={{ label: "in-wg/100 ft" }}
              onCommit={(text: string) =>
                write(
                  cellPatches([], "designFriction", friction, {
                    kind: "set",
                    rung: { value: Number(text) },
                  }),
                  { label: "Design friction" },
                ).then((result) => result?.message)
              }
              transitions={reviewTransitions(
                {
                  segment: null,
                  revision: ctx.cells.basis?.workRevision ?? null,
                  write: (patches) => write(patches, { label: "Design friction" }),
                },
                "designFriction",
                friction,
              )}
            />
          </span>
          <span
            className="t-small text-ink-2"
            data-input-source={friction.edit ? "Work" : "default"}
          >
            {friction.edit ? "Work" : "default"}
          </span>
        </span>
        {(
          [
            ["fanStatic", "Unit ESP"],
            ["terminalDrop", "Grille drop"],
            ["componentDrop", "Component drop"],
            ["fittingCoefficient", "Fitting coefficient"],
          ] as const
        ).map(([key, label]) => {
          const cell = ctx.cells.doc?.parameters[key] ?? {};
          const commit = (value: string) => write(
            cellPatches(["parameters"], key, cell, { kind: "set", rung: { value } }), { label },
          ).then((result) => result?.message);
          const transitions = reviewTransitions({
            segment: "parameters", revision: ctx.cells.basis?.workRevision ?? null,
            write: (patches) => write(patches, { label }),
          }, key, cell);
          return (
            <label key={key} className="contents">
              <span className="min-w-0 truncate">{label}</span>
              <span className="block min-w-0 h-(--item-h)">
                {key === "fanStatic" ? (
                  <EspParameter
                    target={parameterTarget?.kind === "document" ? parameterTarget.ref : null}
                    units={snapshot.nodes
                      .filter((node) => node.kind === "equipment")
                      .flatMap((node) => (node.uniqueId ? [node.uniqueId] : []))}
                    cell={cell}
                    model={snapshot.slots[key]}
                    commit={commit}
                    transitions={transitions}
                  />
                ) : (
                  <StateCell
                    {...cellFromDraft(cell, {
                      value: cell.edit ? String(cell.edit.value) : snapshot.slots[key],
                      modelValue: snapshot.slots[key],
                      cap: "editable",
                    })}
                    scale="row"
                    onCommit={commit}
                    transitions={transitions}
                  />
                )}
              </span>
              <span />
            </label>
          );
        })}
        {snapshot.nodes
          .filter((node) => node.kind === "equipment")
          .map((node) => {
            const key = String(node.id);
            const cell = ctx.cells.doc?.roles[key] ?? {};
            const label = `Unit role ${nameOf(node.id)}`;
            return (
              <label key={key} className="contents">
                <span className="min-w-0 truncate">{label}</span>
                <ChoiceCell
                  label={label}
                  cell={cell}
                  path={["roles", key]}
                  show={(value) => String((value as { role: string }).role)}
                  current={
                    cell.edit?.value.role ??
                    sheet?.inputs?.inputs.units[key]?.role.value ??
                    suggestRole(node, suggestKind(node).kind)
                  }
                  options={[
                    { key: "fan", label: "Fan" },
                    { key: "passive", label: "Passive" },
                  ]}
                  refusal={ctx.cells.ready ? null : "Read the current Value and Work before editing"}
                  pick={(role) =>
                    void write(
                      cellPatches(["roles"], key, cell, { kind: "set", rung: { value: { role } } }),
                      { label },
                    )
                  }
                  act={async (_path, cell, kind) =>
                    write(cellPatches(["roles"], key, cell, { kind }), { label })
                  }
                />
                {cell.edit ? (
                  <Button
                    label="Clear unit role"
                    onClick={() =>
                      void write(cellPatches(["roles"], key, cell, { kind: "clear" }), { label })
                    }
                  >
                    Clear
                  </Button>
                ) : (
                  <span />
                )}
              </label>
            );
          })}
      </section>
      <InputsSurface
        ctx={{
          snapshot,
          doc: workDoc,
          revision: ctx.cells.basis?.workRevision ?? null,
          sheet,
          inputs: state.inputs,
          firm: state.firm,
          fittings: sheet?.inputs?.fittings ?? [],
          tableTitles: sheet?.inputs?.tableTitles ?? {},
          slots: fanReading?.slots ?? [],
          activeSlot: fanReading?.activeSlot ?? "",
          element,
        }}
        busy={busy}
        elementName={element ? nameOf(element.id) : null}
        onSlot={(key, slot) => {
          void write(
            cellPatches(["parameters"], key, workDoc?.parameters[key] ?? {}, {
              kind: "set",
              rung: { value: slot },
            }),
            { label: `${key} → ${slot}` },
          );
        }}
        apply={changeInputs}
        history={history}
        nameOf={nameOf}
        act={async (path, cell, kind, label) => {
          return write(cellPatches(path.slice(0, -1), path.at(-1)!, cell, { kind }), {
            label: `${kind} Pea's ${label}`,
          });
        }}
      />
    </>
  );
  return (
    <SheetFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf}>
      {ownPane}
    </SheetFrame>
  );
}
export function PictureBody({
  ctx,
}: {
  ctx: SheetContext;
}) {
  const snapshot = sheetSnapshot(readingsOf(ctx).sheetSnapshot);
  return "kind" in snapshot ? (
    <SheetEmpty readings={readingsOf(ctx)} />
  ) : (
    <PictureContent ctx={ctx} snapshot={snapshot} />
  );
}
function PictureContent({
  ctx,
  snapshot,
}: {
  ctx: SheetContext;
  snapshot: DuctSnapshot;
}) {
  const { authored, value, sheet, fans, roster, nameOf, selected } = useSheetData(ctx, snapshot);
  const target = ctx.cells.basis?.token.scope.identity.target;
  const doc = target?.kind === "document" ? target.ref : null;
  const workDoc = sheetWork(ctx);
  const select = (selected: string) =>
    ctx.selection.set(selected ? [{ kind: "focus", id: localId("ducts-focus", selected) }] : []);
  const setPage = picturePageMove<PicturePage<string, "schematic">>(
    (patch, intent) => ctx.page.pose(patch, intent),
    select,
  );
  const selection = useMemo(
    () => Atom.make(attentionSubjects(authored.selected.map(({ id }) => localSubject(id)))),
    [authored.selected],
  );
  const pickedFans = namesOf(authored.fan);
  const nativeSnapshot = readingsOf(ctx).sheetSnapshot.value;
  const captureSource =
    readingsOf(ctx).fans.current &&
    doc &&
    nativeSnapshot &&
    !("kind" in nativeSnapshot) &&
    nativeSnapshot.sourceVersion
      ? { document: doc, version: nativeSnapshot.sourceVersion }
      : null;
  const state = readingsOf(ctx).sheetView.value ?? EMPTY_SHEET_STATE;
  const jump = useRef<((key: SubjectKey) => void) | null>(null);
  const fanId = (row: FanPort) => localId("ducts-fan", stableFanKey(row));
  const ownPane = ((renderPane: TeachingPaneRender) => (
    <SheetPicture
      props={{
        page: { ...authored, selected, issue: selected },
        setPage,
        work: { doc: workDoc },
        selection,
        captureSource,
        doc,
        refreshing: !fans.current,
      }}
      snapshot={snapshot}
      sheet={sheet}
      opened={value?.opened}
      fans={roster.filter((row) => pickedFans === "all" || pickedFans.includes(stableFanKey(row)))}
      blockers={state.blockers}
      systemFans={(system) => {
        // A system's fans: the units on the runs that price it, or the roster's own word.
        const units = systemScope(snapshot, system).units;
        return roster.filter((row) => row.system === system || units.has(row.unitId)).map(fanId);
      }}
      renderPane={renderPane}
      jump={jump}
    />
  ))(renderPicturePane);
  return (
    <SheetFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf} jump={jump}>
      {ownPane}
    </SheetFrame>
  );
}
export function LedgerBody({
  ctx,
}: {
  ctx: SheetContext;
}) {
  const snapshot = sheetSnapshot(readingsOf(ctx).sheetSnapshot);
  return "kind" in snapshot ? (
    <SheetEmpty readings={readingsOf(ctx)} />
  ) : (
    <LedgerContent ctx={ctx} snapshot={snapshot} />
  );
}
function LedgerContent({
  ctx,
  snapshot,
}: {
  ctx: SheetContext;
  snapshot: DuctSnapshot;
}) {
  const { reading, sheet, fans, roster, nameOf, selected, changeInputs, busy } = useSheetData(
    ctx,
    snapshot,
  );
  const select = (selected: string) =>
    ctx.selection.set(selected ? [{ kind: "focus", id: localId("ducts-focus", selected) }] : []);
  const state = readingsOf(ctx).sheetView.value ?? EMPTY_SHEET_STATE;
  const closerOf = (blocker: import("./tiers").SheetBlocker, typed: number | null): Closer => {
    const closer = describeCloser(blocker, typed, {
      terminalDrop: state.inputs?.criteria.terminalDropInWg ?? null,
      nameOf,
      wait: busy
        ? "Wait for the current read"
        : sheet?.inputs && reading.current
          ? null
          : "Reading inputs detail",
      fan: sheet?.overview.fan
        ? {
            unitId: sheet.overview.fan.unitId,
            name: sheet.overview.fan.mark || nameOf(sheet.overview.fan.unitId),
          }
        : null,
      receiving: ({ elementId, connector }) => {
        const fan = sheet?.inputs?.ends.find(
          (end) =>
            end.kind !== "terminal" &&
            end.elementId === elementId &&
            (end.connector ?? null) === (connector ?? null),
        )?.fan;
        if (!fan || fan.unitId === sheet?.overview.fan?.unitId) return null;
        const mark = roster.find((row) => row.unitId === fan.unitId)?.mark;
        return { unitId: fan.unitId, name: mark || nameOf(fan.unitId) };
      },
      fittingOf: (key) => sheet?.inputs?.fittings.find((f) => f.key === key) ?? null,
      tableTitles: sheet?.inputs?.tableTitles ?? {},
    });
    const labelled = (verb: string, action: Closer["action"]) =>
      action ? ctx.cells.label(editsFor([{ ...closer, action }]), verb) : verb;
    return {
      ...closer,
      verb: labelled(closer.verb, closer.action),
      secondary: closer.secondary && { ...closer.secondary, verb: labelled(closer.secondary.verb, closer.secondary.action) },
      crossing: closer.crossing && { ...closer.crossing, verb: labelled(closer.crossing.verb, closer.crossing.action) },
      choices: closer.choices?.map((choice) => ({ ...choice, verb: labelled(choice.verb, choice.action) })),
    };
  };
  const editsFor = (closers: readonly Closer[]) =>
    closers.reduce<DuctsSheetEdits>((edits, closer) => {
      if (closer.refusal || !closer.action) return edits;
      const action = closer.action;
      switch (action.kind) {
        case "drop":
          return action.terminal
            ? {
                ...edits,
                terminalDrops: {
                  ...edits.terminalDrops,
                  [action.elementId]: { inWg: action.value },
                },
              }
            : {
                ...edits,
                componentDrops: {
                  ...edits.componentDrops,
                  [action.elementId]: { inWg: action.value },
                },
              };
        case "cfm":
          return { ...edits, flows: { ...edits.flows, [action.elementId]: { cfm: action.value } } };
        case "unitCfm":
          return {
            ...edits,
            equipmentFlows: { ...edits.equipmentFlows, [action.unitId]: { cfm: action.value } },
          };
        case "rule":
          return {
            ...edits,
            joins: [...(edits.joins ?? []), { pair: [...action.pair], verdict: "accept" }],
          };
        case "cap":
          return { ...edits, ends: [...(edits.ends ?? []), { end: action.end, verdict: "capped" }] };
        case "price":
          return {
            ...edits,
            assignments: { ...edits.assignments, [action.family]: { rule: action.rule } },
            ...(action.table ? { tables: { ...edits.tables, [action.rule]: { table: action.table } } } : {}),
          };
        case "table":
          return { ...edits, tables: { ...edits.tables, [action.rule]: { table: action.table } } };
        case "pathDrop":
          return { ...edits, fittingDrops: { ...edits.fittingDrops, [action.key]: { inWg: action.value } } };
      }
    }, {});
  const ownPane = (
    <Ledger
      props={{
        sheet: sheet,
        blockers: state.blockers,
        taken: state.taken,
        inputs: state.inputs,
        busy: busy,
        loading: fans.status === "pending",
        error:
          (reading.status === "failed" ? reading.reason : null) ??
          (fans.status === "failed" ? fans.reason : null),
        changeInputs: changeInputs,
        closerOf: closerOf,
        close: (closer: Closer) => changeInputs(editsFor([closer]), { label: closer.verb }),
        closeMany: (closers: readonly Closer[]) => changeInputs(editsFor(closers)),
        focusedBlocker: selected || null,
        focusBlocker: (issue: string | null) => {
          select(issue ?? "");
        },
      }}
    />
  );
  return (
    <SheetFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf}>
      {ownPane}
    </SheetFrame>
  );
}
/** Drawing consumers own a mutable clone; the kernel retains immutable evidence. */
export function sheetSnapshot(
  reading: ReturnType<typeof readingsOf>["sheetSnapshot"],
): (DuctSnapshot & { sourceVersion?: string }) | { kind: "absent" };
export function sheetSnapshot(reading: { value?: unknown }): unknown {
  return structuredClone(reading.value ?? { kind: "absent" });
}
function sheetWork(ctx: SheetContext) {
  return ctx.value.value?.design ?? null;
}
function SheetFrame({
  ctx,
  snapshot,
  nameOf,
  jump,
  children,
}: {
  ctx: SheetContext;
  snapshot: DuctSnapshot | { kind: "absent" };
  nameOf: ReturnType<typeof subjectNamer>;
  jump?: import("react").RefObject<((key: SubjectKey) => void) | null>;
  children: import("react").ReactNode;
}) {
  const target = ctx.cells.basis?.token.scope.identity.target;
  const document = target?.kind === "document" ? target.ref : null;
  const attentionDoc = document ? `${document.session}/${document.openId}` : "fans:unbound";
  const refProps = useRevitSubjectProps();
  const go = (id: number) =>
    jump?.current
      ? jump.current(elementKey(id))
      : ctx.selection.set([{ kind: "focus", id: localId("ducts-focus", String(id)) }]);
  return (
    <AttentionRoot doc={attentionDoc}>
      {"kind" in snapshot ? null : (
        <PointerCite
          route="fans"
          refs={(place) => pointerRefs(place, snapshot, attentionDoc, (id) => nameOf(id))}
        />
      )}
      <SubjectTextContext.Provider value={{ doc: attentionDoc, nameOf, go, refProps }}>
        <NativeObservationScope
          value={{
            scope: {
              document: readingsOf(ctx).sheetSnapshot.current ? document : null,
              source: "native",
            },
            references: ("kind" in snapshot ? [] : [...snapshot.nodes, ...snapshot.segments]).map(
              ({ id, uniqueId }) => ({
                elementId: id,
                uniqueId,
              }),
            ),
          }}
        >
          {children}
        </NativeObservationScope>
      </SubjectTextContext.Provider>
    </AttentionRoot>
  );
}
