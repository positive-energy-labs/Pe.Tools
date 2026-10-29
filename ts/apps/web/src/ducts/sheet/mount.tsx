/**
 * The sheet mount inside the /ducts shell (`?view=sheet`): the route's data, params, auth and
 * subject plumbing stay; only the body under them is the sheet. `SheetViewProps` is assembled here,
 * once, from the spine (`use-fan-sheet`, `picture`, `inputs-surface`); the view receives it whole
 * and never reaches past it.
 */
import { useMemo } from "react";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { AttentionRoot } from "#/attention";
import { useRevitSubjectProps } from "#/revit/element-menu";
import type { ProtoProps } from "../proto/props";
import { subjectNamer } from "../subject-text";
import { InputsSurface } from "./inputs-surface";
import { SheetPicture } from "./picture";
import type { SheetViewProps } from "./types";
import { SheetView } from "./view";
import { useFanSheet } from "./use-fan-sheet";

export function SheetScreen({ props }: { props: ProtoProps }) {
  if (!props.snapshot || !props.doc)
    return (
      <p className="p-3 text-ink-2" role="status">
        {props.empty?.says ?? (props.reading.pending ? "reading ducts…" : "no document bound")}
      </p>
    );
  return (
    <AttentionRoot doc={props.attentionDoc}>
      <Loaded props={props} snapshot={props.snapshot} target={props.doc} />
    </AttentionRoot>
  );
}

function Loaded({
  props,
  snapshot,
  target,
}: {
  props: ProtoProps;
  snapshot: DuctSnapshot;
  target: NonNullable<ProtoProps["doc"]>;
}) {
  const nameOf = useMemo(() => subjectNamer(snapshot), [snapshot]);
  const state = useFanSheet(target, props.work, nameOf);
  const refProps = useRevitSubjectProps();
  const subjects = useMemo(
    () => ({ doc: props.attentionDoc, nameOf, go: props.onSelect, refProps }),
    [props.attentionDoc, nameOf, props.onSelect, refProps],
  );
  const { page, setPage } = props;
  const focusedBlocker = page.issue || null;
  const focused = state.blockers.find((b) => b.id === focusedBlocker) ?? null;
  // The element inputs follow the focused ledger row, else the selected element, so a complete
  // sheet (no rows left) can still revise a typed drop or end cfm by selecting the element.
  const selectedId = Number(String(page.selected ?? "").replaceAll('"', ""));
  const elementId = focused?.elementId ?? (Number.isInteger(selectedId) && selectedId > 0 ? selectedId : null);
  const element =
    elementId == null
      ? null
      : { id: elementId, family: snapshot.nodes.find((n) => n.id === elementId)?.family ?? null };
  const busy = state.busy || state.loading;
  const spine: SheetViewProps = {
    snapshot,
    roster: state.roster,
    sheet: state.sheet,
    blockers: state.blockers,
    tiers: state.tiers,
    taken: state.taken,
    slots: state.slots,
    activeSlot: state.activeSlot,
    defaults: state.defaults,
    projectInputs: state.projectInputs,
    busy: state.busy,
    loading: state.loading,
    error: state.error,
    progress: state.progress,
    open: (fan) => void state.compute(fan),
    computeAll: () => void state.computeAll(),
    cancel: state.cancel,
    refresh: () => void state.refresh(),
    changeInputs: (inputs) => void state.changeInputs(inputs),
    rule: (proposal) => void state.ruleProposal(proposal),
    pickPath: (pathId) => void state.pickPath(pathId),
    setDefaults: state.setDefaults,
    closerOf: state.closerOf,
    close: state.close,
    focusedBlocker,
    focusBlocker: (id) => setPage({ issue: id ?? "" }, { history: "push" }),
    picture: (renderPane) => (
      <SheetPicture
        props={props}
        snapshot={snapshot}
        sheet={state.sheet}
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
          sheet: state.sheet,
          defaults: state.defaults,
          projectInputs: state.projectInputs,
          slots: state.slots,
          activeSlot: state.activeSlot,
          element,
        }}
        busy={busy}
        elementName={element ? nameOf(element.id) : null}
        onSlot={(slot) => void state.changeInputs({ slot })}
        changeInputs={(inputs) => void state.changeInputs(inputs)}
        setDefaults={state.setDefaults}
      />
    ),
  };
  return (
    <SubjectTextContext.Provider value={subjects}>
      <div data-sheet-view="" className="flex size-full min-h-0">
        <SheetView {...spine} />
      </div>
    </SubjectTextContext.Provider>
  );
}
