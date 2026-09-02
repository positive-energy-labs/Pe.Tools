import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DoctorResult, Envelope, RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import { EmptyState } from "#/components/lang/empty";
import { StateCell } from "#/components/lang/cell";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { Verb as VerbButton } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import type { WorldFacts } from "#/host/fleet";
import { HOST_QUERY_KEY } from "#/host/queries";
import { timeAgo } from "#/lib/utils";
import { docSelectorOf, documentTrunk, worldTrunk } from "#/targeting/world";
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
  | { readonly kind: "start"; readonly doc: DocFact; readonly year: string };

/** `session start --id` accepts ≤64 chars of letters, digits, `.`, `-`, `_`. */
export const sessionIdOf = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/**
 * Installed Revit years from the SDK's own census: `GET /doctor` relays `pe-revit doctor`
 * (beta.145 `result.revitYears`). `YEARS` is only the fallback while the read is in flight or
 * the host cannot answer.
 */
function useInstalledYears(enabled: boolean) {
  const query = useQuery({
    queryKey: ["doctor-revit-years"],
    queryFn: async () => {
      const body = (await (await fetch("/doctor")).json()) as Envelope<DoctorResult> | null;
      const years = body?.result?.revitYears;
      if (!years || years.length === 0) throw Error("doctor reported no installed Revit years");
      return years.map((year) => year.slice(-2));
    },
    enabled,
    staleTime: Infinity,
    retry: false,
  });
  return query.data ?? YEARS;
}

function useRecentsByYear(enabled: boolean, years: readonly string[]) {
  const query = useQuery({
    queryKey: ["doc-recents-all", years.join(".")],
    queryFn: async () => {
      const byYear = await Promise.all(years.map((year) => documentTrunk.recents(year)));
      return years.map((year, index) => ({ year, recents: byYear[index]! }));
    },
    enabled,
    staleTime: 30_000,
  });
  return {
    buckets: query.data ?? [],
    loading: enabled && query.isLoading,
    error: query.error as Error | null,
  };
}

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
      (candidate) => candidate.title === title || candidate.path === path,
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

export function InstancesCluster({
  fleet,
  target,
  setTarget,
  source,
  onEvent,
}: {
  fleet: InstancesFleet;
  target: string;
  setTarget: (target: string) => void;
  source?: "fixture";
  /** Settled lifecycle receipts, for a host page's ledger. */
  onEvent?: (event: ClusterEvent) => void;
}) {
  const queryClient = useQueryClient();
  const { worlds, sessions, isLoading } = fleet;
  // `session list --all` (useFleet({all:true})) includes the graveyard; the table shows only
  // worlds that still exist as processes or receipts — gone rows serve the census, not the picker.
  const liveWorlds = worlds.filter((world) => world.phase !== "gone");
  const years = useInstalledYears(source !== "fixture");
  const { buckets, loading: recentsLoading } = useRecentsByYear(source !== "fixture", years);
  const documents = useMemo(() => mergeDocFacts(buckets, liveWorlds), [buckets, liveWorlds]);
  const allRecents = useMemo(() => buckets.flatMap((bucket) => bucket.recents), [buckets]);

  const [yearPick, setYearPick] = useState<string | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [sessionName, setSessionName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{
    kind: OutcomeKind;
    text: string;
    says?: string;
  } | null>(null);

  const pickedWorld = worldTrunk.resolve(liveWorlds, sessions, target);
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
    setBusy(null);
    void queryClient.invalidateQueries({ queryKey: HOST_QUERY_KEY });
  };
  const lifecycle = worldTrunk.verbs<"world">({
    // ponytail: start here is only the staged-document start; lane is pinned installed.
    start: () => ({
      lane: "installed",
      year: staged?.kind === "start" ? staged.year : (years.at(-1) ?? "25"),
      // The staged document rides the start in the SDK's own `--doc` grammar (local path or
      // exact `cld://` identity — kaitpw ruling 2026-09-01: opens behave exactly like the
      // Revit UI, no clone/detach policy here, ever).
      // `keep` is the least destructive cloud conflict answer; an `ask` policy that defers to
      // the human is proposed on the SDK (kaitpw 2026-09-01) and supersedes this when it lands.
      ...(staged?.kind === "start"
        ? {
            doc: staged.doc.selector,
            ...(staged.doc.cloud ? { conflictPolicy: "keep" as const } : {}),
          }
        : {}),
      ...(sessionIdOf(sessionName) ? { id: sessionIdOf(sessionName) } : {}),
    }),
    started: (action) => {
      setBusy(action);
      setOutcome(null);
    },
    settled: (receipt) => {
      settle(
        receipt.diagnostics.length === 0 ? "receipt" : "advisory",
        receipt.diagnostics[0]?.detail ?? worldTrunk.describe(receipt),
        receipt.nextSteps.length ? receipt.nextSteps.join(" · ") : undefined,
      );
    },
    failed: (action, caught) =>
      settle("error", caught instanceof Error ? caught.message : `${action} failed`),
    finished: finish,
  });
  const worldFeed = { world: worldTrunk.feed(fleet) };
  const boundWorld = { world: target || null };
  const fixtureRefusal = source === "fixture" ? "fixture worlds are read-only" : null;

  // Staging: with a picked world the open targets THAT world; without one the document brings its
  // own — the world already showing it, else a ready controlled installed world of its year, else
  // a new session of its year.
  const stageDoc = (document: DocFact) => {
    setOutcome(null);
    if (staged?.doc.id === document.id) {
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

  const commitOpen = async (stagedOpen: Extract<Staged, { kind: "open" }>) => {
    setBusy("open");
    setOutcome(null);
    try {
      const session = stagedOpen.world.session!;
      const said = stagedOpen.doc.cloud
        ? await documentTrunk.pick(session, stagedOpen.doc.id, allRecents)
        : await documentTrunk.activate(session, stagedOpen.doc.path);
      settle("receipt", said);
      setStaged(null);
    } catch (caught) {
      settle("error", caught instanceof Error ? caught.message : "open failed");
    } finally {
      finish();
    }
  };

  const runLifecycle = async (verb: typeof lifecycle.start) => {
    await verb.run(boundWorld, worldFeed);
    if (verb.key === "start") setStaged(null);
  };

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
      <div className="flex items-center gap-2">
        <span className="t-small face-mono text-ink-2">year</span>
        {years.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`t-small face-mono border px-2 py-0.5 ${
              yearPick === candidate ? "border-ink text-ink" : "border-ink-mute text-ink-mute"
            }`}
            onClick={() => setYearPick((previous) => (previous === candidate ? null : candidate))}
          >
            20{candidate}
          </button>
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
            const id = worldTrunk.option(world, sessions).id;
            setTarget(target === id ? "" : id);
            setStaged(null);
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
          activeKey={staged?.doc.id}
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
      <div className="sticky bottom-0 z-40 border border-line bg-page p-3">
        {staged ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="t-small face-mono text-ink-2">staged</span>
            <span className="t-body text-ink">
              {staged.kind === "open"
                ? `open ${staged.doc.title} in ${worldTrunk.label(staged.world)}`
                : `start a new 20${staged.year} session opening ${staged.doc.title}`}
            </span>
            {staged.kind === "start" ? (
              <input
                className="t-small face-mono border border-line bg-transparent px-2 py-1 text-ink"
                aria-label="session name"
                placeholder="name this session"
                value={sessionName}
                onChange={(event) => setSessionName(event.target.value)}
              />
            ) : null}
            {staged.kind === "open" ? (
              <VerbButton
                tone="commit"
                label="open"
                reason={openRefusal ?? "open the staged document in its session"}
                disabled={busy !== null || openRefusal !== null}
                busy={busy === "open"}
                onClick={() => void commitOpen(staged)}
              />
            ) : (
              <VerbButton
                tone="commit"
                label={sessionIdOf(sessionName) ? `start ${sessionIdOf(sessionName)}` : "start"}
                reason={fixtureRefusal ?? "start the session and open the staged document"}
                disabled={busy !== null || fixtureRefusal !== null}
                busy={busy === "start"}
                onClick={() => void runLifecycle(lifecycle.start)}
              />
            )}
            <VerbButton tone="act" label="clear" reason="unstage" onClick={() => setStaged(null)} />
          </div>
        ) : pickedWorld ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="t-small face-mono text-ink-2">session</span>
            <span className="t-body text-ink">{worldTrunk.label(pickedWorld)}</span>
            <VerbButton
              tone="act"
              label="restart"
              reason={fixtureRefusal ?? "cold-swap this session (session hr --restart)"}
              disabled={busy !== null || fixtureRefusal !== null}
              busy={busy === "restart"}
              onClick={() => void runLifecycle(lifecycle.restart)}
            />
            <VerbButton
              tone="act"
              label={pickedWorld.phase === "unresponsive" ? "force stop" : "stop"}
              reason={fixtureRefusal ?? "stop this session"}
              disabled={busy !== null || fixtureRefusal !== null}
              busy={busy === "stop"}
              onClick={() => void runLifecycle(lifecycle.stop)}
            />
            <VerbButton tone="act" label="clear" reason="unpick" onClick={() => setTarget("")} />
          </div>
        ) : (
          <span className="t-small face-mono text-ink-mute">
            nothing staged — pick a session above, or click a document row
          </span>
        )}
        {outcome ? (
          <div className="mt-2">
            <OutcomeLine kind={outcome.kind} label={outcome.text} says={outcome.says} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
