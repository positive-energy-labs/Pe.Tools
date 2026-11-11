import { workElementId } from "@pe/ducts-domain/work-subject";
import { renderPicturePane } from "#/scene/picture/picture";
import { PointerCite } from "#/shell/pointer-list";
import { ductElements, pointerRefs } from "../identity.ts";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { useRouteSearchSlice } from "#/route/activity";
import { picturePageMove } from "#/shell/picture-page";
import { useAdmittedSubject } from "#/shell/subject";

import type { FansSheetEdits, PicturePage, SubjectRefCode } from "@pe/agent-contracts";
import { systemScope } from "@pe/ducts-domain/system-scope";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import * as Atom from "effect/reactivity/Atom";
import { useMemo, useRef } from "react";
import type { FansDrawContext } from "../../fans/route.ts";
import { issueOf, issueSubject, selectedKeys } from "../cell-focus";
import { ductsLink } from "../identity.ts";
import { subjectNamer } from "../subject-text";
import { describeCloser, DUCTS_FIXES, type Closer, type CloserAction, type CloserLink } from "./closer";
import { fittingGroups } from "./fitting-groups";
import { FittingReadouts } from "./fitting-readouts";
import { editLabel, type EditMeta } from "./input-history.neutral";
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
  const selected = authored.selected.map(({ id }) => id).join(",");
  const changeInputs = async (
    edits: FansSheetEdits,
    history: EditMeta = { label: editLabel(edits, key => nameOf(workElementId(snapshot, key))) },
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
  const open = (row: FanPort) => subject?.toggle(stableFanKey(row));
  const pickedFans = authored.fan.kind === "all" ? "all" : authored.fan.ids;
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
          finding: (finding) => ctx.write("finding").run(finding),
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
    ctx.selection.set(selected ? [{ kind: "focus", id: selected }] : []);
  const setPage = picturePageMove<PicturePage<string, "schematic">>(
    (patch, intent) => ctx.page.pose(patch, intent),
    select,
  );
  const selection = useMemo(
    () => Atom.make<ReadonlySet<SubjectKey>>(new Set(selectedKeys(authored.selected.map(({ id }) => id)))),
    [authored.selected],
  );
  const pickedFans = authored.fan.kind === "all" ? "all" : authored.fan.ids;
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
  const fanId = (row: FanPort) => stableFanKey(row);
  const ownPane = ((renderPane: TeachingPaneRender) => (
    <SheetPicture
      props={{
        page: { ...authored, selected, issue: issueOf(selected) },
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
  const nativeElement = (id: number) => {
    const e = [...snapshot.nodes, ...snapshot.segments].find(e => e.id === id);
    if (!e) throw Error(`Element ${id} is unavailable`);
    return e;
  };
  const { reading, sheet, roster, nameOf, selected, changeInputs, busy } = useSheetData(
    ctx,
    snapshot,
  );
  const select = (selected: string) =>
    ctx.selection.set(selected ? [{ kind: "focus", id: selected }] : []);
  const state = ctx.value.value?.sheetView ?? EMPTY_SHEET_STATE;
  const search = useRouteSearchSlice((search) => search);
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
    // No cross-route write (ruling 2026-11-10): a fix whose Work is /ducts' is a link that opens /ducts
    // on the blocker's element, named by what it fixes; only Fans' own fixes stage here.
    const linkTo = (action: CloserAction | null | undefined): CloserLink | null => {
      if (!action || !DUCTS_FIXES.has(action.kind)) return null;
      const name = nameOf(blocker.elementId);
      const what = action.kind === "rule" ? `join ${name}` : action.kind === "cap" ? `end ${name}`
        : action.kind === "price" ? `assignment ${action.family}` : action.kind === "table" ? `table ${action.rule}` : `fitting ${name}`;
      // Never a fallback to a write or an ElementId (slice 5): the blocker's producer stamps its
      // UniqueId SubjectRef; a stand-in with none opens /ducts on the sheet's systems, named by the text.
      return { says: `Fix in /ducts: ${what} ›`, href: ductsLink(sheetSystems(snapshot), search,
        // The contract admitted it as an element UniqueId code (`elementSubjectSchema`).
        blocker.subject ? { kind: "subject", code: blocker.subject as SubjectRefCode } : { kind: "route" }) };
    };
    const own = (link: CloserLink | null, action: CloserAction | null) => (link ? null : action);
    const link = linkTo(closer.action) ?? linkTo(closer.choices?.[0]?.action);
    return {
      ...closer,
      link,
      action: own(link, closer.action),
      input: link ? null : closer.input,
      refusal: link ? null : closer.refusal,
      verb: link ? link.says : labelled(closer.verb, closer.action),
      secondary: closer.secondary && (() => {
        const l = linkTo(closer.secondary.action);
        return { ...closer.secondary, link: l, action: own(l, closer.secondary.action), refusal: l ? null : closer.secondary.refusal,
          verb: l ? l.says : labelled(closer.secondary.verb, closer.secondary.action) };
      })(),
      crossing: closer.crossing && (() => {
        const l = linkTo(closer.crossing.action);
        return { ...closer.crossing, link: l, action: own(l, closer.crossing.action), refusal: l ? null : closer.crossing.refusal,
          verb: l ? l.says : labelled(closer.crossing.verb, closer.crossing.action) };
      })(),
      choices: link ? null : closer.choices?.map((choice) => ({
        ...choice,
        verb: labelled(choice.verb, choice.action),
      })),
    };
  };
  const editsFor = (closers: readonly Closer[]) =>
    closers.reduce<FansSheetEdits>((edits, closer) => {
      if (closer.refusal || !closer.action) return edits;
      const action = closer.action;
      switch (action.kind) {
        case "drop":
          return action.terminal
            ? {
                ...edits,
                terminalDrops: {
                  ...edits.terminalDrops,
                  [elementSubject(nativeElement(action.elementId))]: { inWg: action.value },
                },
              }
            : {
                ...edits,
                componentDrops: {
                  ...edits.componentDrops,
                  [elementSubject(nativeElement(action.elementId))]: { inWg: action.value },
                },
              };
        case "cfm":
          return { ...edits, flows: { ...edits.flows, [elementSubject(nativeElement(action.elementId))]: { cfm: action.value } } };
        case "unitCfm":
          return {
            ...edits,
            equipmentFlows: { ...edits.equipmentFlows, [elementSubject(nativeElement(action.unitId))]: { cfm: action.value } },
          };
        // /ducts' fixes never reach here: `closerOf` made each a link (DUCTS_FIXES).
        default:
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
        loading: ctx.value.status === "pending",
        error:
          (reading.status === "failed" ? reading.reason : null) ??
          (ctx.value.status === "failed" ? ctx.value.reason : null),
        changeInputs: changeInputs,
        closerOf: closerOf,
        close: (closer: Closer) => changeInputs(editsFor([closer]), { label: closer.verb }),
        closeMany: (closers: readonly Closer[]) => changeInputs(editsFor(closers)),
        focusedBlocker: issueOf(selected) || null,
        focusBlocker: (issue: string | null) => {
          select(issue ? issueSubject(issue) : "");
        },
      }}
    />
  );
  // The per-fitting loss readouts explain this fan's ESP; their tables are chosen on /ducts.
  const groups = fittingGroups(sheet?.inputs?.fittings ?? [], state.inputs, sheet?.inputs?.tableTitles ?? {});
  return (
    <SheetFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf}>
      {ownPane}
      <FittingReadouts groups={groups} ductsHref={ductsLink(sheetSystems(snapshot), search)}
        waiting={!sheet ? "Open a fan first" : state.inputs ? null : "Wait for inputs"} />
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
  const elements = ductElements(snapshot);
  const go = (id: number) => {
    const key = elements.keyOf(id);
    if (!key) return;
    return jump?.current ? jump.current(key) : ctx.selection.set([{ kind: "focus", id: key }]);
  };
  return (
    <>
      {"kind" in snapshot ? null : (
        <PointerCite
          route="fans"
          refs={(place) => pointerRefs(place, snapshot, attentionDoc, (id) => nameOf(id))}
        />
      )}
      <SubjectTextContext.Provider value={{ doc: attentionDoc, nameOf, uniqueIdOf: elements.uniqueIdOf, go, refProps }}>
          {children}

      </SubjectTextContext.Provider>
    </>
  );
}
