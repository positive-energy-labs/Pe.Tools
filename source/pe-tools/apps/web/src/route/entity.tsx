/**
 * The entity route body: the Situation selects the target and the pod, the audit is the page,
 * and capture/apply open the spec editor beside it; a planned apply opens the confirmation sheet
 * above the editor. `/family`, `/families` and `/schedules` are definitions (`entityRoute`), not
 * implementations. Stage, pod and path live in the URL so `/pods` can deep-link a spec.
 */
import { useEffect, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { previousOf } from "#/readings";

import { isSpecOf, sheetOf, type EntityPage, type EntityRouteDef, type PodRow } from "./manifest";
import { Ladder } from "./ladder";
import { PlanSheetView } from "./plan-sheet";
import { SpecEditor, type DemoSpec } from "./spec-editor";
import { LadderPicker, Situation, SituationCell, useDocumentLadder } from "./situation";
import type { RouteHandle } from "./use-route";

type Handle = RouteHandle<any, any, EntityPage, any>;

/** Page → URL. Defaults stay out of the address so a bare route URL stays bare. */
function useEntityUrl(page: EntityPage, enabled: boolean) {
  const navigate = useNavigate();
  const { stage, pod, path } = page;
  useEffect(() => {
    if (!enabled) return;
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        stage: stage === "audit" ? undefined : stage,
        pod: pod || undefined,
        path: path || undefined,
      }),
      replace: true,
    } as never);
  }, [enabled, navigate, stage, pod, path]);
}

const NOTHING_HELD: ReadonlySet<string> = new Set();

export function EntityRouteView({
  def,
  handle,
  refreshPods,
  fixture,
  facts,
  subject,
  band,
  health,
  hold,
  url = true,
  pick,
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
  /** Route content under the Situation's verb row. */
  band?: ReactNode;
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
  /** The audit. */
  children: ReactNode;
}) {
  const [page, setPage] = handle.page;
  useEntityUrl(page, url);
  const ladder = useDocumentLadder(handle);
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
          ...(page.stage === "apply" || def.specPicker === "always"
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

  return (
    <Surface
      head={
        <Situation
          handle={handle}
          target={{ session: ladder.sessionWord, document: ladder.docWord }}
          health={health}
          // With a plan lane the sheet's apply is the one apply button (w8-revit trip 5); the row
          // commits by planning.
          commit={def.plan || def.staged ? "plan" : "apply"}
          band={band}
          sentence={
            <>
              {subject ?? def.entity}
              {def.target === "selection" ? ` (${page.selection.length} picked)` : ""} in{" "}
              <LadderPicker ladder={ladder} disabled={handle.busy !== null} />
              {ladder.refusal ? (
                <span role="status" data-tone="caution">
                  {" "}
                  ({ladder.refusal})
                </span>
              ) : null}
              , filed to {podCell}
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
            ["pod", pod ? `${pod.id} · ${pod.folder}` : "none"],
            ["spec", page.path || "none"],
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
          page.stage === "audit" ? null : (
            <Pane
              kind="inspector"
              title={confirming ? "plan" : "spec"}
              meta={def.entity}
              side="right"
            >
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
                  replan={() => void handle.actions.plan.run()}
                  refusal={handle.actions.apply.refusal}
                  stale={view?.stale}
                  busy={handle.busy !== null}
                />
              ) : null}
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
            </Pane>
          )
        }
      />
    </Surface>
  );
}
