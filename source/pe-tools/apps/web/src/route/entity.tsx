/**
 * The entity route body: the Situation selects the target and the pod, the audit is the page,
 * and capture/apply open the spec editor beside it. `/family`, `/families` and `/schedules` are
 * definitions (`entityRoute`), not implementations.
 */
import { useEffect, type ReactNode } from "react";

import { Pane, PaneSplit } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { previousOf } from "#/readings";

import { isSpecOf, type EntityPage, type EntityRouteDef, type PodRow } from "./manifest";
import { Picker } from "./picker";
import { SpecEditor, type DemoSpec } from "./spec-editor";
import { Situation, SituationCell, useDocumentLadder } from "./situation";
import type { RouteHandle } from "./use-route";

type Handle = RouteHandle<any, any, EntityPage, any>;

export function EntityRouteView({
  def,
  handle,
  refreshPods,
  fixture,
  facts,
  children,
}: {
  def: EntityRouteDef<any, any, any>;
  handle: Handle;
  refreshPods: () => void;
  fixture?: DemoSpec;
  /** Ledger lines the audit adds to the Situation. */
  facts?: readonly (readonly [string, ReactNode])[];
  /** The audit. */
  children: ReactNode;
}) {
  const [page, setPage] = handle.page;
  const ladder = useDocumentLadder(handle);
  const pods = (previousOf(handle.readings.pods) as readonly PodRow[] | undefined) ?? [];
  const pod = pods.find((row) => row.id === page.pod) ?? null;
  const specs = pod?.members.filter((member) => isSpecOf(member.schema, def.schema)) ?? [];
  const member = pod?.members.find((row) => row.path === page.path);
  const outcome = handle.outcome;

  // A capture or apply files bytes in the pod; the list is the only thing that must re-read.
  useEffect(() => {
    if (outcome) refreshPods();
  }, [outcome, refreshPods]);

  const podCell = (
    <SituationCell io="rw" empty={!pod}>
      <Picker
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
            pick: (id) => setPage({ pod: id, path: "" }),
          },
          ...(page.stage === "apply"
            ? [
                {
                  key: "spec",
                  label: page.path ? (page.path.split("/").at(-1) ?? page.path) : null,
                  placeholder: `choose a ${def.entity} spec`,
                  options: pod ? specs.map((row) => ({ id: row.path, label: row.path })) : null,
                  note: pod ? `no ${def.entity} specs in this pod` : "choose a pod first",
                  picked: (id: string) => id === page.path,
                  pick: (id: string) => setPage({ path: id }),
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
          commit={page.stage === "apply" ? "apply" : undefined}
          sentence={
            <>
              {def.entity} in <Picker levels={ladder.levels} disabled={handle.busy !== null} />,
              filed to {podCell}.
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
        resize={{
          target: "end",
          defaultSize: 480,
          minSize: 320,
          persist: `${def.key}:spec`,
        }}
        start={children}
        end={
          page.stage === "audit" ? null : (
            <Pane kind="inspector" title="spec" meta={def.entity} side="right">
              <SpecEditor
                member={page.pod && page.path ? { pod: page.pod, path: page.path } : null}
                // A just-captured member is this route's spec before the pod list re-reads.
                schema={member ? member.schema : new URL(def.schema, location.origin).href}
                fixture={fixture}
                onSaved={(ref) => {
                  refreshPods();
                  setPage({ pod: ref.pod, path: ref.path });
                }}
              />
            </Pane>
          )
        }
      />
    </Surface>
  );
}
