/**
 * /pods — the thinnest view over `pod.list`: every pod's members, the one spec editor, and the
 * runs filed against the open member. It performs no Revit action; a spec links to the product
 * route its `$schema` names.
 */
import { frozenDemo } from "#/host/demo-client";
import { useEffect, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip } from "#/components/lang/chip";
import { EmptyState } from "#/components/lang/empty";
import { OutcomeLine } from "#/components/lang/outcome";
import { Pane, PaneSplit } from "#/components/lang/pane";
import { PickList } from "#/components/lang/pick-list";
import { Provenance } from "#/components/lang/section";
import { Surface } from "#/components/lang/surface";
import {
  defineRoute,
  isSpecOf,
  useRoute,
  useRouteThread,
  type MemberRef,
  type PodRow,
} from "#/route";
import { LadderPicker, useDocumentLadder } from "#/route/situation";
import { podHost, usePodList, type Run } from "#/route/pods";
import { familiesSpec } from "#/families/manifest";
import { FAMILY_DEMO_PODS, familySpec } from "#/route/family/manifest";
import { scheduleSpec } from "#/route/schedules/manifest";
import { familyFixtures } from "#/family/authored-families";
import { familyDemoFields } from "#/route/family/manifest";
import { DEMO_FAMILIES_SPEC } from "#/families/seeds";
import {
  DEMO_FAMILIES_SPEC_PATH,
  DEMO_FRAGMENTS,
  DEMO_PODS,
  DEMO_RUN,
  DEMO_SPEC,
  DEMO_SPEC_PATH,
  PODS_SEEDS,
} from "#/route/seeds";
import { SpecEditor, type DemoSpec } from "#/route/spec-editor";

/** `/pods` acts on no document; it reads the thread head so field options and links carry it. */
export const manifest = defineRoute({
  key: "pods",
  name: "Pods",
  needs: "document",
  seeds: PODS_SEEDS,
});

/** Every entity route definition; `/family` joins when it is on the kernel. */
const PRODUCT_ROUTES = [
  { to: "/schedules", def: scheduleSpec },
  // A family model is both routes' spec; the single-family route is its first home.
  { to: "/family", def: familySpec },
  { to: "/families", def: familiesSpec },
] as const;

// `|` is illegal in Windows paths, so it cannot occur in a pod id or member path.
const SEP = "|";

/** The demo lane browses every product route's demo pod, so each deep link has a member to open. */
const DEMO_BROWSE = [...DEMO_PODS, ...FAMILY_DEMO_PODS];

/** Each demo member's own seeded bytes, by `pod|path`; the family models carry their Pea lane. */
export const DEMO_MEMBER_SPECS = new Map<string, DemoSpec>([
  [`${DEMO_PODS[0]!.id}${SEP}${DEMO_SPEC_PATH}`, DEMO_SPEC],
  [`${DEMO_PODS[0]!.id}${SEP}${DEMO_FAMILIES_SPEC_PATH}`, DEMO_FAMILIES_SPEC],
  ...Object.entries(DEMO_FRAGMENTS).map(
    ([path, spec]) => [`${DEMO_PODS[0]!.id}${SEP}${path}`, spec] as const,
  ),
  ...FAMILY_DEMO_PODS[0]!.members.map((m) => {
    const content =
      familyFixtures[
        m.path
          .split("/")
          .at(-1)!
          .replace(/\.json$/, "") as never
      ];
    return [
      `${FAMILY_DEMO_PODS[0]!.id}${SEP}${m.path}`,
      { content, schema: "", fields: familyDemoFields(content) },
    ] as const;
  }),
]);

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
  const thread = useRouteThread();
  const navigate = useNavigate();
  const select = (ref: MemberRef) =>
    void navigate({ to: ".", search: (previous) => ({ ...previous, ...ref }), replace: true });
  // The live demo lane browses the demo owner's pods through the live path.
  return (
    <PodsRouteContent
      {...search}
      thread={thread}
      demo={frozenDemo() ?? undefined}
      select={select}
    />
  );
}

export function PodsRouteContent({
  pod,
  path,
  target,
  thread,
  demo,
  select,
}: {
  pod?: string;
  path?: string;
  /** A `?target` pin; the root carries it out through `open in <Route>`. */
  target?: string;
  /** The thread whose head is the target store; the root carries it out through every link. */
  thread?: string;
  demo?: string;
  select: (ref: MemberRef) => void;
}) {
  const handle = useRoute(manifest, { target: target ?? null, thread });
  const ladder = useDocumentLadder(handle);
  // Field options read the thread's document; choosing one here moves the thread (ledger 2026-09-17).
  const optionsFrom =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const [live, refresh] = usePodList(!demo);
  const pods: readonly PodRow[] = demo
    ? DEMO_BROWSE
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
  const { failure: runsFailure, runs } = usePodRuns(row?.id ?? null, member?.path ?? null, !!demo);

  return (
    <Surface>
      <AddressingBar
        name="pods"
        sentence={
          <>
            {member ? (
              <span className="face-mono">
                {row!.name} · {member.path}
              </span>
            ) : (
              <Provenance>no member open</Provenance>
            )}{" "}
            options from <LadderPicker ladder={ladder} />
            {ladder.refusal ? (
              <span role="status" data-tone="caution">
                {" "}
                · {ladder.refusal}
              </span>
            ) : null}
          </>
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
                item.members.map((m) => ({
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
                    // The draft is per member; switching members starts a fresh editor.
                    key={member ? `${row!.id}${SEP}${member.path}` : ""}
                    member={member ? { pod: row!.id, path: member.path } : null}
                    schema={member?.schema ?? null}
                    optionsFrom={optionsFrom}
                    fixture={
                      demo && member
                        ? DEMO_MEMBER_SPECS.get(`${row!.id}${SEP}${member.path}`)
                        : undefined
                    }
                    onSaved={(saved) => {
                      refresh();
                      select(saved);
                    }}
                  />
                )}
              </Pane>
            }
            end={
              <Pane kind="inspector" title="runs" meta={String(runs.length)} side="right">
                {runsFailure ? <OutcomeLine kind="error" label="runs" says={runsFailure} /> : null}
                {runs.length ? (
                  <div className="hairline-rows">
                    {runs.map(({ runId, receipt, error }) => (
                      <div key={runId} className="flex flex-col px-3 py-1">
                        <span className="face-mono t-small text-ink">{runId}</span>
                        {receipt ? (
                          <>
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
                          </>
                        ) : (
                          // A crashed run leaves this folder on disk; the op reports it, not hides it.
                          <OutcomeLine kind="error" label="receipt" says={error ?? "unreadable"} />
                        )}
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

/** The pod's runs, narrowed to the open member. One host read, newest first. */
function usePodRuns(pod: string | null, path: string | null, demo: boolean) {
  const [runs, setRuns] = useState<readonly Run[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    setFailure(null);
    if (demo) return setRuns(path === DEMO_RUN.receipt!.memberPath ? [DEMO_RUN] : []);
    if (!pod || !path) return setRuns([]);
    let live = true;
    podHost.runs(pod, path).then(
      (rows) => live && setRuns(rows),
      (error: unknown) =>
        live && (setRuns([]), setFailure(error instanceof Error ? error.message : String(error))),
    );
    return () => {
      live = false;
    };
  }, [pod, path, demo]);
  return { failure, runs };
}
