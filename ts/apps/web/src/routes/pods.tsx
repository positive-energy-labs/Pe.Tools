import { listOf } from "@pe/kit/lang/collection";
import { useRouteSearch } from "#/route/activity";
/**
 * /pods — the thinnest view over `pod.list`: every pod's members, the one spec editor, and the
 * runs filed against the open member. It performs no Revit action; a spec links to the product
 * route its `$schema` names.
 */
import { routeAddress } from "@pe/agent-contracts";
import { routeSearch } from "#/route/route-owner";
import { useRouteDemo } from "#/route/activity";
import { useEffect, useState, type ReactNode } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { FactChip } from "@pe/kit/lang/chip";
import { EmptyState } from "@pe/kit/lang/empty";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Pane, PaneSplit } from "@pe/kit/lang/pane";
import { List } from "@pe/kit/lang/list-popup";
import { Button } from "@pe/kit/lang/button";
import { RunsList } from "#/route/runs-list";
import { PodPlugins } from "#/route/pod-plugins";
import { Surface } from "@pe/kit/lang/surface";
import {
  RouteShell,
  defineRoute,
  isSpecOf,
  useRoute,
  useRouteThread,
  urlPage,
  type MemberRef,
  type PodRow,
} from "#/route";
import { Situation } from "#/route/situation";
import { LadderPicker, useDocumentLadder } from "#/route/situation-ladder";
import { SituationCell } from "#/route/situation-marks";
import { podHost, usePodList, type Run } from "#/route/pods";
import { familiesSpec } from "#/families/manifest";
import { FAMILY_DEMO_PODS, familySpec } from "#/family/manifest";
import { scheduleSpec } from "#/route/schedules/manifest";
import { familyFixtures } from "#/family/authored-families";
import { familyDemoFields } from "#/family/manifest";
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
import { useRouteLease } from "#/route/view-bridge";
import { TooltipHint } from "@pe/kit/lang/tooltip";

/** Member Work needs no document. Native field-option reads require their own document target. */
export const manifest = defineRoute({
  key: "pods",
  name: "Pods",
  needs: "nothing",
  runs: ["settings.write", "settings.observe"],
  address: "pods",
  page: routeAddress("pods").schema,
  seeds: PODS_SEEDS,
});

/** Every entity route definition; `/family` joins when it is on the kernel. */
const PRODUCT_ROUTES = [
  { route: "schedules", def: scheduleSpec },
  // A family model is both routes' spec; the single-family route is its first home.
  { route: "family", def: familySpec },
  { route: "families", def: familiesSpec },
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

const url = urlPage(manifest)!;

export const Route = createFileRoute("/pods")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...routeSearch(search),
    ...url.read(search),
  }),
  search: { middlewares: [...url.middlewares] },
  component: PodsRoute,
});

function PodsRoute() {
  const { target } = useRouteSearch("pods");
  const thread = useRouteThread();
  // The live demo lane browses the demo owner's pods through the live path.
  return (
    <PodsRouteContent
      target={target}
      thread={thread ?? undefined}
      demo={useRouteDemo() ?? undefined}
      url
    />
  );
}

export function PodsRouteContent({
  target,
  thread,
  demo,
  url,
  visible = true,
}: {
  /** False while a chat pane hides it: Pea leases only what the person can see. */
  visible?: boolean;
  /** A `?target` pin; the root carries it out through `open in <Route>`. */
  target?: string;
  /** The thread whose head is the target store; the root carries it out through every link. */
  thread?: string;
  /** The demo lane (`frozenDemo`): fixture pods and runs, never a live read. */
  demo?: string;
  /** True on `/pods`, whose Page is the address; a hosted pane owns its Page without one. */
  url: boolean;
}) {
  const handle = useRoute(manifest, { target: target ?? null, thread, url });
  const router = useRouter();
  // The Page is the one owner of the open member: `pod`/`path` are contract steps, so a pick
  // pushes and Back returns; a reload reads them from the address.
  const [page, setPage] = handle.page;
  const { pod, path } = page;
  const select = (ref: MemberRef) => setPage(ref);
  const ladder = useDocumentLadder(handle);
  // Field options read the thread's document; choosing one here moves the thread (ledger 2026-09-17).
  const optionsFrom =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const [live, refresh] = usePodList(!demo);
  const source = listOf(
    demo ? { state: "ready", observation: DEMO_BROWSE } : live,
    (rows) => rows as readonly PodRow[],
  );
  const pods = source.items;
  const ref = demo && !pod ? { pod: DEMO_PODS[0]!.id, path: DEMO_SPEC_PATH } : { pod, path };
  const row = pods.find((item) => item.id === ref.pod);
  const member = row?.members.find((item) => item.path === ref.path) ?? null;
  const product = member
    ? PRODUCT_ROUTES.find((route) => isSpecOf(member.schema, route.def.schema))
    : undefined;
  // The member's runs, or the whole pod's (a draft's run belongs to no member): a contract field.
  const runScope = page.runs === "pod" || !member ? "pod" : "member";
  const { failure: runsFailure, runs } = usePodRuns(
    row?.id ?? null,
    runScope === "pod" ? null : member!.path,
    !!demo,
  );
  useRouteLease("pods", handle.page, {
    thread: handle.thread ?? undefined,
    url,
    visible,
    context: { member: member ? { pod: row!.id, path: member.path } : null },
    facts: {
      pods: pods.map((item) => ({
        id: item.id,
        name: item.name,
        members: item.members.map((m) => m.path),
      })),
      schema: member?.schema ?? null,
      runs: runScope,
      runCount: runs.length,
      opensIn: product?.route ?? null,
    },
  });

  // A failed pod read is a refusal: a log row, never a page line (N3).
  const failed = live.state === "failed" ? live.message : null;
  useEffect(() => {
    if (failed) handle.note("pod.list", failed, true);
  }, [failed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Surface
      head={
        <RouteShell
          manifest={manifest}
          handle={handle}
          situation={
            <Situation
              handle={handle}
              target={{ session: ladder.sessionWord, document: ladder.docWord }}
              sentence={
                <>
                  <SituationCell io="rw" empty={!member} placeholder="no member open">
                    <span className="face-mono">
                      {row?.name} · {member?.path}
                    </span>
                  </SituationCell>
                  {product ? (
                    <>
                      {" "}
                      (
                      <TooltipHint
                        content={`Open this spec in ${product.def.name}; apply happens there.`}
                      >
                        <OpenIn
                          router={router}
                          // The spec opens selected in the product route's apply stage; the demo
                          // lane keeps its seed so the link lands on a rendered route.
                          href={routeAddress(product.route).link({
                            stage: "apply",
                            pod: row!.id,
                            path: member!.path,
                            ...(demo ? { demo: "apply" } : {}),
                          })}
                        >
                          open in {product.def.name}
                        </OpenIn>
                      </TooltipHint>
                      )
                    </>
                  ) : null}
                  , options from <LadderPicker ladder={ladder} />
                  {ladder.refusal ? (
                    <span role="status" data-tone="caution">
                      {" "}
                      ({ladder.refusal})
                    </span>
                  ) : null}
                  {demo ? (
                    <>
                      {" "}
                      <FactChip tone="caution" dashed title="Demo lane: pods and runs are fixture.">
                        fixture
                      </FactChip>
                    </>
                  ) : null}
                  .
                </>
              }
            />
          }
        />
      }
    >
      <PaneSplit
        axis="horizontal"
        grow
        resize={{ target: "start", defaultSize: 300, minSize: 220, persist: "pods:members" }}
        start={
          <Pane flush title="members" meta={String(pods.length)}>
            {!demo && pods.length > 0 && <PodPlugins pods={pods} />}
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
            <List
              {...source}
              aria-label="pod members"
              items={pods.flatMap((item) => item.members.map((m) => ({ pod: item, member: m })))}
              keyOf={({ pod, member: m }) => `${pod.id}${SEP}${m.path}`}
              labelOf={({ member: m }) => m.path}
              groupOf={({ pod }) => `${pod.name} · ${pod.version}`}
              filter="substring"
              searchPlaceholder="Filter members…"
              status={live.state === "absent" && !demo ? "pending" : "ready"}
              empty="No pods installed."
              onPick={({ pod, member: m }) => select({ pod: pod.id, path: m.path })}
              row={({ pod, member: m }) => ({
                label: m.path,
                active: row?.id === pod.id && member?.path === m.path,
                meta: m.schema
                  ? m.schema
                      .split("/")
                      .at(-1)
                      ?.replace(/\.json$/, "")
                  : undefined,
                title: m.schema ?? "no $schema: plain data",
              })}
            />
          </Pane>
        }
        end={
          <PaneSplit
            axis="horizontal"
            grow
            resize={{ target: "end", defaultSize: 300, minSize: 220, persist: "pods:runs" }}
            start={
              <Pane title="spec" meta={member?.path}>
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
              <Pane
                title="runs"
                meta={
                  <span className="flex items-center gap-1.5">
                    <span className="face-mono">{runs.length}</span>
                    <Button
                      label={runScope === "pod" ? "whole pod" : "this member"}
                      refusal={
                        member
                          ? null
                          : "This draft has no member yet, so its runs belong to the whole pod."
                      }
                      reason="A draft's run belongs to no member: the whole pod lists it."
                      onClick={() => setPage({ runs: page.runs === "pod" ? "member" : "pod" })}
                    >
                      {runScope === "pod" ? "whole pod" : "this member"}
                    </Button>
                  </span>
                }
              >
                <RunsList
                  runs={runs}
                  memberSha256={member?.sha256}
                  scope={runScope}
                  failure={runsFailure}
                />
              </Pane>
            }
          />
        }
      />
    </Surface>
  );
}

/** The pod's runs, narrowed to the open member when a path is given. One host read, newest first. */
function usePodRuns(pod: string | null, path: string | null, demo: boolean) {
  const [runs, setRuns] = useState<readonly Run[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    setFailure(null);
    if (demo)
      return setRuns(path === null || path === DEMO_RUN.receipt!.memberPath ? [DEMO_RUN] : []);
    if (!pod) return setRuns([]);
    let live = true;
    // No path: the pod-level read, which lists drafts' runs too.
    podHost.runs(pod, path ?? undefined).then(
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

/**
 * A canonical link (`routeAddress(route).link`) resolved by the router as any navigation is: the root's
 * `retainSearchParams` adds the current thread, target and work, so the rendered href and a
 * plain click are one location; a modified click is left to the browser. As `route/inspect.tsx`.
 */
function OpenIn({
  router,
  href,
  children,
}: {
  router: ReturnType<typeof useRouter>;
  href: string;
  children: ReactNode;
}) {
  // Only the path and search are read, so the base is inert (no `window` on the server).
  const url = new URL(href, "http://pe.invalid");
  const destination = { to: url.pathname, search: Object.fromEntries(url.searchParams) };
  return (
    <a
      href={router.buildLocation(destination).href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        void router.navigate(destination);
      }}
    >
      {children}
    </a>
  );
}
