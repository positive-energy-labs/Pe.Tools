import { createContext, useContext, useMemo, type ReactNode } from "react";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { AttentionRoot } from "#/attention";
import { useRevitSubjectProps } from "#/revit/element-menu";
import { DuctsOwner } from "../pane-context";
import type { ProtoProps } from "../proto/props";
import { subjectNamer } from "../subject-text";
import { rosterOrder } from "./model";
import { EMPTY_SNAPSHOT } from "./scoped-snapshot";
import { InputsSurface } from "./inputs-surface";
import { SheetPicture } from "./picture";
import type { SheetViewProps } from "./types";
import { Roster, RosterVerbs, Ledger } from "./view";
import { sheetState, SHIM_TERMINAL_DROP_SOURCE } from "./state";
import { describeCloser, type Closer } from "./closer";
import { mergeSheetInputs } from "./inputs";
import type { DuctsSheetInputs } from "@pe/agent-contracts";
import type { SheetReading } from "../sources";

const SheetPanes = createContext<Readonly<Record<string, ReactNode>>>({});
export function SheetPane({ id }: { id: string }) {
  return useContext(SheetPanes)[id] ?? null;
}
/** Shared spine only. The kernel owns reading demand, Work, Page, controls and layout. */
export function SheetProvider({ props, children }: { props: ProtoProps; children: ReactNode }) {
  const owner = useContext(DuctsOwner)!;
  const reading = owner.readings.get("sheet");
  const value = reading.value as SheetReading | undefined;
  const sheet = value?.open ?? null;
  const fans = owner.readings.get("fans");
  const roster = rosterOrder(
    value?.rows ?? (fans.value as { rows: import("./model").FanPort[] } | null)?.rows ?? [],
  );
  const snapshot = props.snapshot ?? EMPTY_SNAPSHOT;
  const state = useMemo(() => sheetState(sheet, props.work.doc), [sheet, props.work.doc]);
  const nameOf = useMemo(() => subjectNamer(snapshot), [snapshot]);
  const refProps = useRevitSubjectProps();
  const subjects = useMemo(
    () => ({ doc: props.attentionDoc, nameOf, go: props.onSelect, refProps }),
    [props.attentionDoc, nameOf, props.onSelect, refProps],
  );
  const busy = ["pending", "partial"].includes(reading.status);
  const changeInputs = (edits: DuctsSheetInputs) => {
    void owner.control("sheet-inputs", { edits, expectedRevision: props.work.revision }).run();
  };
  const closerOf = (blocker: import("./tiers").SheetBlocker, typed: number | null) =>
    describeCloser(blocker, typed, {
      defaults: state.defaults,
      dropSource:
        state.defaults.terminalDropSource === SHIM_TERMINAL_DROP_SOURCE
          ? "firm shim"
          : state.defaults.terminalDropSource,
      nameOf,
      wait: busy
        ? "Wait for the current read"
        : sheet?.inputs && reading.current
          ? null
          : "Reading inputs detail",
      fan: sheet?.overview.fan
        ? {
            unitId: sheet.overview.fan.unitId,
            name: sheet.overview.fan.mark || nameOf(sheet.overview.fan.unitId) || "unit",
          }
        : null,
    });
  const editsFor = (closers: readonly Closer[]) =>
    closers.reduce<DuctsSheetInputs>((edits, closer) => {
      if (closer.refusal || !closer.action) return edits;
      const action = closer.action;
      switch (action.kind) {
        case "rule":
          return {
            ...edits,
            rulings: [
              ...(edits.rulings ?? state.projectInputs.rulings ?? []).filter(
                (ruling) => !ruling.pair.every((end) => action.pair.includes(end)),
              ),
              { pair: action.pair, verdict: "accept" },
            ],
          };
        case "cap":
          return {
            ...edits,
            endRulings: [
              ...(edits.endRulings ?? state.projectInputs.endRulings ?? []).filter(
                (ruling) =>
                  ruling.end.elementId !== action.end.elementId ||
                  ruling.end.connector !== action.end.connector,
              ),
              { end: action.end, verdict: "capped" },
            ],
          };
        case "drop":
          return mergeSheetInputs(edits, { drops: { [action.elementId]: action.value } });
        case "cfm":
          return mergeSheetInputs(edits, { endCfm: { [action.elementId]: action.value } });
        case "unitCfm":
          return mergeSheetInputs(edits, { unitCfm: { [action.unitId]: action.value } });
      }
    }, {});
  const selected = Number(props.page.selected.replaceAll('"', ""));
  const focused = state.blockers.find((blocker) => blocker.id === props.page.issue);
  const elementId =
    focused?.elementId ?? (Number.isInteger(selected) && selected > 0 ? selected : null);
  const element =
    elementId == null
      ? null
      : {
          id: elementId,
          family: snapshot.nodes.find((node) => node.id === elementId)?.family ?? null,
        };
  const setDefaults: SheetViewProps["setDefaults"] = (next) => {
    void owner
      .control("sheet-defaults", { edits: next, expectedRevision: props.work.revision })
      .run();
  };
  const fanReading = fans.value as { slots: SheetViewProps["slots"]; activeSlot: string } | null;
  const spine: SheetViewProps = {
    ...state,
    snapshot,
    roster,
    sheet,
    slots: fanReading?.slots ?? [],
    activeSlot: state.projectInputs.slot ?? fanReading?.activeSlot ?? "",
    busy,
    loading: fans.status === "pending",
    error: reading.error ?? fans.error ?? null,
    progress: value?.progress ?? null,
    open: (fan) => {
      owner.view.setPage({
        fanPort: { unitId: fan.unitId, portIndex: fan.portIndex },
        allFans: false,
        sheetPath: "",
      });
    },
    computeAll: () => {
      owner.view.setPage({ allFans: true, fanPort: null });
    },
    cancel: () => {
      owner.view.setPage({ allFans: false, fanPort: null });
    },
    refresh: () => {
      void owner.control("refresh").run();
    },
    changeInputs,
    rule: (proposal) =>
      changeInputs({
        rulings: [
          ...(state.projectInputs.rulings ?? []).filter(
            (ruling) => !ruling.pair.every((end) => proposal.pair.includes(end)),
          ),
          proposal,
        ],
      }),
    pickPath: (sheetPath) => {
      owner.view.setPage({ sheetPath });
    },
    setDefaults,
    closerOf,
    close: (closer) => changeInputs(editsFor([closer])),
    closeMany: (closers) => changeInputs(editsFor(closers)),
    focusedBlocker: props.page.issue || null,
    focusBlocker: (issue) => {
      props.setPage({ issue: issue ?? "" }, { history: "push" });
    },
    picture: (renderPane) => (
      <SheetPicture
        props={props}
        snapshot={snapshot}
        sheet={sheet}
        blockers={state.blockers}
        renderPane={renderPane}
      />
    ),
    inputsSurface: (
      <InputsSurface
        ctx={{
          snapshot,
          doc: props.work.doc,
          revision: props.work.revision,
          sheet,
          defaults: state.defaults,
          projectInputs: state.projectInputs,
          slots: fanReading?.slots ?? [],
          activeSlot: state.projectInputs.slot ?? fanReading?.activeSlot ?? "",
          element,
        }}
        busy={busy}
        elementName={element ? nameOf(element.id) : null}
        onSlot={(slot) => changeInputs({ slot })}
        changeInputs={changeInputs}
        setDefaults={setDefaults}
      />
    ),
  };
  const panes = {
    "sheet-roster": (
      <>
        <RosterVerbs props={spine} />
        <Roster props={spine} />
      </>
    ),
    "sheet-inputs": spine.inputsSurface,
    "sheet-picture": spine.picture((body) => body),
    "sheet-ledger": <Ledger props={spine} />,
  };
  return (
    <AttentionRoot doc={props.attentionDoc}>
      <SubjectTextContext.Provider value={subjects}>
        <SheetPanes value={panes}>{children}</SheetPanes>
      </SubjectTextContext.Provider>
    </AttentionRoot>
  );
}
