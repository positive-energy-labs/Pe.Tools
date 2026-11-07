import { renderPicturePane } from "#/scene/picture/picture";
import { EspParameter } from "./esp-parameter";
import { DEFAULT_DESIGN_FRICTION_RATE } from "@pe/ducts-domain/equivalent-length";
import { StateCell, cellSource } from "@pe/kit/lang/cell";
import { Button } from "@pe/kit/lang/button";
import { suggestKind, suggestRole } from "@pe/ducts-domain/roster";
import { PointerCite } from "#/shell/pointer-list";
import { pointerRefs } from "../pointer-refs";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { useRouteSearchSlice } from "#/route/activity";
import { picturePageMove } from "#/shell/picture-page";
import { useAdmittedSubject } from "#/shell/subject";

import type { DuctsSheetEdits, PicturePage } from "@pe/agent-contracts";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import * as Atom from "effect/reactivity/Atom";
import { useMemo, useRef } from "react";
import type { FansDrawContext } from "../../fans/route.ts";
import { fansDocumentSchema } from "@pe/agent-contracts";
const scopeSchema = fansDocumentSchema.shape.writeIntent.unwrap().shape.edit.unwrap().unwrap()
  .shape.value;
import { attentionSubjects } from "../cell-focus";
import { localId, localSubject, namesOf } from "../identity.ts";
import { ductsLink } from "../identity.ts";
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
function useSheetData(ctx: SheetContext, snapshot: DuctSnapshot) {
  const authored = ctx.page.read();
  const reading = ctx.value;
  const value = reading.value;
  const sheet = value?.open ?? null;
  const fans = ctx.value.value?.fans;
  const roster = rosterOrder(value?.rows ?? fans?.rows ?? []);
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
 * The person's explicit fan write scope, required by the host losses command. Offered from the host
 * sheet's open fan and the cells staged on elements of that sheet's snapshot; staged only on a pick,
 * never from the Page or a plan. Another fan's standing scope is shown, not replaced on navigation.
 */
function WriteScope({
  ctx,
  snapshot,
  fan,
}: {
  ctx: SheetContext;
  snapshot: DuctSnapshot;
  fan: { unitId: number; portIndex: number; mark: string } | null;
}) {
  const handle = ctx.cells.at(["writeIntent"]);
  const standing = scopeSchema.optional().parse(handle.value.edit?.value);
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
      <StateCell
        cell={handle}
        value={ctx.value}
        label="Write scope"
        model={null}
        format={label}
        options={[
          ...(offered?.success
            ? [
                {
                  key: "fan",
                  value: offered.data,
                  history: { label: "Choose write scope" },
                  label: label(offered.data),
                  description: "Write this fan's walk and its staged cells",
                },
              ]
            : []),
          ...(current === "other"
            ? [
                {
                  key: "other",
                  value: standing,
                  label: label(standing),
                  description: "Another fan's scope, still standing",
                },
              ]
            : []),
          { key: "none", label: "None", description: "Clear the write scope", clear: true, history: { label: "Clear write scope" } },
        ]}
        current={current}
        capReason={!offered?.success ? "Open a fan first" : undefined}
      />
      <span />
    </span>
  );
}
export function RosterBody({ ctx }: { ctx: SheetContext }) {
  const authored = ctx.page.read();
  const snapshot = sheetSnapshot(ctx.value.value?.sheetSnapshot);
  const fans = ctx.value.value?.fans;
  const roster = rosterOrder(ctx.value.value?.rows ?? fans?.rows ?? []);
  const busy = ctx.value.status === "pending";
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
          value: ctx.value,
          roster: roster,
          picked: pickedFans === "all" ? roster.map(stableFanKey) : pickedFans,
          open: open,
          busy: busy,
          loading: ctx.value.status === "pending",
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
function SheetEmpty({ value }: { value: SheetContext["value"] }) {
  return value.status === "failed" ? <p role="alert">{value.reason}</p> : value.status === "pending"
    ? <p role="status">computing</p> : <p>Open a fan from the roster.</p>;
}
export function InputsBody({ ctx }: { ctx: SheetContext }) {
  const snapshot = sheetSnapshot(ctx.value.value?.sheetSnapshot);
  return "kind" in snapshot ? (
    <SheetEmpty value={ctx.value} />
  ) : (
    <InputsContent ctx={ctx} snapshot={snapshot} />
  );
}
function InputsContent({ ctx, snapshot }: { ctx: SheetContext; snapshot: DuctSnapshot }) {
  const { sheet, fans, nameOf, selected, changeInputs, busy } = useSheetData(ctx, snapshot);
  const workDoc = ctx.value.value?.design ?? null;
  const state = ctx.value.value?.sheetView ?? EMPTY_SHEET_STATE;
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
  const fanReading = fans;
  const friction = ctx.cells.at(["designFriction"]);
  const ownPane = (
    <>
      <section
        aria-label="Fan settings"
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)_auto] items-center gap-x-2 gap-y-1 p-1"
      >
        <WriteScope ctx={ctx} snapshot={snapshot} fan={sheet?.overview.fan ?? null} />
        <span data-sheet-cell="Design friction" aria-label="Design friction" className="contents">
          <span>Design friction</span>
          <span className="block min-w-0 h-(--item-h)">
            <StateCell
              cell={friction}
              value={ctx.value}
              label="Design friction"
              model={DEFAULT_DESIGN_FRICTION_RATE}
              source="default"
              scale="row"
              numeric={{ min: 0, digits: 3 }}
              unit={{ label: "in-wg/100 ft" }}

            />
          </span>
          <span
            className="t-small text-ink-2"
            data-input-source={cellSource(friction, "default")}
          >
            {cellSource(friction, "default")}
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
          const handle = ctx.cells.at(["parameters", key]);
          return (
            <label key={key} className="contents">
              <span className="min-w-0 truncate">{label}</span>
              <span className="block min-w-0 h-(--item-h)">
                {key === "fanStatic" ? (
                  <EspParameter
                    options={ctx.value.value?.espOptions??null}
                    error={ctx.value.value?.espOptionsError??null}
                    cell={handle}
                    value={ctx.value}
                    model={snapshot.slots[key]}
                  />
                ) : (
                  <StateCell
                    cell={handle}
                    value={ctx.value}
                    label={label}
                    model={snapshot.slots[key]}
                    scale="row"
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
                <StateCell
                  label={label}
                  cell={ctx.cells.at(["roles", key])}
                  value={ctx.value}
                  keyOf="role"
                  format={JSON.stringify}
                  model={{ role:
                    sheet?.inputs?.inputs.units[key]?.role.value ??
                    suggestRole(node, suggestKind(node).kind)
                  }}
                  options={[
                    { key: "fan", label: "Fan", value: { role: "fan" } },
                    { key: "passive", label: "Passive", value: { role: "passive" } },
                  ]}

                />
                {cell.edit ? (
                  <Button
                    label="Clear unit role"
                    onClick={() =>
                      void ctx.cells.at(["roles", key]).clear({ label })
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
        onSlot={(key, slot) => { void ctx.cells.at(["parameters", key]).stage(slot, { label: `${key} ? ${slot}` }); }}
        apply={changeInputs}
        history={history}
        nameOf={nameOf}
        act={(path, _cell, kind, label) => ctx.cells.at(path).clear({ label: `${kind} Pea's ${label}` })}
      />
    </>
  );
  return (
    <SheetFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf}>
      {ownPane}
    </SheetFrame>
  );
}
export function PictureBody({ ctx }: { ctx: SheetContext }) {
  const snapshot = sheetSnapshot(ctx.value.value?.sheetSnapshot);
  return "kind" in snapshot ? (
    <SheetEmpty value={ctx.value} />
  ) : (
    <PictureContent ctx={ctx} snapshot={snapshot} />
  );
}
function PictureContent({ ctx, snapshot }: { ctx: SheetContext; snapshot: DuctSnapshot }) {
  const { authored, value, sheet, roster, nameOf, selected } = useSheetData(ctx, snapshot);
  const target = ctx.target;
  const doc = target?.kind === "document" ? target.ref : null;
  const workDoc = ctx.value.value?.design ?? null;
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
  const nativeSnapshot = ctx.value.value?.sheetSnapshot;
  const captureSource =
    ctx.value.current &&
    doc &&
    nativeSnapshot &&
    !("kind" in nativeSnapshot) &&
    nativeSnapshot.sourceVersion
      ? { document: doc, version: nativeSnapshot.sourceVersion }
      : null;
  const state = ctx.value.value?.sheetView ?? EMPTY_SHEET_STATE;
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
        refreshing: !ctx.value.current,
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
export function LedgerBody({ ctx }: { ctx: SheetContext }) {
  const snapshot = sheetSnapshot(ctx.value.value?.sheetSnapshot);
  return "kind" in snapshot ? (
    <SheetEmpty value={ctx.value} />
  ) : (
    <LedgerContent ctx={ctx} snapshot={snapshot} />
  );
}
function LedgerContent({ ctx, snapshot }: { ctx: SheetContext; snapshot: DuctSnapshot }) {
  const { reading, sheet, roster, nameOf, selected, changeInputs, busy } = useSheetData(
    ctx,
    snapshot,
  );
  const select = (selected: string) =>
    ctx.selection.set(selected ? [{ kind: "focus", id: localId("ducts-focus", selected) }] : []);
  const state = ctx.value.value?.sheetView ?? EMPTY_SHEET_STATE;
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
      secondary: closer.secondary && {
        ...closer.secondary,
        verb: labelled(closer.secondary.verb, closer.secondary.action),
      },
      crossing: closer.crossing && {
        ...closer.crossing,
        verb: labelled(closer.crossing.verb, closer.crossing.action),
      },
      choices: closer.choices?.map((choice) => ({
        ...choice,
        verb: labelled(choice.verb, choice.action),
      })),
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
          return {
            ...edits,
            ends: [...(edits.ends ?? []), { end: action.end, verdict: "capped" }],
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
  const ownPane = (
    <Ledger
      props={{
        sheet: sheet,
        blockers: state.blockers,
        taken: state.taken,
        inputs: state.inputs,
        busy: busy,
        loading: ctx.value.status === "pending",
        error:
          (reading.status === "failed" ? reading.reason : null) ??
          (ctx.value.status === "failed" ? ctx.value.reason : null),
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
export function sheetSnapshot(value: import("@pe/agent-contracts").Immutable<DuctSnapshot | { kind: "absent" }> | undefined): (DuctSnapshot & { sourceVersion?: string }) | { kind: "absent" } {
  return structuredClone(value ?? { kind: "absent" }) as (DuctSnapshot & { sourceVersion?: string }) | { kind: "absent" };
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
  const target = ctx.target;
  const document = target?.kind === "document" ? target.ref : null;
  const attentionDoc = document ? `${document.session}/${document.openId}` : "fans:unbound";
  const refProps = useRevitSubjectProps();
  const go = (id: number) =>
    jump?.current
      ? jump.current(elementKey(id))
      : ctx.selection.set([{ kind: "focus", id: localId("ducts-focus", String(id)) }]);
  return (
    <>
      {"kind" in snapshot ? null : (
        <PointerCite
          route="fans"
          refs={(place) => pointerRefs(place, snapshot, attentionDoc, (id) => nameOf(id))}
        />
      )}
      <SubjectTextContext.Provider value={{ doc: attentionDoc, nameOf, go, refProps }}>
          {children}

      </SubjectTextContext.Provider>
    </>
  );
}
