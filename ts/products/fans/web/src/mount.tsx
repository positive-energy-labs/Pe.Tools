import { workElementId } from "@pe/ducts-domain/work-subject";
import { ductElements } from "@pe/ducts-web/identity";
import { useRevitSubjectProps } from "../../../../apps/web/src/revit/element-menu.tsx";
import { useRouteSearchSlice } from "../../../../apps/web/src/route/activity.tsx";
import { useAdmittedSubject } from "../../../../apps/web/src/shell/subject.ts";

import type { FansCalcEdits, SubjectRefCode } from "@pe/agent-contracts";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { useMemo } from "react";
import { calc as sheet, type FansDrawContext } from "../route.ts";
import { valueOf } from "../../../../apps/web/src/route/typed-route.ts";
import { issueOf, issueSubject } from "@pe/ducts-web/cell-focus";
import { ductsLink } from "@pe/ducts-web/identity";
import { subjectNamer } from "@pe/ducts-web/subject-text";
import { describeCloser, DUCTS_FIXES, type Closer, type CloserAction, type CloserLink } from "./calc/closer.ts";
import { fittingGroups } from "./calc/fitting-groups.ts";
import { FittingReadouts } from "./calc/fitting-readouts.tsx";
import { editLabel, type EditMeta } from "@pe/ducts-web/calc/input-history.neutral";
import { rosterOrder, stableFanKey, type FanPort } from "@pe/ducts-web/calc/model";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { calcSystems } from "@pe/ducts-web/calc/scoped-snapshot";
import { EMPTY_CALC_STATE } from "./calc/state.ts";
import { Ledger, Roster } from "./calc/view.tsx";
export type CalcContext = FansDrawContext;
export function useCalcData(ctx: CalcContext, snapshot: DuctSnapshot) {
  const authored = ctx.page.read();
  const reading = ctx.value;
  const value = reading.value;
  const sheet = value?.open ?? null;
  const fans = ctx.value.value?.fans;
  const roster = rosterOrder(value?.rows ?? fans?.rows ?? []);
  const nameOf = useMemo(() => subjectNamer(snapshot), [snapshot]);
  const selected = authored.selected.map(({ id }) => id).join(",");
  const changeInputs = async (
    edits: FansCalcEdits,
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
    /** The focused blocker: the selection's `issue:<key>` place, bare. */
    issue: issueOf(selected),
    state: value?.sheetView ?? EMPTY_CALC_STATE,
    fanKey: stableFanKey,
    changeInputs,
    busy: reading.state === "refreshing",
  };
}
export function RosterBody({ ctx }: { ctx: CalcContext }) {
  const authored = ctx.page.read();
  // This pane's read is the roster; the open sheet is a second reading, and it wins where it is held.
  const opened = ctx.read(sheet), held = valueOf(opened) ?? ctx.value.value;
  const snapshot = calcSnapshot(held.sheetSnapshot);
  const fans = held.fans;
  const roster = rosterOrder(held.rows ?? fans?.rows ?? []);
  const busy = opened.state === "reading" || opened.state === "refreshing";
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
          busy: busy,
          loading: busy,
        }}
      />
      {("kind" in snapshot ? [] : calcSystems(snapshot)).map((name) => (
        <a key={name} href={ductsLink([name], search)}>
          {name}
        </a>
      ))}
    </>
  );
  return (
    <CalcFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf}>
      {ownPane}
    </CalcFrame>
  );
}
export function CalcEmpty({ value }: { value: CalcContext["value"] }) {
  return value.state === "refreshing" ? <p role="status">computing</p> : <p>Open a fan from the roster.</p>;
}
export function LedgerBody({ ctx }: { ctx: CalcContext }) {
  const snapshot = calcSnapshot(ctx.value.value?.sheetSnapshot);
  return "kind" in snapshot ? (
    <CalcEmpty value={ctx.value} />
  ) : (
    <LedgerContent ctx={ctx} snapshot={snapshot} />
  );
}
function LedgerContent({ ctx, snapshot }: { ctx: CalcContext; snapshot: DuctSnapshot }) {
  const nativeElement = (id: number) => {
    const e = [...snapshot.nodes, ...snapshot.segments].find(e => e.id === id);
    if (!e) throw Error(`Element ${id} is unavailable`);
    return e;
  };
  const { reading, sheet, roster, nameOf, selected, changeInputs, busy } = useCalcData(
    ctx,
    snapshot,
  );
  const select = (selected: string) =>
    ctx.selection.set(selected ? [{ kind: "focus", id: selected }] : []);
  const state = ctx.value.value?.sheetView ?? EMPTY_CALC_STATE;
  const search = useRouteSearchSlice((search) => search);
  const closerOf = (blocker: import("./calc/tiers.ts").CalcBlocker, typed: number | null): Closer => {
    const closer = describeCloser(blocker, typed, {
      terminalDrop: state.inputs?.criteria.terminalDropInWg ?? null,
      // A terminal of this walk is a row of the resolved inputs; the blocker's prose is never read.
      terminal: (id) => Object.hasOwn(state.inputs?.terminals ?? {}, String(id)),
      fix: (blocker) => blocker.typedCloser ?? null,
      nameOf,
      wait: busy
        ? "Wait for the current read"
        : sheet?.inputs && reading.state === "ready"
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
      // UniqueId SubjectRef; /ducts resolves the canonical roster itself so the URL never grows
      // with the snapshot's system roster. A stand-in with none opens that scope without selection.
      return { says: `Fix in /ducts: ${what} ›`, href: ductsLink("all", search,
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
    closers.reduce<FansCalcEdits>((edits, closer) => {
      if (closer.refusal || !closer.action) return edits;
      const action = closer.action;
      switch (action.kind) {
        case "drop": {
          const segment = action.terminal ? "terminalDrops" : "componentDrops", key = elementSubject(nativeElement(action.elementId));
          return { ...edits, [segment]: { ...edits[segment], [key]: { inWg: action.value } },
            // An offered default cites where it came from on the cell's own ref; the host stamps who took it.
            ...(action.ref ? { refs: { ...edits.refs, [segment]: { ...edits.refs?.[segment], [key]: action.ref } } } : {}) };
        }
        case "cfm":
          return { ...edits, flows: { ...edits.flows, [elementSubject(nativeElement(action.elementId))]: action.value } };
        case "unitCfm":
          return {
            ...edits,
            equipmentFlows: { ...edits.equipmentFlows, [elementSubject(nativeElement(action.unitId))]: action.value },
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
        loading: ctx.value.state === "refreshing",
        error: null,
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
    <CalcFrame ctx={ctx} snapshot={snapshot} nameOf={nameOf}>
      {ownPane}
      <FittingReadouts groups={groups} ductsHref={ductsLink("all", search)}
        waiting={!sheet ? "Open a fan first" : state.inputs ? null : "Wait for inputs"} />
    </CalcFrame>
  );
}
/** Drawing consumers own a mutable clone; the kernel retains immutable evidence. */
export function calcSnapshot(value: import("@pe/agent-contracts").Immutable<DuctSnapshot | { kind: "absent" }> | undefined): (DuctSnapshot & { sourceVersion?: string }) | { kind: "absent" } {
  return structuredClone(value ?? { kind: "absent" }) as (DuctSnapshot & { sourceVersion?: string }) | { kind: "absent" };
}
export function CalcFrame({
  ctx,
  snapshot,
  nameOf,
  jump,
  children,
}: {
  ctx: CalcContext;
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
      <SubjectTextContext.Provider value={{ doc: attentionDoc, nameOf, uniqueIdOf: elements.uniqueIdOf, go, refProps }}>
          {children}

      </SubjectTextContext.Provider>
    </>
  );
}
