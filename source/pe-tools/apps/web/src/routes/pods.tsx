/**
 * /pods — the thinnest view over `pod.list`: every pod's members, the one spec editor, and the
 * runs filed against the open member. It performs no Revit action; a spec links to the product
 * route its `$schema` names.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { PickList } from "#/components/lang/pick-list";
import { Provenance } from "#/components/lang/section";
import { Surface } from "#/components/lang/surface";
import { defineRoute, isSpecOf, type MemberRef, type PodRow } from "#/route";
import { RECEIPT_PATH, podHost, usePodList, type Receipt } from "#/route/pods";
import { familiesSpec } from "#/families/manifest";
import { scheduleSpec } from "#/route/schedules/manifest";
import {
  DEMO_PODS,
  DEMO_RECEIPT,
  DEMO_RECEIPT_PATH,
  DEMO_SPEC,
  DEMO_SPEC_PATH,
  PODS_SEEDS,
} from "#/route/seeds";
import { SpecEditor } from "#/route/spec-editor";

export const manifest = defineRoute({ key: "pods", name: "Pods", seeds: PODS_SEEDS });

/** Every entity route definition; `/family` joins when it is on the kernel. */
const PRODUCT_ROUTES = [
  { to: "/schedules", def: scheduleSpec },
  { to: "/families", def: familiesSpec },
] as const;

// `|` is illegal in Windows paths, so it cannot occur in a pod id or member path.
const SEP = "|";

export const Route = createFileRoute("/pods")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { pod?: string; path?: string; demo?: string } => ({
    pod: typeof search.pod === "string" ? search.pod : undefined,
    path: typeof search.path === "string" ? search.path : undefined,
    demo: typeof search.demo === "string" ? search.demo : undefined,
  }),
  component: PodsRoute,
});

function PodsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const select = (ref: MemberRef) =>
    void navigate({ to: ".", search: (previous) => ({ ...previous, ...ref }), replace: true });
  return <PodsRouteContent {...search} select={select} />;
}

export function PodsRouteContent({
  pod,
  path,
  demo,
  select,
}: {
  pod?: string;
  path?: string;
  demo?: string;
  select: (ref: MemberRef) => void;
}) {
  const [live, refresh] = usePodList(!demo);
  const pods: readonly PodRow[] = demo
    ? DEMO_PODS
    : live.state === "ready"
      ? (live.observation as PodRow[])
      : live.state === "stale"
        ? (live.previous as PodRow[])
        : [];
  const ref = demo && !pod ? { pod: DEMO_PODS[0]!.id, path: DEMO_SPEC_PATH } : { pod, path };
  const row = pods.find((item) => item.id === ref.pod);
  const member = row?.members.find((item) => item.path === ref.path) ?? null;
  const product = member
    ? PRODUCT_ROUTES.find((route) => isSpecOf(member.schema, route.def.schema))
    : undefined;
  const { failure: runsFailure, runs: receipts } = useReceipts(
    row ?? null,
    member?.path ?? null,
    !!demo,
  );

  return (
    <Surface>
      <AddressingBar
        name="pods"
        sentence={
          member ? (
            <span className="face-mono">
              {row!.name} · {member.path}
            </span>
          ) : (
            <Provenance>no member open</Provenance>
          )
        }
        facts={
          <>
            <FactChip title="Installed pods under Documents/Pe.Tools/Pods.">
              {pods.length} pods
            </FactChip>
            {demo ? (
              <FactChip tone="caution" dashed title="Demo lane: pods and runs are fixture.">
                fixture
              </FactChip>
            ) : null}
            {product ? (
              <Link
                to={product.to}
                // The spec opens selected in the product route's apply stage; the demo lane keeps
                // its seed so the link lands on a rendered route.
                search={
                  {
                    stage: "apply",
                    pod: row!.id,
                    path: member!.path,
                    ...(demo ? { demo: "apply" } : {}),
                  } as never
                }
                title={`Open this spec in ${product.def.name}; apply happens there.`}
              >
                open in {product.def.name}
              </Link>
            ) : null}
          </>
        }
      />
      {live.state === "failed" ? (
        <OutcomeLine kind="error" label="pod.list" says={live.message} />
      ) : null}
      <PaneSplit
        axis="horizontal"
        grow
        resize={{ target: "start", defaultSize: 300, minSize: 220, persist: "pods:members" }}
        start={
          <Pane kind="navigation" flush title="members" meta={String(pods.length)} side="left">
            {pods
              .filter((item) => item.diagnostics.length)
              .map((item) => (
                <OutcomeLine
                  key={item.id}
                  kind="error"
                  label={item.name}
                  says={item.diagnostics.map((d) => d.message).join("; ")}
                />
              ))}
            <PickList
              items={pods.flatMap((item) =>
                item.members
                  .filter((m) => !RECEIPT_PATH.test(m.path))
                  .map((m) => ({
                    id: `${item.id}${SEP}${m.path}`,
                    label: m.path,
                    group: `${item.name} · ${item.version}`,
                    meta: m.schema
                      ? m.schema
                          .split("/")
                          .at(-1)
                          ?.replace(/\.json$/, "")
                      : undefined,
                    hint: m.schema ?? "no $schema: plain data",
                  })),
              )}
              activeId={member ? `${row!.id}${SEP}${member.path}` : null}
              onPick={(id) => {
                const [p, m] = id.split(SEP);
                select({ pod: p!, path: m! });
              }}
              placeholder="Filter members…"
              emptyNote={live.state === "absent" && !demo ? "reading pods…" : "No pods installed."}
            />
          </Pane>
        }
        end={
          <PaneSplit
            axis="horizontal"
            grow
            resize={{ target: "end", defaultSize: 300, minSize: 220, persist: "pods:runs" }}
            start={
              <Pane kind="content" title="spec" meta={member?.path}>
                {member && !member.path.endsWith(".json") ? (
                  <EmptyState story="scope" exit="pick a JSON member to edit it">
                    {member.path} is source, not a spec
                  </EmptyState>
                ) : (
                  <SpecEditor
                    member={member ? { pod: row!.id, path: member.path } : null}
                    schema={member?.schema ?? null}
                    fixture={demo ? DEMO_SPEC : undefined}
                    onSaved={(saved) => {
                      refresh();
                      select(saved);
                    }}
                  />
                )}
              </Pane>
            }
            end={
              <Pane kind="inspector" title="runs" meta={String(receipts.length)} side="right">
                {runsFailure ? <OutcomeLine kind="error" label="runs" says={runsFailure} /> : null}
                {receipts.length ? (
                  <div className="hairline-rows">
                    {receipts.map(([run, receipt]) => (
                      <div key={run} className="flex flex-col px-3 py-1">
                        <span className="face-mono t-small text-ink">{run}</span>
                        <span>
                          {receipt.operation} · {receipt.outcome}
                        </span>
                        <span className="face-mono t-small text-ink-mute">
                          {receipt.memberSha256.slice(0, 12)}
                          {receipt.memberSha256 === member?.sha256
                            ? " · these bytes"
                            : " · older bytes"}
                        </span>
                        {receipt.outputs?.map((output) => (
                          <span key={output} className="t-small text-ink-2">
                            {output}
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState story="scope" exit="apply this spec from its product route">
                    no runs for this member
                  </EmptyState>
                )}
              </Pane>
            }
          />
        }
      />
    </Surface>
  );
}

/** Receipts under the pod's `output/*`, filtered to the open member. */
function useReceipts(pod: PodRow | null, path: string | null, demo: boolean) {
  const [all, setAll] = useState<readonly (readonly [string, Receipt])[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const runs = useMemo(
    () => pod?.members.flatMap((m) => RECEIPT_PATH.exec(m.path)?.[1] ?? []) ?? [],
    [pod],
  );
  useEffect(() => {
    setFailure(null);
    if (demo) return setAll([[RECEIPT_PATH.exec(DEMO_RECEIPT_PATH)![1]!, DEMO_RECEIPT]]);
    if (!pod) return setAll([]);
    let live = true;
    // ponytail: one read per run; a `pod.runs` op when pods carry hundreds of runs.
    void Promise.all(
      runs.map(async (run) => {
        const { content } = await podHost.read({ pod: pod.id, path: `output/${run}/receipt.json` });
        return [run, JSON.parse(content) as Receipt] as const;
      }),
    ).then(
      (rows) => live && setAll(rows.sort(([a], [b]) => b.localeCompare(a))),
      (error: unknown) =>
        live && setFailure(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      live = false;
    };
  }, [pod, runs, demo]);
  return { failure, runs: all.filter(([, receipt]) => receipt.memberPath === path) };
}
