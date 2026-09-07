import { instancesRouteState, type InstancesDocument } from "@pe/agent-contracts";
import { useRouteState, type RouteStateHandle } from "#/workbench/route-state";
import { useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import { EmptyState } from "#/components/lang/empty";
import { StateCell } from "#/components/lang/cell";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";
import { Verb as VerbButton } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import type { WorldFacts } from "#/host/fleet";
import { HOST_QUERY_KEY } from "#/host/queries";
import { timeAgo } from "#/lib/utils";
import { docSelectorOf, worldTrunk } from "#/targeting/world";
import type { InstancesFleet } from "#/instances/workspace";
import { YEARS, custodyVerdict, parseUtc, phaseVerdict, worldSub } from "#/instances/route";

/**
 * THE INSTANCES CLUSTER (promoted from proto variant F, kaitpw verdict 2026-09-01) — the whole
 * fleet/documents/staging surface as ONE portable unit, so any Revit-touching route that needs a
 * document can render it mid-page. No targeting sentence here: instances is what GIVES targeting
 * something to attach; it is not itself targeted.
 *
 * Shape: fleet table on top (picking a world filters the documents below and selects it as the
 * `target`); year chips and a documents table under it (a row click STAGES an open, never acts);
 * a sticky card at the viewport bottom is the only action surface — a staged document commits as
 * open/activate/start, a picked world alone offers restart/stop. A start takes a NAME, which IS
 * the SDK session id (`session start --id`): active session names are the only names anywhere.
 * Lane is pinned to `installed` — dev/HR sessions never start from this surface (ruled
 * 2026-09-01, variant E round).
 */

export type ClusterEvent = { readonly atMs: number; readonly label: string };

type DocFact = {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  /** The SDK `--doc` selector: local path, or the exact `cld://` cloud identity. */
  readonly selector: string;
  readonly year: string | null;
  readonly cloud: boolean;
  readonly openIn: readonly string[];
};

type Staged =
  | { readonly kind: "open"; readonly doc: DocFact; readonly world: WorldFacts }
  | { readonly kind: "start"; readonly doc?: DocFact; readonly year: string };

/** `session start --id` accepts ≤64 chars of letters, digits, `.`, `-`, `_`. */
export const sessionIdOf = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/** Merge recents with what live worlds are actually showing; a shown document wins its identity. */
function mergeDocFacts(
  buckets: readonly { year: string; recents: readonly RecentDocument[] }[],
  liveWorlds: readonly WorldFacts[],
): DocFact[] {
  const byId = new Map<string, DocFact>();
  for (const bucket of buckets)
    for (const recent of bucket.recents) {
      const id = recent.modelGuid ?? recent.path;
      if (!byId.has(id))
        byId.set(id, {
          id,
          title: recent.title,
          path: recent.isCloud ? recent.title : recent.path,
          selector: docSelectorOf(recent),
          year: bucket.year,
          cloud: recent.isCloud,
          openIn: [],
        });
    }
  for (const world of liveWorlds) {
    const title = world.session?.activeDocumentTitle;
    if (!title) continue;
    const path = world.session?.activeDocumentId ?? title;
    const existing = [...byId.values()].find(
      (candidate) => candidate.path === path || candidate.id === path,
    );
    if (existing) byId.set(existing.id, { ...existing, openIn: [...existing.openIn, world.id] });
    else
      byId.set(path, {
        id: path,
        title,
        path,
        selector: path,
        year: world.row?.year != null ? String(world.row.year).slice(-2) : null,
        cloud: false,
        openIn: [world.id],
      });
  }
  return [...byId.values()];
}

type ClusterProps = {
  fleet: InstancesFleet;
  target: string;
  setTarget: (target: string) => void;
  source?: "fixture";
  onEvent?: (event: ClusterEvent) => void;
};

export function InstancesCluster(props: ClusterProps) {
  const search = useSearch({ strict: false }) as { thread?: string };
  return props.source === "fixture" ? (
    <InstancesClusterView {...props} />
  ) : (
    <LiveInstancesCluster
      key={search.thread ?? "instances"}
      {...props}
      workspaceId={search.thread ?? "instances"}
    />
  );
}

function LiveInstancesCluster({ workspaceId, ...props }: ClusterProps & { workspaceId: string }) {
  const route = useRouteState(instancesRouteState, { workspaceId });
  useEffect(() => {
    if (route.hydrated && !route.slice?.observation) void route.command("refresh");
  }, [route.hydrated]);
  if (!route.hydrated)
    return (
      <OutcomeLine
        kind={route.failure ? "error" : "busy"}
        label={route.failure?.message ?? "reading instances workspace"}
      />
    );
  return <InstancesClusterView {...props} route={route} />;
}

function InstancesClusterView({
  fleet,
  target,
  setTarget,
  source,
  onEvent,
  route,
}: {
  route?: RouteStateHandle<InstancesDocument>;
  fleet: InstancesFleet;
  target: string;
  setTarget: (target: string) => void;
  source?: "fixture";
  /** Settled lifecycle receipts, for a host page's ledger. */
  onEvent?: (event: ClusterEvent) => void;
}) {
  const queryClient = useQueryClient();
  const { worlds, isLoading } = fleet;
  // `session list --all` (useFleet({all:true})) includes the graveyard; the table shows only
  // worlds that still exist as processes or receipts — gone rows serve the census, not the picker.
  const liveWorlds = worlds.filter((world) => world.phase !== "gone");
  const observation = route?.slice?.observation as {
    years: string[];
    recents: { year: string; recents: RecentDocument[] }[];
  } | null;
  const years = observation?.years.map((year) => year.slice(-2)) ?? YEARS;
  const buckets =
    observation?.recents.map((bucket) => ({
      ...bucket,
      recents: bucket.recents ?? [],
      year: bucket.year.slice(-2),
    })) ?? [];
  const recentsLoading = route?.busy === "refresh";
  const documents = useMemo(() => mergeDocFacts(buckets, liveWorlds), [buckets, liveWorlds]);

  const [yearPick, setYearPick] = useState<string | null>(null);
  const [localStaged, setLocalStaged] = useState<Staged | null>(null);
  const intent = route?.slice;
  target = intent?.selectedSession?.slice("session:".length) ?? target;
  const originalSetTarget = setTarget;
  setTarget = (next) => {
    if (route)
      void route.apply([
        { path: ["selectedSession"], value: next ? `session:${next}` : null },
        { path: ["staged"], value: null },
      ]);
    else originalSetTarget(next);
  };
  const stored = intent?.staged;
  const storedDoc = stored?.document
    ? (documents.find((d) => d.selector === stored.document) ?? {
        id: stored.document,
        title: stored.document,
        path: stored.document,
        selector: stored.document,
        year: stored.kind === "start" ? stored.year.slice(-2) : null,
        cloud: stored.document.startsWith("cld:"),
        openIn: [],
      })
    : null;
  const storedWorld =
    stored?.kind === "open"
      ? worldTrunk.resolve(liveWorlds, stored.session.slice("session:".length))
      : undefined;
  const staged: Staged | null = route
    ? stored
      ? stored.kind === "start"
        ? { kind: "start", doc: storedDoc ?? undefined, year: stored.year.slice(-2) }
        : storedWorld && storedDoc
          ? { kind: "open", doc: storedDoc, world: storedWorld }
          : null
      : null
    : localStaged;
  const setStaged = (next: Staged | null) => {
    if (!route) {
      setLocalStaged(next);
      return;
    }
    void route.apply([
      {
        path: ["staged"],
        value:
          next === null
            ? null
            : next.kind === "open"
              ? {
                  kind: "open",
                  session: `session:${worldTrunk.option(next.world).id}`,
                  document: next.doc.selector,
                }
              : {
                  kind: "start",
                  year: `20${next.year}`,
                  name: sessionName,
                  document: next.doc?.selector,
                },
      },
    ]);
  };
  const [localSessionName, setLocalSessionName] = useState("");
  const sessionName = stored?.kind === "start" ? stored.name : localSessionName;
  const setSessionName = (name: string) => {
    setLocalSessionName(sessionIdOf(name));
    if (route && stored?.kind === "start")
      void route.apply([{ path: ["staged", "name"], value: sessionIdOf(name) }]);
  };
  const busy = route?.busy ?? null;
  const [localOutcome, setOutcome] = useState<{
    kind: OutcomeKind;
    text: string;
    says?: string;
  } | null>(null);

  const outcome =
    localOutcome ??
    (intent?.outcome
      ? {
          kind: "receipt" as const,
          text: `${intent.outcome.action} answered`,
          says: undefined,
        }
      : null);

  const pickedWorld = worldTrunk.resolve(liveWorlds, target);
  const pickedYear = pickedWorld?.row?.year != null ? String(pickedWorld.row.year).slice(-2) : null;
  const worldYear = (world: WorldFacts) =>
    world.row?.year != null
      ? String(world.row.year).slice(-2)
      : (world.session?.year?.slice(-2) ?? null);
  const visibleWorlds = liveWorlds.filter((world) =>
    yearPick ? worldYear(world) === yearPick : true,
  );
  const visibleDocs = documents
    .filter((document) =>
      pickedWorld ? document.openIn.includes(pickedWorld.id) || document.year === pickedYear : true,
    )
    .filter((document) => (yearPick ? document.year === yearPick : true));

  const settle = (kind: OutcomeKind, text: string, says?: string) => {
    setOutcome({ kind, text, says });
    if (kind !== "error") onEvent?.({ atMs: Date.now(), label: text });
  };
  const finish = () => {
    void queryClient.invalidateQueries({ queryKey: HOST_QUERY_KEY });
  };
  const runCommand = async (command: "start" | "open" | "restart" | "stop") => {
    if (!route) return;
    const result = await route.command(
      command,
      command === "stop" ? { force: pickedWorld?.phase === "unresponsive" } : {},
    );
    if (!result.ok) settle("error", result.error, result.hint);
    else {
      const receipt = result.result as {
        diagnostics?: { detail?: string; code?: string }[];
        result?: { state?: string };
      };
      settle(
        receipt.diagnostics?.length ? "advisory" : "receipt",
        `${command} · ${receipt.result?.state ?? "answered"}`,
        receipt.diagnostics?.map((d) => d.detail ?? d.code).join(" · "),
      );
    }
    finish();
  };
  const fixtureRefusal = source === "fixture" ? "fixture worlds are read-only" : null;

  // Staging: with a picked world the open targets THAT world; without one the document brings its
  // own — the world already showing it, else a ready controlled installed world of its year, else
  // a new session of its year.
  const stageDoc = (document: DocFact) => {
    setOutcome(null);
    if (staged?.doc?.id === document.id) {
      setStaged(null);
      return;
    }
    if (pickedWorld) {
      setStaged({ kind: "open", doc: document, world: pickedWorld });
      return;
    }
    const showing = document.openIn
      .map((id) => liveWorlds.find((world) => world.id === id))
      .find(Boolean);
    const readyOfYear = liveWorlds.find(
      (world) =>
        world.lane === "installed" &&
        world.custody === "controlled" &&
        world.phase === "ready" &&
        world.row?.year != null &&
        String(world.row.year).slice(-2) === document.year,
    );
    const live = showing ?? readyOfYear;
    setStaged(
      live
        ? { kind: "open", doc: document, world: live }
        : { kind: "start", doc: document, year: document.year ?? "25" },
    );
  };

  const openRefusal =
    fixtureRefusal ??
    (staged?.kind === "open" && staged.world.custody !== "controlled"
      ? "observed world — open the document in Revit yourself"
      : staged?.kind === "open" && !staged.world.session
        ? "this world has no connected session"
        : null);

  const fleetColumns = useMemo<Column<WorldFacts>[]>(
    () => [
      {
        key: "session",
        label: "session",
        search: (world) => worldTrunk.label(world).toLowerCase(),
        sort: (world) => worldTrunk.label(world),
        cell: (world) => <StateCell scale="row" value={worldTrunk.label(world)} />,
      },
      { key: "custody", label: "custody", width: "w-28", verdict: custodyVerdict },
      { key: "phase", label: "phase", width: "w-32", verdict: phaseVerdict },
      {
        key: "detail",
        label: "lane · year · pid",
        search: (world) => worldSub(world).toLowerCase(),
        cell: (world) => <StateCell scale="row" value={worldSub(world)} />,
      },
      {
        key: "docs",
        label: "showing",
        search: (world) => world.session?.activeDocumentTitle?.toLowerCase() ?? "",
        cell: (world) => (
          <StateCell
            scale="row"
            value={`${world.session?.activeDocumentTitle ?? (world.session ? "no open document" : "nothing observed")}${(world.session?.openDocumentCount ?? 0) > 1 ? ` +${(world.session?.openDocumentCount ?? 1) - 1}` : ""}`}
          />
        ),
      },
      {
        key: "seen",
        label: "seen",
        right: true,
        width: "w-24",
        sort: (world) =>
          (world.session ? world.session.observedAtUnixMs : parseUtc(world.row?.observedAtUtc)) ??
          0,
        cell: (world) => (
          <StateCell
            scale="row"
            value={timeAgo(
              world.session ? world.session.observedAtUnixMs : parseUtc(world.row?.observedAtUtc),
            )}
          />
        ),
      },
    ],
    [],
  );

  const docColumns = useMemo<Column<DocFact>[]>(
    () => [
      {
        key: "doc",
        label: "document",
        search: (document) => document.title.toLowerCase(),
        sort: (document) => document.title.toLowerCase(),
        cell: (document) => <StateCell scale="row" value={document.title} />,
      },
      {
        key: "year",
        label: "year",
        width: "w-20",
        sort: (document) => document.year ?? "",
        cell: (document) => (
          <StateCell scale="row" value={document.year ? `20${document.year}` : "—"} />
        ),
      },
      {
        key: "where",
        label: "open in",
        width: "w-44",
        facet: (document) => (document.openIn.length ? "open" : "closed"),
        sort: (document) => document.openIn.length,
        cell: (document) => (
          <StateCell
            scale="row"
            value={
              document.openIn.length
                ? document.openIn
                    .map((id) => {
                      const world = liveWorlds.find((candidate) => candidate.id === id);
                      return world ? worldTrunk.label(world) : id;
                    })
                    .join(" · ")
                : "—"
            }
          />
        ),
      },
      {
        key: "path",
        label: "path",
        search: (document) => document.path.toLowerCase(),
        facet: (document) => (document.cloud ? "cloud" : "local"),
        cell: (document) => (
          <span className="t-small face-mono block max-w-96 truncate text-ink-2">
            {document.cloud ? "cloud" : document.path}
          </span>
        ),
      },
    ],
    [liveWorlds],
  );

  return (
    <div className="flex flex-col gap-5" data-testid="instances-cluster">
      {route?.outcomeUnknown ? (
        <div>
          <OutcomeLine
            kind="advisory"
            label="Previous operation outcome is uncertain. Inspect Revit and its SDK receipts before continuing."
          />
          <VerbButton
            tone="act"
            label="I inspected the outcome"
            reason="acknowledge the uncertain operation"
            onClick={() => void route.command("recover", { inspected: true })}
          />
        </div>
      ) : null}
      {route ? (
        <VerbButton
          tone="act"
          label="refresh"
          reason="read sessions and recent documents"
          disabled={busy !== null}
          onClick={() => void route.command("refresh")}
        />
      ) : null}
      <div className="flex items-center gap-2">
        <span className="t-small face-mono text-ink-2">year</span>
        {years.map((candidate) => (
          <Press
            key={candidate}
            size="caption"
            frame="line"
            tone="quiet"
            state={yearPick === candidate ? "selected" : "rest"}
            onClick={() => setYearPick((previous) => (previous === candidate ? null : candidate))}
          >
            20{candidate}
          </Press>
        ))}
      </div>
      {/* Wrappers neutralize MasterTable's `flex-1` (basis 0): unwrapped, the column split its
       * height evenly and an empty fleet table hoarded ~1100px of dead space (annotation 2).
       * Content-sized up to a cap; past it the table scrolls under its own sticky header. */}
      <div className="flex max-h-[40vh] flex-col">
        <MasterTable
          rows={visibleWorlds}
          columns={fleetColumns}
          rowKey={(world) => world.id}
          scopeLabel="fleet — pick a session to filter documents"
          searchPlaceholder="search sessions"
          activeKey={pickedWorld?.id}
          onRowClick={(world) => {
            const id = worldTrunk.option(world).id;
            setTarget(target === id ? "" : id);
            if (!route) setStaged(null);
          }}
          empty={
            isLoading ? (
              <OutcomeLine kind="busy" label="reading the fleet" />
            ) : (
              <EmptyState story="scope" exit="stage a document below — it starts its own session">
                no live sessions
              </EmptyState>
            )
          }
        />
      </div>
      <div className="flex max-h-[60vh] flex-col">
        <MasterTable
          rows={visibleDocs}
          columns={docColumns}
          rowKey={(document) => document.id}
          scopeLabel={
            pickedWorld
              ? `documents openable in ${worldTrunk.label(pickedWorld)}`
              : "documents — each brings its own session"
          }
          searchPlaceholder="search documents"
          activeKey={staged?.doc?.id}
          onRowClick={stageDoc}
          empty={
            recentsLoading || isLoading ? (
              <OutcomeLine kind="busy" label="reading recents and the fleet" />
            ) : (
              <EmptyState story="scope" exit="open a document in Revit, or clear the fleet pick">
                no documents known
              </EmptyState>
            )
          }
        />
      </div>
      <div className="hairline-x sticky bottom-0 z-sticky p-3" data-surface="page">
        {staged ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="t-small face-mono text-ink-2">staged</span>
            <span className="t-prose text-ink">
              {staged.kind === "open"
                ? `open ${staged.doc.title} in ${worldTrunk.label(staged.world)}`
                : `start a new 20${staged.year} session ${staged.doc ? `opening ${staged.doc.title}` : ""}`}
            </span>
            {staged.kind === "start" ? (
              <input
                className="hairline-x hairline-y t-small face-mono bg-transparent px-2 py-1 text-ink"
                aria-label="session name"
                placeholder="name this session"
                defaultValue={sessionName}
                key={`${staged.doc?.selector ?? staged.year}:${sessionName}`}
                onBlur={(event) => setSessionName(event.target.value)}
              />
            ) : null}
            {staged.kind === "open" ? (
              <VerbButton
                tone="commit"
                label="open"
                reason={openRefusal ?? "open the staged document in its session"}
                disabled={busy !== null || openRefusal !== null || route?.outcomeUnknown === true}
                busy={busy === "open"}
                onClick={() => void runCommand("open")}
              />
            ) : (
              <VerbButton
                tone="commit"
                label={sessionIdOf(sessionName) ? `start ${sessionIdOf(sessionName)}` : "start"}
                reason={fixtureRefusal ?? "start the session and open the staged document"}
                disabled={
                  busy !== null || fixtureRefusal !== null || route?.outcomeUnknown === true
                }
                busy={busy === "start"}
                onClick={() => void runCommand("start")}
              />
            )}
            <VerbButton tone="act" label="clear" reason="unstage" onClick={() => setStaged(null)} />
          </div>
        ) : pickedWorld ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="t-small face-mono text-ink-2">session</span>
            <span className="t-prose text-ink">{worldTrunk.label(pickedWorld)}</span>
            <VerbButton
              tone="act"
              label="restart"
              reason={fixtureRefusal ?? "cold-swap this session (session hr --restart)"}
              disabled={busy !== null || fixtureRefusal !== null || route?.outcomeUnknown === true}
              busy={busy === "restart"}
              onClick={() => void runCommand("restart")}
            />
            <VerbButton
              tone="act"
              label={pickedWorld.phase === "unresponsive" ? "force stop" : "stop"}
              reason={fixtureRefusal ?? "stop this session"}
              disabled={busy !== null || fixtureRefusal !== null || route?.outcomeUnknown === true}
              busy={busy === "stop"}
              onClick={() => void runCommand("stop")}
            />
            <VerbButton tone="act" label="clear" reason="unpick" onClick={() => setTarget("")} />
          </div>
        ) : (
          <span className="t-small face-mono text-ink-mute">
            nothing staged — pick a session above, or click a document row
          </span>
        )}
        {route?.failure ? <OutcomeLine kind="error" label={route.failure.message} /> : null}
        {stored?.kind === "open" && !storedWorld ? (
          <div>
            <OutcomeLine kind="error" label={`staged session unavailable: ${stored.session}`} />
            <VerbButton
              tone="act"
              label="clear"
              reason="unstage unavailable session"
              onClick={() => setStaged(null)}
            />
          </div>
        ) : null}
        {outcome ? (
          <div className="mt-2">
            <OutcomeLine kind={outcome.kind} label={outcome.text} says={outcome.says} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
