/** Route-owned Situation: the primary lamp and controls join the global bar; the neutral page
 * body lives in its mounted drawer. Hosted and standalone routes keep the same body locally.
 * Sentence, staged Work, commit, verbs and log still project the existing owner exactly once. */
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { TrichotomyCellLike } from "@pe/agent-contracts";
import { PrimaryRouteControls } from "#/navigation/route-controls";
import {
  WorkSentence,
  workWord,
  WorkStanding,
  workSummary,
  type CellWire,
  type WorkSummary,
} from "#/components/work/band";
import { useHostEvents } from "#/readings";
import { situationCells } from "./cells";
import { Ladder } from "./ladder";
import type { ActionHandle, RouteHandle } from "./handle";
import { Ledger, PageLog } from "./situation-grids";
import { useChatPlanIntent } from "./situation-ladder";
import { ChainLamp, Cluster } from "./situation-lamp";
import { ActionBoard, SituationAction } from "./situation-verbs";
import { PaletteKey } from "./situation-marks";

export interface SituationProps {
  handle: RouteHandle<any, any, any, any>;
  /** The route's slots after the stage word, joined by the route's own words. */
  sentence: ReactNode;
  /** The document's complaint for the chain lamp; null = healthy. */
  health?: string | null;
  /** Diagnostic projection of the target selected by the sentence. */
  target: { session: string | null; document: string | null };
  /**
   * Saved observations have no live target, Work controls, verbs, or route log. The stage word
   * reads History; a route without a History stage leaves it by choosing a live stage.
   */
  inspection?: boolean;
  /** A controller transition when changing stage has dependent state. */
  chooseStage?: (stage: string) => void;
  /** The verb that commits Work; drawn bold. */
  commit?: string;
  /** The stage verbs the row draws, as the route's stage declares them; absent = every verb of the stage. */
  verbs?: readonly string[];
  /** The chords the stage node binds, by verb (`StageDecl.keys`); the row draws them beside the verb. */
  chords?: Readonly<Record<string, string | undefined>>;
  /** False: no Work meter beside the verbs (`StageDecl.meter`). */
  meter?: false;
  /**
   * The Work slot, given the cells' summary and the default sentence (`WorkSentence`, with the
   * aggregates and the commit verb). Absent, the sentence alone. A route with cells keeps the
   * sentence and adds beside it: while cells are staged the commit is drawn nowhere else.
   */
  work?: WorkRender;
  /** How the default's aggregates write; absent = the Work's own write at the manifest's segment. */
  wire?: CellWire;
  /** Read-only, in the start-fresh confirm: what the set-aside Work carried (a route's salvage). */
  startFreshAside?: ReactNode;
  /** After start fresh landed: the route may offer what the old Work carried. */
  onStartedFresh?: () => void;
  /** Lines for the ledger behind the state gauge: what is bound, how fresh, which revision. */
  ledger?: readonly (readonly [string, ReactNode])[];
  /**
   * THE SITUATION PALETTE: opens the sentence's target ladder, so switching what the page shows
   * is one chord from anywhere. Present, Ctrl K is bound and its keycap sits right of the sentence.
   */
  palette?: () => void;
}

/**
 * The receipt for an addressless Work the host swept when its document closed: the host owns that
 * edge and says on the World stream how many Work documents it removed, so the route reports what
 * was deleted rather than the count it last saw staged (2026-09-22, addressless Work is ephemeral).
 */
function useDiscardReceipt(handle: RouteHandle<any, any, any, any>, enabled = true) {
  const route = handle.manifest.work?.route ?? null;
  const open = handle.work.key.open ?? handle.bindingLost?.ref ?? null;
  const session = open?.session ?? null;
  const openId = open?.openId ?? null;
  const [removed, setRemoved] = useState(0);
  useHostEvents<DiscardEvent>(
    enabled && !handle.demo && route !== null && session !== null,
    useCallback(
      (event) => {
        if (event.type !== "route_workspace" || event.action !== "discard") return;
        if (event.route !== route) return;
        if (event.scope.open?.session !== session || event.scope.open?.openId !== openId) return;
        setRemoved(event.removed ?? 1);
      },
      [route, session, openId],
    ),
  );
  if (removed === 0) return false;
  return {
    text:
      removed === 1
        ? "unsaved document closed — the Work staged on it was discarded"
        : `unsaved document closed — the Work staged on it was discarded from ${removed} routes`,
    dismiss: () => setRemoved(0),
  };
}

const NO_CELLS: Record<string, TrichotomyCellLike> = {};

type WorkDraw = (summary: WorkSummary, sentence: ReactNode) => ReactNode;
/**
 * The Work slot: the draw alone, or the draw plus display-only cells the summary counts and no
 * aggregate writes (a native patch projected onto the cells it would write, ruling 14).
 */
type WorkRender = WorkDraw | { draw: WorkDraw; counted: Record<string, TrichotomyCellLike> };

type DiscardEvent = {
  type?: string;
  action?: string;
  route?: string;
  removed?: number;
  scope: { open?: { session: string; openId: string } };
};

export function Situation({
  handle,
  sentence,
  health,
  target,
  inspection = false,
  chooseStage,
  commit,
  verbs: declaredVerbs,
  chords,
  meter,
  work: slot,
  wire: routeWire,
  startFreshAside,
  onStartedFresh,
  ledger,
  palette,
}: SituationProps) {
  const [page, setPage] = handle.page as [
    Record<string, unknown>,
    (p: Record<string, unknown>) => void,
  ];
  const declared = handle.manifest.stages ?? [];
  const archived = inspection && !declared.some((item) => item.key === "history");
  const stages = archived ? [{ key: "history", word: "History" }, ...declared] : declared;
  const stage = archived ? "history" : typeof page.stage === "string" ? page.stage : null;
  const word = stages.find((item) => item.key === stage)?.word ?? handle.manifest.name;
  const spec = situationCells(handle.manifest.cells);
  const doc = handle.work.doc as Record<string, Record<string, TrichotomyCellLike>> | null;
  const cells = (spec && doc?.[spec.segment]) || NO_CELLS;
  const wire: CellWire = routeWire ?? {
    segment: spec?.segment ?? null,
    revision: handle.work.revision,
    write: handle.work.write,
  };
  const { lockOf } = wire;
  const work = typeof slot === "function" ? slot : slot?.draw;
  const counted = typeof slot === "function" ? undefined : slot?.counted;
  const summary = useMemo(
    () =>
      workSummary(
        counted ? { ...cells, ...counted } : cells,
        { groupOf: spec?.groupOf ?? (() => []), lockOf },
        spec?.nouns,
      ),
    [cells, counted, spec, lockOf],
  );
  const verbs = Object.entries(handle.actions).filter(
    ([name, action]) =>
      (declaredVerbs ? declaredVerbs.includes(name) : !action.stage || action.stage === stage) &&
      (handle.manifest.actions as Record<string, { visible?: false }> | undefined)?.[name]
        ?.visible !== false &&
      // The commit verb is drawn once: in the Work sentence while something is staged, else here.
      !(name === commit && summary.staged > 0),
  ) as [string, ActionHandle][];
  const receipt = useDiscardReceipt(handle, !inspection);
  const commitAction = !inspection && commit ? handle.actions[commit] : undefined;
  const workLine = (
    <WorkSentence
      summary={summary}
      cells={cells}
      wire={wire}
      commit={
        commit && commitAction ? (
          <SituationAction
            handle={handle}
            name={commit}
            action={commitAction}
            chord={chords?.[commit] ?? commitAction.chord}
            commit
          />
        ) : null
      }
    />
  );
  useChatPlanIntent(handle, commitAction);
  const meterWord = workWord({
    revision: handle.work.revision,
    conflict: handle.work.conflict,
    unreadable: handle.work.refusal != null,
  });
  // The band's own state, beside the verbs: a conflicting writer and the runner's last refusal
  // when no verb flag says it (a Work write and a late result after a stop have no button to grow a flag from).
  const late = handle.failure === (handle.outcome?.refusal ?? null) ? null : handle.failure;
  const unresolved = [
    handle.bindingLost?.sentence,
    handle.work.refusal,
    handle.work.conflict ? "another writer changed this Work; your last write did not land" : null,
    late ? `${late.code}: ${late.message}` : null,
  ].filter(Boolean);
  return (
    <>
      <Cluster
        handle={handle}
        lamp={
          <ChainLamp
            handle={handle}
            inspection={inspection}
            stageWord={word}
            health={health}
            session={target.session}
            document={target.document}
          />
        }
        state={
          <Ledger rows={inspection ? (ledger ?? []) : [...(ledger ?? []), ["work", meterWord]]} />
        }
      />
      <PrimaryRouteControls route={handle.manifest.key} slot="situation">
        <section aria-label="Situation" data-surface="page" className="flex min-w-0 flex-col">
          {/* the board: sentence and verbs left, Work and log right, one rung tall; they wrap under */}
          <div className="flex flex-wrap gap-x-10 gap-y-1 px-3 pt-2 pb-1">
            <div className="flex min-w-0 basis-[24rem] flex-[3] flex-col">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <p className="min-w-0 t-small text-ink-2 [&_b]:font-semibold [&_b]:text-ink">
                  {/* Stages are an optional layer: one stage draws no switcher (ledger 2026-09-22). */}
                  {stages.length > 1 ? (
                    <b>
                      <Ladder
                        levels={[
                          {
                            key: "stage",
                            label: word,
                            placeholder: "choose a stage",
                            options: stages.map((item) => ({ id: item.key, label: item.word })),
                            picked: (id) => id === stage,
                            pick: (id) =>
                              id === stage
                                ? undefined
                                : chooseStage
                                  ? chooseStage(id)
                                  : setPage({ stage: id }),
                          },
                        ]}
                      />
                    </b>
                  ) : (
                    <b>{word}</b>
                  )}{" "}
                  {sentence}
                </p>
              </div>
              {!inspection ? (
                <ActionBoard
                  handle={handle}
                  verbs={verbs}
                  chords={chords}
                  commit={commit}
                  work={meter === false ? null : meterWord}
                />
              ) : null}
              {inspection ? work?.(summary, null) : null}
            </div>
            {!inspection ? (
              <div
                data-slot="situation-band"
                className="h-(--head-h) min-w-0 basis-[20rem] flex-[2] overflow-y-auto"
              >
                {work ? work(summary, workLine) : workLine}
                <WorkStanding
                  conflict={handle.work.conflict}
                  unresolved={unresolved as string[]}
                  lifetime={
                    handle.work.ephemeral && summary.staged
                      ? "Unsaved document. This Work lives until it closes. Save to keep it."
                      : undefined
                  }
                  receipt={receipt || undefined}
                  reload={handle.work.reload}
                  startFresh={
                    handle.work.startFresh
                      ? () =>
                          void handle.work.startFresh?.().then((refusal) => {
                            if (!refusal) onStartedFresh?.();
                          })
                      : undefined
                  }
                  startFreshAside={startFreshAside}
                />
              </div>
            ) : null}
            {/* the log: folded to its newest row on the head's rung, opened over the grid (ruling 21) */}
            {!inspection ? (
              <div className="h-(--head-h) min-w-0 basis-[18rem] flex-[2]">
                <PageLog entries={handle.log} manifest={handle.manifest} collapsible />
              </div>
            ) : null}
          </div>
        </section>
      </PrimaryRouteControls>
      {palette ? (
        <PrimaryRouteControls route={handle.manifest.key} slot="palette">
          <PaletteKey open={palette} />
        </PrimaryRouteControls>
      ) : null}
    </>
  );
}
