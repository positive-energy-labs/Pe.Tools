import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
import { transitionPatches } from "@pe/agent-contracts";
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
import { sheetState } from "./state";
import { describeCloser, type Closer } from "./closer";
import type { DuctsSheetEdits, RouteStatePatch } from "@pe/agent-contracts";
import type { SheetReading } from "../sources";
import { editLabel, presentInputHistory, type EditMeta } from "./input-history";

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
  const busy = ["pending", "partial"].includes(reading.status);
  const changeInputs = async (
    edits: DuctsSheetEdits,
    history: EditMeta = { label: editLabel(edits, nameOf) },
  ) => {
    const result = await owner
      .control("sheet-inputs", {
        edits,
        history,
        expectedRevision: props.work.revision,
        basis: sheet?.overview.basis ?? null,
      })
      .run();
    return "refusal" in result ? { message: result.refusal.message } : undefined;
  };
  const write = async (patches: RouteStatePatch[], history: EditMeta) => {
    const result = await owner
      .control("edit", { patches, history, expectedRevision: props.work.revision })
      .run();
    return "refusal" in result ? result.refusal : null;
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
            name: sheet.overview.fan.mark || nameOf(sheet.overview.fan.unitId) || "unit",
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
        return { unitId: fan.unitId, name: mark || nameOf(fan.unitId) || `unit ${fan.unitId}` };
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
  const work = owner.snapshot().work;
  const journal = work ? owner.journal(work.handle.key).read() : null;
  const history = {
    ...presentInputHistory(journal, owner.journalRefusal()),
    undo: () => {
      void owner.restore("undo");
    },
    redo: () => {
      void owner.restore("redo");
    },
    restore: (press: string) => {
      void owner.restore("undo", press);
    },
  };
  const fanReading = fans.value as { slots: SheetViewProps["slots"]; activeSlot: string } | null;
  const spine: SheetViewProps = {
    ...state,
    snapshot,
    roster,
    sheet,
    slots: fanReading?.slots ?? [],
    activeSlot: fanReading?.activeSlot ?? "",
    busy,
    loading: fans.status === "pending",
    error: reading.error ?? fans.error ?? null,
    progress: value?.progress ?? null,
    open: (fan) => {
      owner.view.setPage({
        fan: `${fan.unitId}:${fan.portIndex}`,
        allFans: false,
        sheetPath: "",
      });
    },
    computeAll: () => {
      owner.view.setPage({ allFans: true, fan: "" });
    },
    cancel: () => {
      owner.view.setPage({ allFans: false, fan: "" });
    },
    refresh: () => {
      void owner.control("refresh").run();
    },
    changeInputs,
    rule: (proposal) => changeInputs({ joins: [proposal] }),
    pickPath: (sheetPath) => {
      owner.view.setPage({ sheetPath });
    },
    closerOf,
    close: (closer) => changeInputs(editsFor([closer]), { label: closer.verb }),
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
        act={(path, cell, kind, label) =>
          write(transitionPatches(path.slice(0, -1), path.at(-1)!, cell, { kind }), {
            label: `${kind === "take" ? "take" : "unsuggest"} Pea's ${label}`,
          })
        }
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
