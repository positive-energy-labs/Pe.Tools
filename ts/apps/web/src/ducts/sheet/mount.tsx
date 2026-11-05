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
import { PaneActions } from "#/shell/pane-actions";
import { picturePageMove } from "#/shell/picture-page";
import { useAdmittedSubject } from "#/shell/subject";
import { settleWork } from "#/shell/work-door-observation";
import type { DuctsSheetEdits, PicturePage, RouteStatePatch } from "@pe/agent-contracts";
import { ductsDesign, cellPatches } from "@pe/agent-contracts";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import * as Atom from "effect/reactivity/Atom";
import { useMemo, useRef } from "react";
import type { PaneContext } from "../../../../../packages/agent-contracts/src/route-kernel-bodies";
import { entries, fansData, schemas } from "../../fans/neutral";
import { attentionSubjects } from "../cell-focus";
import { localId, localSubject, namesOf } from "../neutral.ts";
import { ductsLink } from "../neutral.ts";
import { subjectNamer } from "../subject-text";
import { describeCloser, type Closer } from "./closer";
import { editLabel, presentInputHistory, type EditMeta } from "./input-history.neutral";
import { InputsSurface } from "./inputs-surface";
import { rosterOrder, stableFanKey, withComputed, type FanPort } from "./model";
import { SheetPicture } from "./picture";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { sheetSystems } from "./scoped-snapshot.ts";
import { EMPTY_SHEET_STATE } from "./state";
import { Ledger, Roster } from "./view";
type SheetContext = PaneContext<
  typeof fansData,
  typeof schemas,
  typeof entries,
  keyof typeof fansData.panes
>;
function useSheetData(
  ctx: Pick<SheetContext, "page" | "verbs" | "workBasis"> & {
    readings: Pick<SheetContext["readings"], "fans" | "sheet" | "sheetSnapshot">;
  },
  snapshot: DuctSnapshot,
) {
  const authored = ctx.page.read();
  const reading = ctx.readings.sheet;
  const value = reading.value;
  const sheet = value?.open ?? null;
  const fans = ctx.readings.fans;
  const roster = rosterOrder(
    withComputed(fans.value?.rows ?? value?.rows ?? [], value?.rows ?? []),
  );
  const nameOf = useMemo(() => subjectNamer(snapshot), [snapshot]);
  const selected = authored.selected.map(({ id }) => localSubject(id)).join(",");
  const changeInputs = async (
    edits: DuctsSheetEdits,
    history: EditMeta = { label: editLabel(edits, nameOf) },
  ) => {
    // Join rulings are /ducts cells: they land in ducts Work through its owner handle (ADR 0030 rule 9).
    const { joins, ...own } = edits;
    const basis = sheet?.overview.basis ?? null;
    if (joins?.length) {
      const result = await settleWork(ctx.verbs.ductsEdit({ edits: { joins }, history, basis }));
      if (result.kind === "refused") return { code: "refused", message: result.refusal.error };
    }
    if (!Object.keys(own).length) return undefined;
    if (!ctx.workBasis)
      return { code: "unavailable", message: "Read this document's Work before editing" };
    const result = await settleWork(
      ctx.verbs.sheetEdit({ edits: own, history, basis }, ctx.workBasis),
    );
    return result.kind === "refused"
      ? { code: "refused", message: result.refusal.error }
      : undefined;
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
export function RosterBody({
  ctx,
}: {
  ctx: PaneContext<typeof fansData, typeof schemas, typeof entries, "sheet-roster">;
}) {
  const authored = ctx.page.read();
  const snapshot = sheetSnapshot(ctx.readings.sheetSnapshot);
  const fans = ctx.readings.fans;
  const roster = rosterOrder(
    withComputed(fans.value?.rows ?? [], ctx.readings.sheet.value?.rows ?? []),
  );
  const busy = ctx.readings.sheet.status === "pending";
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
            onChange: (rosterSearch, rosterSort) => ctx.verbs.browse({ rosterSearch, rosterSort }),
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
  readings: Pick<SheetContext["readings"], "sheetSnapshot" | "sheet">;
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
  ctx: PaneContext<typeof fansData, typeof schemas, typeof entries, "sheet-inputs">;
}) {
  const snapshot = sheetSnapshot(ctx.readings.sheetSnapshot);
  return "kind" in snapshot ? (
    <SheetEmpty readings={ctx.readings} />
  ) : (
    <InputsContent ctx={ctx} snapshot={snapshot} />
  );
}
function InputsContent({
  ctx,
  snapshot,
}: {
  ctx: PaneContext<typeof fansData, typeof schemas, typeof entries, "sheet-inputs">;
  snapshot: DuctSnapshot;
}) {
  const { sheet, fans, nameOf, selected, changeInputs, busy } = useSheetData(ctx, snapshot);
  const workDoc = sheetWork(ctx);
  const write = async (patches: RouteStatePatch[], history?: EditMeta) => {
    if (!ctx.workBasis)
      return { code: "unavailable", message: "Read this document's Work before editing" };
    const result = await settleWork(ctx.verbs.edit({ patches, history }, ctx.workBasis));
    return result.kind === "refused" ? { code: "refused", message: result.refusal.error } : null;
  };
  const state = ctx.readings.sheetView.value ?? EMPTY_SHEET_STATE;
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
  const search = useRouteSearchSlice((search) => search);
  const fanReading = fans.value;
  const friction = ctx.work?.designFriction ?? {};
  const ownPane = (
    <>
      <section aria-label="Fan settings" className="flex flex-col gap-2 p-1">
        <span
          data-sheet-cell="Design friction"
          aria-label="Design friction"
          className="flex items-baseline gap-2"
        >
          <span>Design friction</span>
          <StateCell
            {...cellFromDraft(friction, {
              value: String(friction.edit?.value ?? DEFAULT_DESIGN_FRICTION_RATE),
              cap: ctx.workBasis ? "editable" : "locked",
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
                revision: ctx.workBasis?.workRevision ?? null,
                write: (patches) => write(patches, { label: "Design friction" }),
              },
              "designFriction",
              friction,
            )}
          />
          <span data-input-source={friction.edit ? "Work" : "default"}>
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
          const cell = ctx.work?.parameters[key] ?? {};
          return (
            <label key={key} className="flex items-baseline gap-2">
              <span>{label}</span>
              <StateCell
                {...cellFromDraft(cell, {
                  value: cell.edit ? String(cell.edit.value) : snapshot.slots[key],
                  modelValue: snapshot.slots[key],
                  cap: "editable",
                })}
                scale="row"
                onCommit={(value: string) =>
                  write(cellPatches(["parameters"], key, cell, { kind: "set", rung: { value } }), {
                    label,
                  }).then((result) => result?.message)
                }
                transitions={reviewTransitions(
                  {
                    segment: "parameters",
                    revision: ctx.workBasis?.workRevision ?? null,
                    write: (patches) => write(patches, { label }),
                  },
                  key,
                  cell,
                )}
              />
            </label>
          );
        })}
        {snapshot.nodes
          .filter((node) => node.kind === "equipment")
          .map((node) => {
            const key = String(node.id);
            const cell = ctx.work?.roles[key] ?? {};
            const label = `Unit role ${nameOf(node.id)}`;
            return (
              <label key={key} className="flex items-baseline gap-2">
                <span>{label}</span>
                <ChoiceCell
                  label={label}
                  cell={cell}
                  path={["roles", key]}
                  show={JSON.stringify}
                  current={
                    cell.edit?.value.role ??
                    sheet?.inputs?.inputs.units[key]?.role.value ??
                    suggestRole(node, suggestKind(node).kind)
                  }
                  options={[
                    { key: "fan", label: "Fan" },
                    { key: "passive", label: "Passive" },
                  ]}
                  refusal={ctx.workBasis ? null : "Read Work before editing"}
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
                {cell.edit && (
                  <Button
                    label="Clear unit role"
                    onClick={() =>
                      void write(cellPatches(["roles"], key, cell, { kind: "clear" }), { label })
                    }
                  >
                    Clear unit role
                  </Button>
                )}
              </label>
            );
          })}
      </section>
      <InputsSurface
        ductsHref={(destination) => ductsLink(sheetSystems(snapshot), search, destination)}
        ctx={{
          snapshot,
          doc: workDoc,
          revision: ctx.workBasis?.workRevision ?? null,
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
          if (path.length === 1 || path[0] !== "parameters")
            return { code: "unavailable", message: "Edit duct rules on /ducts" };
          return write(cellPatches(["parameters"], path[1], cell, { kind }), {
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
  ctx: PaneContext<typeof fansData, typeof schemas, typeof entries, "sheet-picture">;
}) {
  const snapshot = sheetSnapshot(ctx.readings.sheetSnapshot);
  return "kind" in snapshot ? (
    <SheetEmpty readings={ctx.readings} />
  ) : (
    <PictureContent ctx={ctx} snapshot={snapshot} />
  );
}
function PictureContent({
  ctx,
  snapshot,
}: {
  ctx: PaneContext<typeof fansData, typeof schemas, typeof entries, "sheet-picture">;
  snapshot: DuctSnapshot;
}) {
  const { authored, value, sheet, fans, roster, nameOf, selected } = useSheetData(ctx, snapshot);
  const target = ctx.workBasis?.token.scope.identity.target;
  const doc = target?.kind === "document" ? target.ref : null;
  const workDoc = sheetWork(ctx);
  const select = (selected: string) =>
    ctx.page.select(selected ? [{ kind: "focus", id: localId("ducts-focus", selected) }] : []);
  const setPage = picturePageMove<PicturePage<string, "schematic">>(
    (patch, intent) => ctx.page.pose(patch, intent),
    select,
  );
  const selection = useMemo(
    () => Atom.make(attentionSubjects(authored.selected.map(({ id }) => localSubject(id)))),
    [authored.selected],
  );
  const pickedFans = namesOf(authored.fan);
  const nativeSnapshot = ctx.readings.sheetSnapshot.value;
  const captureSource =
    ctx.readings.fans.current &&
    doc &&
    nativeSnapshot &&
    !("kind" in nativeSnapshot) &&
    nativeSnapshot.sourceVersion
      ? { document: doc, version: nativeSnapshot.sourceVersion }
      : null;
  const state = ctx.readings.sheetView.value ?? EMPTY_SHEET_STATE;
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
  ))((body, furniture) => (
    <>
      {body}
      <PaneActions pane="sheet-picture">{furniture?.actions}</PaneActions>
    </>
  ));
  return (
    <SheetFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf} jump={jump}>
      {ownPane}
    </SheetFrame>
  );
}
export function LedgerBody({
  ctx,
}: {
  ctx: PaneContext<typeof fansData, typeof schemas, typeof entries, "sheet-ledger">;
}) {
  const snapshot = sheetSnapshot(ctx.readings.sheetSnapshot);
  return "kind" in snapshot ? (
    <SheetEmpty readings={ctx.readings} />
  ) : (
    <LedgerContent ctx={ctx} snapshot={snapshot} />
  );
}
function LedgerContent({
  ctx,
  snapshot,
}: {
  ctx: PaneContext<typeof fansData, typeof schemas, typeof entries, "sheet-ledger">;
  snapshot: DuctSnapshot;
}) {
  const { reading, sheet, fans, roster, nameOf, selected, changeInputs, busy } = useSheetData(
    ctx,
    snapshot,
  );
  const select = (selected: string) =>
    ctx.page.select(selected ? [{ kind: "focus", id: localId("ducts-focus", selected) }] : []);
  const state = ctx.readings.sheetView.value ?? EMPTY_SHEET_STATE;
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
    // ponytail: joins are the one /ducts cell staged from here; ends, rules and tables still route to /ducts.
    const staged = (action: Closer["action"]) =>
      action?.kind === "drop" ||
      action?.kind === "cfm" ||
      action?.kind === "unitCfm" ||
      action?.kind === "rule";
    return {
      ...closer,
      verb: closer.action?.kind === "rule" ? `${closer.verb} · from /ducts` : closer.verb,
      action: staged(closer.action) ? closer.action : null,
      refusal: staged(closer.action) ? closer.refusal : "Edit duct rules on /ducts",
      secondary: null,
      crossing: null,
      choices: null,
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
        case "price":
        case "table":
        case "pathDrop":
          return edits;
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
  reading: SheetContext["readings"]["sheetSnapshot"],
): (DuctSnapshot & { sourceVersion?: string }) | { kind: "absent" };
export function sheetSnapshot(reading: { value?: unknown }): unknown {
  return structuredClone(reading.value ?? { kind: "absent" });
}
function sheetWork(ctx: SheetContext) {
  return ctx.work && ctx.readings.ductsWork.value
    ? ductsDesign(ctx.readings.ductsWork.value, ctx.work)
    : null;
}
function SheetFrame({
  ctx,
  snapshot,
  nameOf,
  jump,
  children,
}: {
  ctx: Pick<SheetContext, "page" | "workBasis"> & {
    readings: Pick<SheetContext["readings"], "sheetSnapshot">;
  };
  snapshot: DuctSnapshot | { kind: "absent" };
  nameOf: ReturnType<typeof subjectNamer>;
  jump?: import("react").RefObject<((key: SubjectKey) => void) | null>;
  children: import("react").ReactNode;
}) {
  const target = ctx.workBasis?.token.scope.identity.target;
  const document = target?.kind === "document" ? target.ref : null;
  const attentionDoc = document ? `${document.session}/${document.openId}` : "fans:unbound";
  const refProps = useRevitSubjectProps();
  const go = (id: number) =>
    jump?.current
      ? jump.current(elementKey(id))
      : ctx.page.select([{ kind: "focus", id: localId("ducts-focus", String(id)) }]);
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
              document: ctx.readings.sheetSnapshot.current ? document : null,
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
