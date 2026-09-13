import {
  instancesRouteState,
  instancesActions,
  type InstancesActionKey,
  nativeProcessSchema,
  sdkSessionSelectorOf,
  sdkSessionTargetOf,
} from "@pe/agent-contracts";
import { INSTANCES_WORK } from "#/instances/manifest";
import { useRouteState } from "#/workbench/route-state";
import { useMemo, useState } from "react";
import { peReadings, readReading, useHostCall } from "#/readings";
import { ActionReceipts } from "#/actions/receipt";
import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";
import { EmptyState } from "#/components/lang/empty";
import { StateCell } from "#/components/lang/cell";
import { OutcomeLine } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";
import { ActionButton as VerbButton } from "#/components/lang/action-button";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column } from "#/components/master-table/model";
import type { Inventory } from "#/readings";
import { timeAgo } from "#/lib/utils";
import type { InstancesFleet } from "#/instances/workspace";
import {
  YEARS,
  custodyVerdict,
  docSelectorOf,
  findWorld,
  parseUtc,
  phaseVerdict,
  worldLabel,
  worldSub,
  worldTarget,
} from "#/instances/route";

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
  | { readonly kind: "open"; readonly doc: DocFact; readonly world: Inventory }
  | { readonly kind: "start"; readonly doc?: DocFact; readonly year: string };

/** Deliberately unexported: a `*Scope` export is a dead word (route-primitive guard row 6). */
type DocumentScope = { readonly kind: "document"; readonly document: string; readonly pin: string };

const documentScope = (session: string, document: string): DocumentScope | null =>
  session && document ? { kind: "document", document, pin: session } : null;

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
  liveWorlds: readonly Inventory[],
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
  for (const world of liveWorlds)
    for (const document of world.session?.openDocuments ?? []) {
      const { title, address: path } = document;
      if (!path) continue;
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
  /** Settled lifecycle receipts, for a host page's ledger. */
  onEvent?: (event: ClusterEvent) => void;
  /** Hands the selected document and its exact session pin to an embedding route. */
  onDocument?: (scope: DocumentScope) => void;
  requestedDocument?: string;
};

/** One workspace: every mount of the cluster reads and writes the same Instances Work. */
const workspaceId = INSTANCES_WORK.work!;

export function InstancesCluster({
  fleet,
  target,
  setTarget,
  onEvent,
  onDocument,
  requestedDocument,
}: ClusterProps) {
  const route = useRouteState(instancesRouteState, INSTANCES_WORK);
  const { worlds, isLoading } = fleet;
  // `session list --all` (useFleet({all:true})) includes the graveyard; the table shows only
  // worlds that still exist as processes or receipts — gone rows serve the census, not the picker.
  const liveWorlds = worlds.filter((world) => world.phase !== "gone");
  const doctor = useHostCall(
    async (signal) =>
      (await readReading({ kind: "sdk", read: "doctor" }, signal, peReadings)) as {
        result: { revitYears?: string[] };
      },
    ["instances", "doctor"],
  );
  const years = doctor.data?.result.revitYears?.map((year) => year.slice(-2)) ?? YEARS;
  // One call per Revit year, but ONE Reading: the years are read together or not at all.
  const recents = useHostCall(
    async (signal) =>
      await Promise.all(
        years.map(async (year) => ({
          year,
          recents:
            (
              (await readReading({ kind: "sdk", read: "recents", year }, signal, peReadings)) as {
                result: { recents?: RecentDocument[] };
              }
            ).result.recents ?? [],
        })),
      ),
    ["instances", "recents", years.join(",")],
  );
  const buckets = recents.data ?? [];
  const recentsLoading = doctor.isPending || recents.isPending;
  const documents = useMemo(() => mergeDocFacts(buckets, liveWorlds), [buckets, liveWorlds]);
  const recovery: DocFact | undefined =
    documents.find((document) => document.id === requestedDocument) ??
    (requestedDocument && /[\\/]/.test(requestedDocument)
      ? {
          id: requestedDocument,
          title: requestedDocument.split(/[\\/]/).at(-1)!,
          path: requestedDocument,
          selector: requestedDocument,
          year: null,
          cloud: false,
          openIn: [],
        }
      : undefined);

  const [yearPick, setYearPick] = useState<string | null>(null);
  const stored = route.slice?.staged;
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
    stored?.kind === "open" ? findWorld(liveWorlds, sdkSessionTargetOf(stored.session)) : undefined;
  const staged: Staged | null = stored
    ? stored.kind === "start"
      ? { kind: "start", doc: storedDoc ?? undefined, year: stored.year.slice(-2) }
      : storedWorld && storedDoc
        ? { kind: "open", doc: storedDoc, world: storedWorld }
        : null
    : null;
  const setStaged = (next: Staged | null) => {
    void route.apply([
      {
        path: ["staged"],
        value:
          next === null
            ? null
            : next.kind === "open"
              ? {
                  kind: "open",
                  session: sdkSessionSelectorOf(worldTarget(next.world)),
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
  const [localSessionName, setLocalSessionName] = useState<string | null>(null);
  const sessionName = localSessionName ?? (stored?.kind === "start" ? stored.name : "");
  const setSessionName = (name: string) => setLocalSessionName(sessionIdOf(name));
  const [busy, setBusy] = useState<string | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickedWorld = findWorld(liveWorlds, target);
  const pickedYear = pickedWorld?.row?.year != null ? String(pickedWorld.row.year).slice(-2) : null;
  const worldYear = (world: Inventory) =>
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
  const stagedScope =
    staged?.kind === "open" && staged.doc.openIn.includes(staged.world.id)
      ? documentScope(worldTarget(staged.world), staged.doc.id)
      : null;

  const runCommand = async (command: "start" | "open" | "restart" | "stop") => {
    if (route.revision === null) return;
    setBusy(command);
    setError(null);
    try {
      let revision = route.revision;
      if (command === "start" && stored?.kind === "start" && stored.name !== sessionName) {
        const written = await route.apply(
          [{ path: ["staged"], value: { ...stored, name: sessionName } }],
          revision,
        );
        if (!written.ok) throw Error(written.error);
        revision = written.revision;
      }
      const key: InstancesActionKey = `instances.${command}`;
      const world = command === "open" && staged?.kind === "open" ? staged.world : pickedWorld;
      const process =
        world?.row && "process" in world.row
          ? nativeProcessSchema.parse(world.row.process)
          : undefined;
      const input = instancesActions[key].input.parse({
        workspaceId,
        ...(command !== "start" ? { session: { id: world?.id, process } } : {}),
        ...(command === "stop" ? { force: world?.phase === "unresponsive" } : {}),
      });
      const row = await runSemanticAction(
        key,
        input,
        undefined,
        { work: { key: INSTANCES_WORK, revision } },
        "human",
        "",
        undefined,
        30_000,
      );
      setLastId(row.id);
      onEvent?.({ atMs: Date.now(), label: `${command}: action ${row.id} (${row.state})` });
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(null);
    }
  };
  // Staging: with a picked world the open targets THAT world; without one the document brings its
  // own — the world already showing it, else a ready controlled installed world of its year, else
  // a new session of its year.
  const stageDoc = (document: DocFact) => {
    setError(null);
    if (staged?.doc?.id === document.id) {
      setStaged(null);
      return;
    }
    if (pickedWorld) {
      setStaged({ kind: "open", doc: document, world: pickedWorld });
      return;
    }
    const year = document.year ?? yearPick;
    if (!year) {
      setError("Pick a session or Revit year before opening this document.");
      return;
    }
    setStaged({ kind: "start", doc: document, year });
  };

  const openRefusal =
    staged?.kind === "open" && staged.world.custody !== "controlled"
      ? "observed world — open the document in Revit yourself"
      : staged?.kind === "open" && !staged.world.session
        ? "this world has no connected session"
        : null;

  const fleetColumns = useMemo<Column<Inventory>[]>(
    () => [
      {
        key: "session",
        label: "session",
        search: (world) => worldLabel(world).toLowerCase(),
        sort: (world) => worldLabel(world),
        cell: (world) => <StateCell scale="row" value={worldLabel(world)} />,
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
                      return world ? worldLabel(world) : id;
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

  if (!route.hydrated)
    return (
      <OutcomeLine
        kind={route.failure ? "error" : "busy"}
        label={route.failure?.message ?? "reading instances workspace"}
      />
    );

  return (
    <div className="flex flex-col gap-5" data-testid="instances-cluster">
      {route.outcomeUnknown && (
        <OutcomeLine
          kind="advisory"
          label="The original legacy outcome remains unknown. Reading or refreshing does not authorize another mutation."
        />
      )}
      {(doctor.error || recents.error) && (
        <OutcomeLine
          kind="error"
          label="SDK document readings unavailable; staged intent is retained."
        />
      )}
      {recovery && <Press onClick={() => stageDoc(recovery)}>recover {recovery.title}</Press>}
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
            const id = worldTarget(world);
            setTarget(target === id ? "" : id);
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
              ? `documents openable in ${worldLabel(pickedWorld)}`
              : "documents — pick a session explicitly, or stage a new session"
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
                ? `open ${staged.doc.title} in ${worldLabel(staged.world)}`
                : `start a new 20${staged.year} session ${staged.doc ? `opening ${staged.doc.title}` : ""}`}
            </span>
            {staged.kind === "start" ? (
              <input
                className="hairline-x hairline-y t-small face-mono bg-transparent px-2 py-1 text-ink"
                aria-label="session name"
                placeholder="name this session"
                value={sessionName}
                onChange={(event) => setSessionName(event.target.value)}
              />
            ) : null}
            {staged.kind === "open" ? (
              <VerbButton
                tone="commit"
                label={stagedScope && onDocument ? "use" : "open"}
                reason={
                  stagedScope && onDocument
                    ? "use the staged document in this route"
                    : (openRefusal ?? "open the staged document in its session")
                }
                disabled={
                  busy !== null || (!stagedScope && openRefusal !== null) || route.outcomeUnknown
                }
                busy={busy === "open"}
                onClick={() =>
                  stagedScope && onDocument ? onDocument(stagedScope) : void runCommand("open")
                }
              />
            ) : (
              <VerbButton
                tone="commit"
                label={sessionIdOf(sessionName) ? `start ${sessionIdOf(sessionName)}` : "start"}
                reason="start the session and open the staged document"
                disabled={busy !== null || route.outcomeUnknown}
                busy={busy === "start"}
                onClick={() => void runCommand("start")}
              />
            )}
            <VerbButton tone="act" label="clear" reason="unstage" onClick={() => setStaged(null)} />
          </div>
        ) : pickedWorld ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="t-small face-mono text-ink-2">session</span>
            <span className="t-prose text-ink">{worldLabel(pickedWorld)}</span>
            <VerbButton
              tone="act"
              label="restart"
              reason="cold-swap this session (session hr --restart)"
              disabled={busy !== null || route.outcomeUnknown}
              busy={busy === "restart"}
              onClick={() => void runCommand("restart")}
            />
            <VerbButton
              tone="act"
              label={pickedWorld.phase === "unresponsive" ? "force stop" : "stop"}
              reason="stop this session"
              disabled={busy !== null || route.outcomeUnknown}
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
        {route.failure ? <OutcomeLine kind="error" label={route.failure.message} /> : null}
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
        {error && <OutcomeLine kind="error" label={error} />}
        <ActionReceipts scope={{ kind: "instances", workspaceId }} lastId={lastId} />
      </div>
    </div>
  );
}
