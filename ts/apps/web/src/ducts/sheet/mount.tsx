import { subjectLink } from "../subject-link";
import { useRouteSearchSlice } from "#/route/activity";
import { useMemo, useRef } from "react";
import * as Atom from "effect/reactivity/Atom";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { transitionPatches } from "@pe/agent-contracts";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { AttentionRoot } from "#/attention";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { PaneActions } from "#/shell/pane-actions";
import { useProtoPage, type ProtoProps } from "../proto/props";
import { subjectNamer } from "../subject-text";
import { rosterOrder, stableFanKey, withComputed, type FanPort } from "./model";
import { EMPTY_SNAPSHOT } from "./scoped-snapshot";
import { InputsSurface } from "./inputs-surface";
import { SheetPicture } from "./picture";
import type { SheetViewProps } from "./types";
import { Roster, Ledger } from "./view";
import { sheetState } from "./state";
import { describeCloser, type Closer } from "./closer";
import type { DuctsSheetEdits } from "@pe/agent-contracts";
import { localId, localSubject, namesOf, activeName } from "../neutral.ts";
import { fansData, schemas, entries } from "../../fans/neutral";
import type { PaneContext } from "../../../../../packages/agent-contracts/src/route-kernel-bodies";
import { settleWork } from "#/shell/work-door-observation";
import { ductsDesign, neutralFansWork, type RouteStatePatch } from "@pe/agent-contracts";
import { NativeObservationScope } from "#/revit/observation";
import { editLabel, presentInputHistory, type EditMeta } from "./input-history";

type SheetContext = PaneContext<
  typeof fansData,
  typeof schemas,
  typeof entries,
  keyof typeof fansData.panes
>;
/** Shared spine only. U1b replaces this dictionary with bodies for each pane. */
export function SheetBody({
  ctx,
  id,
  open,
}: {
  ctx: SheetContext;
  id: keyof typeof fansData.panes;
  open: SheetViewProps["open"];
}) {
  const authored = ctx.page.read();
  const target = ctx.workBasis?.token.scope.identity.target;
  const doc = target?.kind === "document" ? target.ref : null;
  const snapshotRead = ctx.readings.sheetSnapshot;
  // Domain readonly sweep reached 28 files; picture consumers still require mutable arrays.
  const snapshot = (snapshotRead.value ??
    EMPTY_SNAPSHOT) as import("@pe/ducts-domain/types").DuctSnapshot;
  // U4 wires the real fans Work here.
  const workDoc = useMemo(() => ductsDesign(ctx.work, neutralFansWork), [ctx.work]);
  const setPage = useProtoPage(ctx.page, ctx.verbs.browse);
  const write = async (patches: RouteStatePatch[], history?: EditMeta) => {
    if (!ctx.workBasis)
      return { code: "unavailable", message: "Read this document's Work before editing" };
    const result = await settleWork(ctx.verbs.edit({ patches, history }, ctx.workBasis));
    return result.kind === "refused" ? { code: "refused", message: result.refusal.error } : null;
  };
  const selected = authored.selected.map(({ id }) => localSubject(id)).join(",");
  const selection = useMemo(
    () =>
      Atom.make<ReadonlySet<SubjectKey>>(
        new Set<SubjectKey>(
          authored.selected.map(({ id }): SubjectKey => {
            const name = localSubject(id);
            if (/^\d+$/.test(name)) return elementKey(name);
            const colon = name.indexOf(":");
            return colon < 0 ? `issue:${name}` : `${name.slice(0, colon)}:${name.slice(colon + 1)}`;
          }),
        ),
      ),
    [authored.selected],
  );
  const system = namesOf(authored.system);
  const props: Pick<
    ProtoProps,
    | "page"
    | "setPage"
    | "snapshot"
    | "attentionDoc"
    | "onSelect"
    | "work"
    | "selection"
    | "captureSource"
    | "doc"
    | "reading"
    | "priced"
  > = {
    // readonly at the contract owner after U2 lands; U1b removes the remaining picture Page shape.
    page: {
      ...authored,
      stage: "sheet",
      system: system === "all" ? [] : system,
      active: activeName(authored.system, []),
      fan: namesOf(authored.fan),
      selected,
      heal: null,
    } as ProtoProps["page"],
    setPage,
    snapshot,
    attentionDoc: doc ? `${doc.session}/${doc.openId}` : "fans:unbound",
    onSelect: (id) => setPage({ selected: id === null ? "" : String(id) }),
    work: {
      doc: workDoc,
      revision: ctx.workBasis?.workRevision ?? null,
      write: (patches) => write(patches),
    },
    selection,
    doc,
    priced: null,
    captureSource:
      ctx.readings.fans.current && doc && snapshotRead.value?.sourceVersion
        ? { document: doc, version: snapshotRead.value.sourceVersion }
        : null,
    reading: {
      pending: snapshotRead.status === "pending",
      error: snapshotRead.status === "failed" ? snapshotRead.reason : null,
      refreshing: !ctx.readings.fans.current,
    },
  };
  const search = useRouteSearchSlice((search) => search);
  const reading = ctx.readings.sheet;
  // readonly at the contract owner after U2 lands
  const value = reading.value as import("../neutral").SheetReading | undefined;
  const sheet = value?.open ?? null;
  const fans = ctx.readings.fans;
  // One computation: the roster's status reads the same sheet value the ledger draws.
  const roster = rosterOrder(
    withComputed(fans.value?.rows ?? value?.rows ?? [], value?.rows ?? []),
  );
  const state = useMemo(() => sheetState(sheet), [sheet]);
  const nameOf = useMemo(() => subjectNamer(snapshot), [snapshot]);
  const refProps = useRevitSubjectProps();
  const jump = useRef<((key: SubjectKey) => void) | null>(null);
  const subjects = useMemo(
    () => ({
      doc: props.attentionDoc,
      nameOf,
      go: (id: number) => (jump.current ? jump.current(elementKey(id)) : props.onSelect(id)),
      refProps,
    }),
    [props.attentionDoc, nameOf, props.onSelect, refProps],
  );
  const fanId = (row: FanPort) => localId("ducts-fan", stableFanKey(row));
  const busy = reading.status === "pending";
  const changeInputs = async (
    edits: DuctsSheetEdits,
    history: EditMeta = { label: editLabel(edits, nameOf) },
  ) => {
    if (!ctx.workBasis)
      return { code: "unavailable", message: "Read this document's Work before editing" };
    const result = await settleWork(
      ctx.verbs.sheetEdit({ edits, history, basis: sheet?.overview.basis ?? null }, ctx.workBasis),
    );
    return result.kind === "refused"
      ? { code: "refused", message: result.refusal.error }
      : undefined;
  };
  const closerOf = (blocker: import("./tiers").SheetBlocker, typed: number | null) =>
    describeCloser(blocker, typed, {
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
  const editsFor = (closers: readonly Closer[]) =>
    closers.reduce<DuctsSheetEdits>((edits, closer) => {
      if (closer.refusal || !closer.action) return edits;
      const action = closer.action;
      switch (action.kind) {
        case "rule":
          return {
            ...edits,
            joins: [...(edits.joins ?? []), { pair: action.pair, verdict: "accept" }],
          };
        case "cap":
          return {
            ...edits,
            ends: [...(edits.ends ?? []), { end: action.end, verdict: "capped" }],
          };
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
        case "price":
          return {
            ...edits,
            assignments: { ...edits.assignments, [action.family]: { rule: action.rule } },
            ...(action.table
              ? { tables: { ...edits.tables, [action.rule]: { table: action.table } } }
              : {}),
          };
        case "table":
          return { ...edits, tables: { ...edits.tables, [action.rule]: { table: action.table } } };
        case "pathDrop":
          return {
            ...edits,
            fittingDrops: { ...edits.fittingDrops, [action.key]: { inWg: action.value } },
          };
      }
    }, {});
  const selectedNumber = Number(props.page.selected.replaceAll('"', ""));
  const focused = state.blockers.find((blocker) => blocker.id === props.page.selected);
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
    ...presentInputHistory(ctx.history?.entries ?? [], null),
    undo: () => {
      void ctx.history?.undo();
    },
    redo: () => {
      void ctx.history?.redo();
    },
    restore: (press: string) => {
      void ctx.history?.undo(press);
    },
  };
  const fanReading = fans.value;
  const spine: SheetViewProps = {
    ...state,
    snapshot,
    roster,
    picked: props.page.fan === "all" ? roster.map(stableFanKey) : props.page.fan,
    open,
    sheet,
    slots: fanReading?.slots ?? [],
    activeSlot: fanReading?.activeSlot ?? "",
    busy,
    loading: fans.status === "pending",
    error:
      (reading.status === "failed" ? reading.reason : null) ??
      (fans.status === "failed" ? fans.reason : null),
    progress: value?.progress ?? null,
    refresh: () => {
      props.setPage({ sheetPath: props.page.sheetPath });
    },
    changeInputs,
    rule: (proposal) => changeInputs({ joins: [proposal] }),
    pickPath: (sheetPath) => {
      props.setPage({ sheetPath });
    },
    closerOf,
    close: (closer) => changeInputs(editsFor([closer]), { label: closer.verb }),
    closeMany: (closers) => changeInputs(editsFor(closers)),
    focusedBlocker: props.page.selected || null,
    focusBlocker: (issue) => {
      props.setPage({ selected: issue ?? "" }, { history: "push" });
    },
    picture: (renderPane) => (
      <SheetPicture
        props={props}
        snapshot={snapshot}
        sheet={sheet}
        opened={value?.opened}
        fans={roster.filter(
          (row) => props.page.fan === "all" || props.page.fan.includes(stableFanKey(row)),
        )}
        blockers={state.blockers}
        systemFans={(system) => {
          // A system's fans: the units on the runs that price it, or the roster's own word.
          const units = systemScope(snapshot, system).units;
          return roster.filter((row) => row.system === system || units.has(row.unitId)).map(fanId);
        }}
        renderPane={renderPane}
        jump={jump}
      />
    ),
    inputsSurface: (
      <InputsSurface
        ctx={{
          snapshot,
          doc: props.work.doc,
          revision: props.work.revision,
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
            transitionPatches(["parameters"], key, props.work.doc?.parameters[key] ?? {}, {
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
          if (path.length === 1) {
            // temporary: criteria writer moves to fans with its cells (U2/U3, Q2a)
            return write(transitionPatches([], path[0], cell, { kind }), {
              label: `${kind} Pea's ${label}`,
            });
          }
          // U4 moves parameter cells and their writer to the fans Work.
          if (path[0] === "parameters")
            return { code: "unavailable", message: "Fan parameter editing is unavailable" };
          const result = await settleWork(ctx.cells[kind](path[0], path[1]));
          return result.kind === "refused"
            ? { code: "refused", message: result.refusal.error }
            : null;
        }}
      />
    ),
  };
  const panes = {
    "sheet-roster": (
      <>
        <Roster props={spine} />
        {[
          ...new Set(
            [...snapshot.nodes, ...snapshot.segments]
              .map((row) => row.systemName)
              .filter((name): name is string => !!name),
          ),
        ].map((name) => (
          <a key={name} href={subjectLink("ducts", [name], search)}>
            {name}
          </a>
        ))}
      </>
    ),
    "sheet-inputs": spine.inputsSurface,
    "sheet-picture": spine.picture((body, furniture) => (
      <>
        {body}
        <PaneActions pane="sheet-picture">{furniture?.actions}</PaneActions>
      </>
    )),
    "sheet-ledger": <Ledger props={spine} />,
  };
  return (
    <AttentionRoot doc={props.attentionDoc}>
      <SubjectTextContext.Provider value={subjects}>
        <NativeObservationScope
          value={{
            scope: { document: snapshotRead.current ? doc : null, source: "native" },
            references: [...snapshot.nodes, ...snapshot.segments].map(({ id, uniqueId }) => ({
              elementId: id,
              uniqueId,
            })),
          }}
        >
          {panes[id]}
        </NativeObservationScope>
      </SubjectTextContext.Provider>
    </AttentionRoot>
  );
}
