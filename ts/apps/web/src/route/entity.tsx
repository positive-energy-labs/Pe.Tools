/**
 * The entity route body: the Situation selects the target and the pod, the audit is the page,
 * and capture/apply open the spec editor beside it; a planned apply opens the confirmation sheet
 * above the editor. `/family`, `/families` and `/schedules` are definitions (`entityRoute`), not
 * implementations. Stage, pod and path are the kernel's `url` keys (`route/url.ts`).
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Pane, PaneSplit } from "#/components/lang/pane";
import { Switcher } from "#/components/lang/switcher";
import { KeysNode, stageChords } from "#/route/keys";
import { Surface } from "#/components/lang/surface";
import { previousOf } from "#/readings";

import {
  STALE_PLAN,
  isSpecOf,
  sheetOf,
  type EntityPage,
  type EntityRouteDef,
  type PodRow,
} from "./manifest";
import { Ladder, type Rung } from "./ladder";
import { PlanSheetView } from "./plan-sheet";
import { SpecEditor, type DemoSpec } from "./spec-editor";
import { Situation, type SituationProps } from "./situation";
import { LadderPicker, useDocumentLadder } from "./situation-ladder";
import { SituationCell } from "./situation-marks";
import type { RouteHandle } from "./use-route";
import type { StageDecl } from "./stage";

type Handle = RouteHandle<any, any, EntityPage, any>;

const NOTHING_HELD: ReadonlySet<string> = new Set();

export function EntityRouteView({
  def,
  handle,
  refreshPods,
  fixture,
  facts,
  subject,
  work,
  wire,
  startFreshAside,
  onStartedFresh,
  health,
  hold,
  url = true,
  pick,
  stages,
  targetRungs,
  output,
  review,
  onPalette,
  children,
}: {
  def: EntityRouteDef<any, any, any>;
  handle: Handle;
  refreshPods: () => void;
  fixture?: DemoSpec;
  /** Ledger lines the audit adds to the Situation. */
  facts?: readonly (readonly [string, ReactNode])[];
  /** What the sentence says after the stage word; defaults to the entity noun. */
  subject?: ReactNode;
  /** The Situation's Work slot and aggregate wire (`SituationProps`). */
  work?: SituationProps["work"];
  wire?: SituationProps["wire"];
  startFreshAside?: ReactNode;
  onStartedFresh?: () => void;
  /** The audit's complaint for the chain lamp; null = healthy. */
  health?: string | null;
  /** Hold a sheet row back from apply (or put it back); absent = rows cannot be held. */
  hold?: (id: string) => void;
  /** False inside a page that owns its own URL (a chat pane). */
  url?: boolean;
  /**
   * How the route opens another member; default sets the page. A route with unsaved input on the
   * open member (`/family`) settles that input first.
   */
  pick?: (member: { pod: string; path: string }) => void;
  /**
   * The route's stages, declared (`route/stage.ts`): the row draws each stage's verbs and chords,
   * and the spec pane shows where the stage names it.
   */
  stages: Readonly<Partial<Record<EntityPage["stage"], StageDecl<string, string>>>>;
  /** Route-owned refinements of the one session/document target picker. */
  targetRungs?: (ladder: ReturnType<typeof useDocumentLadder>) => readonly Rung[];
  /**
   * What the last run put out (ruling 16), in the right pane beside spec and plan. The pane turns
   * to it when it appears; null = no output yet.
   */
  output?: ReactNode;
  /** A route verb's own sheet (`/family`'s build review), drawn where the plan sheet draws. */
  review?: { title: string; body: ReactNode } | null;
  /** The sentence's ladder opened (Ctrl K or its trigger): a rung whose list is marked stale re-lists. */
  onPalette?: () => void;
  /** The audit. */
  children: ReactNode;
}) {
  const [page, setPage] = handle.page;
  const ladder = useDocumentLadder(handle);
  // The Situation palette is the sentence's ladder, opened by Ctrl K or its own trigger.
  const [palette, setPalette] = useState(false);
  const openPalette = (open: boolean) => {
    setPalette(open && handle.busy === null);
    if (open) onPalette?.();
  };
  const pods = (previousOf(handle.readings.pods) as readonly PodRow[] | undefined) ?? [];
  const pod = pods.find((row) => row.id === page.pod) ?? null;
  const specs = pod?.members.filter((member) => isSpecOf(member.schema, def.schema)) ?? [];
  const member = pod?.members.find((row) => row.path === page.path);
  const outcome = handle.outcome;
  const confirming = Boolean((def.plan || def.staged) && page.confirming);
  const view = confirming
    ? sheetOf(def, { work: handle.work, readings: handle.readings, page } as never)
    : null;
  const closed = { confirming: false, sheet: null };
  // Re-plan closes the sheet, then presses apply once more: with no sheet open, that press plans.
  const [replanning, setReplanning] = useState(false);
  useEffect(() => {
    if (!replanning || page.confirming) return;
    setReplanning(false);
    void handle.actions.apply.run();
  }, [replanning, page.confirming]); // eslint-disable-line react-hooks/exhaustive-deps
  // A sheet over no spec (the staged cells') draws no spec absence lines (F-B-6).
  const specless = confirming && !page.path;
  // TODO: hide this pane (Pane `hidden`) instead of unmounting it, so it keeps what was typed —
  // SpecEditor works while it renders, and a hidden pre-render of it never settles.
  const stage = stages[page.stage] ?? stages.audit!;
  const [pane, setPane] = useState<"spec" | "output">("spec");
  const hasOutput = output != null;
  useEffect(() => setPane(hasOutput ? "output" : "spec"), [hasOutput]);
  // A route verb's sheet is the plan sheet's sibling: the plan outranks it, and it outranks output.
  const sheet = confirming ? null : (review ?? null);
  const showOutput = !confirming && !sheet && hasOutput && pane === "output";
  const specHidden = !stage.panes.spec && !confirming && !sheet && !hasOutput;
  const podRelevant = Boolean(def.capture) || page.stage === "apply";
  // Field options come from the document this route acts on, read-only (user verdict, grill 2).
  const optionsFrom =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;

  // A capture or apply files bytes in the pod; the list is the only thing that must re-read.
  useEffect(() => {
    if (outcome) refreshPods();
  }, [outcome, refreshPods]);

  const podCell = (
    <SituationCell io="rw" empty={!pod}>
      <Ladder
        title={pod ? `${pod.folder}; pick to change` : "choose a pod"}
        levels={[
          {
            key: "pod",
            label: pod?.name ?? null,
            placeholder: "choose a pod",
            options: pods.map((row) => ({ id: row.id, label: row.name, sub: row.folder })),
            note:
              handle.readings.pods.state === "failed"
                ? handle.readings.pods.message
                : "reading pods…",
            picked: (id) => id === page.pod,
            pick: (id) => setPage({ pod: id, path: "", ...closed }),
          },
          ...((page.stage === "apply" && !specless) || def.specPicker === "always"
            ? [
                {
                  key: "spec",
                  label: page.path ? (page.path.split("/").at(-1) ?? page.path) : null,
                  placeholder: `choose a ${def.entity} spec`,
                  options: pod ? specs.map((row) => ({ id: row.path, label: row.path })) : null,
                  note: pod ? `no ${def.entity} specs in this pod` : "choose a pod first",
                  picked: (id: string) => id === page.path,
                  pick: (id: string) => {
                    setPage(closed);
                    if (pick) pick({ pod: page.pod, path: id });
                    else setPage({ path: id });
                  },
                },
              ]
            : []),
        ]}
      />
    </SituationCell>
  );

  const board = (
    <Surface
      head={
        <Situation
          handle={handle}
          target={{ session: ladder.sessionWord, document: ladder.docWord }}
          health={health}
          // Apply is the one commit: press 1 plans and opens the sheet, press 2 (row or sheet) sends it.
          commit="apply"
          verbs={stage.verbs}
          chords={stage.keys}
          meter={stage.meter}
          work={work}
          wire={wire}
          startFreshAside={startFreshAside}
          onStartedFresh={onStartedFresh}
          // A page that does not own the URL does not own the chord (Chat's Ctrl K is its own).
          palette={url && !(ladder.hosted && !targetRungs) ? () => openPalette(true) : undefined}
          sentence={
            <>
              {subject ?? def.entity}
              {def.target === "selection" ? ` (${page.selection.length} picked)` : ""} in{" "}
              {targetRungs ? (
                <Ladder
                  levels={[...(ladder.hosted ? [] : ladder.levels), ...targetRungs(ladder)]}
                  disabled={handle.busy !== null}
                  open={palette}
                  onOpenChange={openPalette}
                />
              ) : (
                <LadderPicker
                  ladder={ladder}
                  disabled={handle.busy !== null}
                  open={palette}
                  onOpenChange={openPalette}
                />
              )}
              {ladder.refusal ? (
                <span role="status" data-tone="caution">
                  {" "}
                  ({ladder.refusal})
                </span>
              ) : null}
              {podRelevant ? <>, filed to {podCell}</> : null}
              {member ? (
                <>
                  {" "}
                  (
                  <Link
                    to="/pods"
                    // The root carries the thread and any `?target` pin with it.
                    search={{ pod: page.pod, path: page.path } as never}
                    title="Open this member in the pods browser"
                  >
                    open in Pods
                  </Link>
                  )
                </>
              ) : null}
              .
            </>
          }
          ledger={[
            ...(podRelevant
              ? ([
                  ["pod", pod ? `${pod.id} · ${pod.folder}` : "none"],
                  ["spec", page.path || "none"],
                ] as const)
              : []),
            ...(facts ?? []),
          ]}
        />
      }
    >
      <PaneSplit
        axis="horizontal"
        grow
        resize={{ target: "end", defaultSize: 520, minSize: 320, persist: `${def.key}:spec` }}
        start={children}
        end={
          specHidden ? null : (
            <Pane
              kind="inspector"
              title={confirming ? "plan" : sheet ? sheet.title : showOutput ? "output" : "spec"}
              meta={def.entity}
              side="right"
              actions={
                !confirming && !sheet && hasOutput ? (
                  <Switcher
                    ariaLabel="right pane"
                    value={pane}
                    onChange={setPane}
                    options={[
                      { value: "spec", label: "spec", title: "The open member's spec" },
                      { value: "output", label: "output", title: "What the last run put out" },
                    ]}
                  />
                ) : undefined
              }
            >
              {showOutput ? output : null}
              {sheet?.body}
              {confirming ? (
                <PlanSheetView
                  sheet={view?.sheet ?? null}
                  excluded={view?.excluded ?? NOTHING_HELD}
                  included={view?.included ?? []}
                  toggle={hold}
                  apply={() => void handle.actions.apply.run()}
                  cancel={() => setPage(closed)}
                  stop={{
                    // `families.apply` checks its token between families, never inside one.
                    label: def.key === "families" ? "stop after this family" : "stop",
                    run: handle.stop,
                  }}
                  replan={{
                    says: "closes this sheet and plans again",
                    run: () => {
                      setPage(closed);
                      setReplanning(true);
                    },
                  }}
                  // The sheet's button only sends: a stale or missing plan is re-planned, never sent.
                  refusal={
                    !view
                      ? "the plan no longer describes this spec; re-plan"
                      : view.stale
                        ? STALE_PLAN
                        : handle.actions.apply.refusal
                  }
                  stale={view?.stale}
                  busy={handle.busy !== null}
                />
              ) : null}
              {specless || showOutput ? null : (
                <SpecEditor
                  member={page.pod && page.path ? { pod: page.pod, path: page.path } : null}
                  // A just-captured member is this route's spec before the pod list re-reads.
                  schema={
                    member ? member.schema : new URL([def.schema].flat()[0]!, location.origin).href
                  }
                  fixture={fixture}
                  optionsFrom={optionsFrom}
                  onSaved={(ref) => {
                    refreshPods();
                    setPage({ pod: ref.pod, path: ref.path, ...closed });
                  }}
                />
              )}
            </Pane>
          )
        }
      />
    </Surface>
  );
  // The stage node: panes nest under the stage that shows them, and the stage's own chords are
  // bound here, so a chord bound in one stage cannot fire from another. A page that does not own
  // the URL does not own the chords either (a chat pane).
  return (
    <KeysNode
      id={`${def.key}:${page.stage}`}
      keys={url ? stageChords(handle, stage.keys) : []}
      hidden={!url}
    >
      {board}
    </KeysNode>
  );
}
