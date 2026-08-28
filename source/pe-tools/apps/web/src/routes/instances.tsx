import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { Verb, VerbGroup } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column, Verdict } from "#/components/master-table/model";
import { useFleet, worldName, type WorldFacts } from "#/host/fleet";
import { HOST_QUERY_KEY } from "#/host/queries";
import { useWorldLog } from "#/host/use-target";
import { cn } from "#/lib/utils";

/**
 * /instances — the fleet dashboard. Every Revit world `pe-revit session status` knows about plus
 * every one the bridge is connected to: sessions pea controls (start/stop/restart/converge) and
 * sessions it merely observes (display-only — the user's own Revit), told apart by the SDK's
 * `custody` field, not by a hand-rolled kind split. Also hosted as the "instances" chat workspace
 * plugin (iframed side pane).
 *
 * State model: the collapsible LEDGER rail is the honest record — bridge-observed world events
 * (useWorldLog) merged with actions taken from THIS tab. Lifecycle actions go through
 * POST /sessions only — a thin relay onto `pe-revit session …`, the same verbs an agent runs, so
 * both actors leave the same trace and there is exactly one way a session comes to exist.
 *
 * The LEGS column is what makes this page honest: `session status` probes each session's companion
 * services (the @pe/host process) and reports up/down/unverified per session with WHY it believes
 * that. A world can be `ready` in Revit and have a dead host beside it, and until legs existed this
 * page could not say so.
 *
 * Design-language pass 2026-08-16: the fleet renders through `MasterTable` with a `verdict:` phase
 * column (ready · booting · unresponsive on the meaning band); lifecycle controls are lang `Verb`s
 * (all commit — every one writes beyond the page); dashed declare buttons lose the seam edge they
 * were squatting on.
 */

export const Route = createFileRoute("/instances")({ component: Page });

type SessionAction =
  | { action: "start"; year: string; lane: "installed" | "dev"; doc?: string }
  | { action: "stop"; id: string; force?: boolean }
  | { action: "restart"; id: string }
  | { action: "converge"; id: string };

const YEARS = ["24", "25", "26"];

function age(ms: number | undefined, nowMs: number): string | undefined {
  if (!ms || Number.isNaN(ms)) return undefined;
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Registry years arrive as "2025" (sometimes "25" from POST bodies) — one display form. */
function yearLabel(year: string | undefined): string | undefined {
  if (!year) return undefined;
  return year.length === 2 ? `20${year}` : year;
}

/**
 * The id a start would mint, when this page can know it. The SDK mints `{installed |
 * project-stem}-{yy}`, and only the installed lane's stem is a constant the browser holds — a dev
 * start's stem comes from the HOST's checkout project, which is not on the wire. So a dev start
 * never pre-empts; it posts, and the route relays whatever the SDK answers plus its nextSteps.
 */
function mintedSessionId(lane: "installed" | "dev", year: string): string | null {
  return lane === "installed" ? `installed-${year}` : null;
}

/**
 * A registry row already owns the id this start would mint, so `start` is the wrong verb —
 * `restart` is. Beta.122 does not refuse the start: it answers `session.generation-displaced`,
 * mints a NEW generation, boots a whole Revit and moves the pointer off the old one (its own
 * `fix:` names restart). So pre-empting here is not politeness, it is the difference between
 * refreshing a session and silently orphaning a generation. Graveyard rows are the ones
 * `phase === "gone"` names: stopped, dead, crashed. Restart is what the graveyard's own per-row
 * verb already does to them.
 */
function stoppedTwin(
  worlds: readonly WorldFacts[],
  lane: "installed" | "dev",
  year: string,
): WorldFacts | undefined {
  const id = mintedSessionId(lane, year);
  return id ? worlds.find((w) => w.id === id && w.phase === "gone") : undefined;
}

function parseUtc(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** lane · year · pid — the machine identity behind the world, in the SDK's words. */
function worldSub(world: WorldFacts): string {
  return [world.lane, yearLabel(world.year), world.pid ? `pid ${world.pid}` : undefined]
    .filter(Boolean)
    .join(" · ");
}

/** The phase word, spoken as a row-level pipeline verdict on the meaning band. */
function phaseVerdict(world: WorldFacts): Verdict {
  const state = world.row?.state;
  if (world.phase === "ready")
    return {
      word: state ?? "ready",
      tone: "done",
      note: world.session
        ? "The bridge holds an open connection to this world — the strongest truth this page can offer."
        : (world.row?.detail ??
          "pe-revit verified this session's process identity: the right pid, started at the right moment, running the right executable."),
    };
  if (world.phase === "booting")
    return {
      word: state ?? "booting",
      tone: "ink",
      note:
        world.row?.detail ??
        "The registry says this process is in its boot window; no bridge connection exists yet, so everything about it is registry testimony.",
    };
  if (world.phase === "unresponsive")
    return {
      word: state ?? "unresponsive",
      tone: "caution",
      note:
        world.row?.detail ??
        "The process exists but stopped answering. A busy world is not the model disagreeing — stop offers force for exactly this state.",
    };
  return {
    word: state ?? "gone",
    tone: "mute",
    dim: true,
    note: world.row?.detail ?? "pe-revit says this world is gone.",
  };
}

/** Custody, spoken. `observed` is the SDK's word for "pe-revit holds no receipt for this". */
function custodyVerdict(world: WorldFacts): Verdict {
  return world.custody === "controlled"
    ? {
        word: "controlled",
        tone: "done",
        note: `pe-revit holds this session's registry receipt, so it owns its full lifecycle${world.origin ? ` (started by ${world.origin})` : ""}.`,
      }
    : {
        word: "observed",
        tone: "mute",
        note: "pe-revit holds no receipt for this session — it can read its status and documents and nothing else. Started outside pe-revit, so it is not this page's to stop.",
      };
}

// ── page ───────────────────────────────────────────────────────────────────────────────────────

function Page() {
  const { worlds, sessions, isLoading, error } = useFleet();
  const queryClient = useQueryClient();
  const worldLog = useWorldLog(sessions);

  const [localLog, setLocalLog] = useState<{ atMs: number; actor: "you"; label: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // action key while a POST is in flight
  const [outcome, setOutcome] = useState<{
    kind: OutcomeKind;
    text: string;
    says?: string;
  } | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [startYear, setStartYear] = useState("25");
  const [startDoc, setStartDoc] = useState("");
  const [startLane, setStartLane] = useState<"installed" | "dev">("installed");
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const act = async (request: SessionAction, label: string, busyKey: string) => {
    setBusy(busyKey);
    setOutcome(null);
    setLocalLog((l) => [...l.slice(-99), { atMs: Date.now(), actor: "you", label }]);
    try {
      const response = await fetch("/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = (await response.json()) as {
        error?: string;
        diagnostics?: { detail?: string }[];
        nextSteps?: string[];
      };
      // The SDK's own words, both halves. A diagnostic without its nextSteps is half a verdict:
      // `session.generation-displaced` (start on a row that already exists) is only actionable
      // because the SDK says so in its fix/nextSteps, and this page must not paraphrase it.
      const says = body.nextSteps?.length ? body.nextSteps.join(" · ") : undefined;
      if (!response.ok)
        setOutcome({
          kind: "error",
          text:
            body.diagnostics?.[0]?.detail ?? body.error ?? `${label} failed (${response.status})`,
          says,
        });
      else if (body.diagnostics?.length)
        // A refusal on an `observed` session arrives here as session.observed-not-mutable — the
        // resolver's words, not a UI-side guard's.
        setOutcome({
          kind: "advisory",
          text: body.diagnostics[0]?.detail ?? `${label} reported a diagnostic`,
          says,
        });
    } catch (caught) {
      setOutcome({
        kind: "error",
        text: caught instanceof Error ? caught.message : `${label} failed`,
      });
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: HOST_QUERY_KEY });
    }
  };

  const fleet = worlds.filter((w) => w.phase !== "gone");
  const graveyard = worlds
    .filter((w) => w.phase === "gone")
    .sort((a, b) => (parseUtc(b.row?.stoppedAtUtc) ?? 0) - (parseUtc(a.row?.stoppedAtUtc) ?? 0))
    .slice(0, 6); // ponytail: the registry keeps every session ever; show the recent tail only
  // Over ALL worlds, not the displayed graveyard tail: an old stopped row still owns its id.
  const twin = stoppedTwin(worlds, startLane, startYear);

  const ledger = [
    ...worldLog.map((e) => ({ atMs: e.atMs, actor: "bridge" as const, label: e.label })),
    ...localLog,
  ].sort((a, b) => a.atMs - b.atMs);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [ledger.length, ledgerOpen]);

  const fleetColumns = useMemo<Column<WorldFacts>[]>(
    () => [
      {
        key: "world",
        label: "world",
        title: "The pe-revit session id, or 'your Revit' for a session pe-revit only observes.",
        search: (w) => worldName(w).toLowerCase(),
        sort: (w) => (w.custody === "observed" ? "" : w.id),
        cell: (w) => (
          <span className="t-value block truncate px-1.5 text-ink">
            {w.custody === "observed" ? "your Revit" : <span className="face-mono">{w.id}</span>}
          </span>
        ),
      },
      {
        key: "custody",
        label: "custody",
        title:
          "Whether pe-revit holds this session's registry receipt. `controlled` means it owns the lifecycle; `observed` means it can only read.",
        width: "w-28",
        verdict: custodyVerdict,
      },
      {
        key: "phase",
        label: "phase",
        title: "What `pe-revit session status` says this world is doing right now.",
        width: "w-32",
        verdict: phaseVerdict,
      },
      {
        key: "detail",
        label: "lane · year · pid",
        title: "Machine identity of the process behind the world. Lane is payload SOURCE only.",
        cell: (w) => (
          <span className="face-mono t-caption block truncate px-1.5 text-ink-2">
            {worldSub(w)}
          </span>
        ),
      },
      {
        key: "legs",
        label: "legs",
        title:
          "Companion services beside this session (the @pe/host process), probed by `session status`. `pe-revit` narrates legs; it never starts them.",
        width: "w-40",
        cell: (w) => {
          const legs = w.row?.legs ?? [];
          if (legs.length === 0)
            return (
              <span
                className="t-caption block truncate px-1.5 italic text-ink-mute"
                title="No companion service file claims this session — an absence of evidence, not a dead host."
              >
                no legs
              </span>
            );
          return (
            <span className="flex flex-wrap gap-1 px-1">
              {legs.map((leg) => (
                <span
                  key={`${leg.name}-${leg.pid}`}
                  className={cn(
                    "face-mono t-caption rounded-md border border-line-2 px-1",
                    leg.state === "up"
                      ? "text-ink"
                      : leg.state === "down"
                        ? "text-ink-mute"
                        : "text-ink-2",
                  )}
                  // legBecause is the SDK's own disclosure of WHY it believes this leg belongs to
                  // this session — including when it is only a lane match and not proof.
                  title={`${leg.name} ${leg.state} via ${leg.how}${leg.url ? ` (${leg.url})` : ""} — ${leg.legBecause}`}
                >
                  {leg.name} {leg.state}
                </span>
              ))}
            </span>
          );
        },
      },
      {
        key: "docs",
        label: "documents",
        title:
          "The documents this session has open. `session status` reports them all; the bridge reports the active one live.",
        cell: (w) => {
          const documents = w.row?.documents ?? [];
          if (documents.length > 0) {
            const active = documents.find((d) => d.isActive) ?? documents[0]!;
            return (
              <span
                className="face-mono t-caption block truncate px-1.5 text-ink-2"
                title={documents
                  .map(
                    (d) =>
                      `${d.isActive ? "* " : "  "}${d.title ?? d.path ?? "(untitled)"}${d.isModified ? " (modified)" : ""}`,
                  )
                  .join("\n")}
              >
                {active.title ?? active.path ?? "(untitled)"}
                {documents.length > 1 ? ` +${documents.length - 1}` : ""}
              </span>
            );
          }
          if (w.activeDocumentTitle)
            return (
              <span className="face-mono t-caption block truncate px-1.5 text-ink-2">
                {w.activeDocumentTitle}
                {w.openDocumentCount > 1 ? ` +${w.openDocumentCount - 1}` : ""}
              </span>
            );
          if (w.session)
            return (
              <span
                className="t-caption block truncate px-1.5 italic text-ink-mute"
                title="The bridge is connected and reports no open document — a state, not a zero."
              >
                no open document
              </span>
            );
          return (
            <span
              className="t-caption block truncate px-1.5 italic text-ink-mute"
              title="No bridge connection and no documents in the status row, so nothing is known about this world's documents."
            >
              nothing observed
            </span>
          );
        },
      },
      {
        key: "seen",
        label: "seen",
        title:
          "How long ago this world was last observed — by the bridge when connected, else by `session status`.",
        right: true,
        width: "w-24",
        sort: (w) => (w.session ? w.session.observedAtUnixMs : parseUtc(w.row?.observedAtUtc)) ?? 0,
        cell: (w) => {
          const seen = w.session
            ? age(w.session.observedAtUnixMs, nowMs)
            : age(parseUtc(w.row?.observedAtUtc), nowMs);
          return (
            <span className="face-mono t-caption block px-1.5 text-right text-ink-2">
              {seen ? `${seen} ago` : ""}
            </span>
          );
        },
      },
      {
        key: "acts",
        label: "lifecycle",
        title:
          "Start, stop, restart and converge relay through POST /sessions onto `pe-revit session …` — the same verbs an agent runs, so both actors leave the same trace.",
        right: true,
        cell: (w) => {
          // No UI-side custody guard: the SDK resolver already refuses mutation on `observed` with
          // session.observed-not-mutable, and a second guard here could only disagree with it. The
          // buttons are simply absent on a session this page has no verbs for.
          if (w.custody !== "controlled")
            return (
              <span
                className="t-caption block truncate px-1.5 text-right italic text-ink-mute"
                title="pe-revit holds no receipt for this session, so it refuses every mutation on it. This page never starts or stops a session you own."
              >
                yours — not managed here
              </span>
            );
          const unresponsive = w.phase === "unresponsive";
          return (
            <span className="flex justify-end gap-1.5 px-1">
              <Verb
                tone="commit"
                label="converge"
                busy={busy === `converge-${w.id}`}
                disabled={busy != null}
                reason={`Attach to ${w.id} and sync this checkout's code into it — no restart, no lost documents.`}
                onClick={() =>
                  void act({ action: "converge", id: w.id }, `converge ${w.id}`, `converge-${w.id}`)
                }
              />
              <Verb
                tone="commit"
                label="restart"
                busy={busy === `restart-${w.id}`}
                disabled={busy != null}
                reason={`Kill and re-boot ${w.id} — a fresh Revit process on this machine, same id. It reopens the active document and lists what it dropped.`}
                onClick={() =>
                  void act({ action: "restart", id: w.id }, `restart ${w.id}`, `restart-${w.id}`)
                }
              />
              <Verb
                tone="commit"
                label={unresponsive ? "force stop" : "stop"}
                busy={busy === `stop-${w.id}`}
                disabled={busy != null}
                reason={
                  unresponsive
                    ? `${w.id} stopped answering, so a polite stop cannot land — force kills the process outright.`
                    : `Stop ${w.id} — asks the process to shut down and demotes it to the graveyard.`
                }
                onClick={() =>
                  void act(
                    { action: "stop", id: w.id, force: unresponsive },
                    `${unresponsive ? "force-" : ""}stop ${w.id}`,
                    `stop-${w.id}`,
                  )
                }
              />
            </span>
          );
        },
      },
    ],
    [busy, nowMs],
  );

  return (
    <div className="min-h-screen bg-page">
      <div className="mx-auto flex min-h-[85vh] max-w-6xl gap-0 px-6 py-6">
        <div className="flex min-w-0 flex-1 flex-col border-r border-line pr-5">
          {/* declare a new world — the only way a session comes to exist from this surface.
              The payload is an explicit choice, same words as the CLI: `installed` is a
              project-less start; `dev` asks a source-linked host for its checkout's Pe.App. */}
          <VerbGroup
            title="declare a new world"
            radius="boots a Revit process on this machine"
            className="pb-4"
          >
            <label className="flex items-center gap-1.5">
              <span className="t-caption t-upper text-ink-2">year</span>
              <select
                value={startYear}
                onChange={(e) => setStartYear(e.target.value)}
                disabled={busy != null}
                title="Which Revit year to boot. The session is registered under a minted id for this year."
                className="face-mono t-caption cursor-pointer rounded-md border border-line-2 bg-transparent px-1 py-0.5 text-ink"
              >
                {YEARS.map((y) => (
                  <option key={y} value={y}>
                    20{y}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="t-caption t-upper text-ink-2">payload</span>
              <select
                value={startLane}
                onChange={(e) => setStartLane(e.target.value as "installed" | "dev")}
                disabled={busy != null}
                title="installed: the product on this machine (a project-less start, the end-user case). dev: this checkout's Pe.App, built by the host first — refused on a host that has no checkout."
                className="face-mono t-caption cursor-pointer rounded-md border border-line-2 bg-transparent px-1 py-0.5 text-ink"
              >
                <option value="installed">installed</option>
                <option value="dev">dev (this checkout)</option>
              </select>
            </label>
            <input
              value={startDoc}
              onChange={(e) => setStartDoc(e.target.value)}
              disabled={busy != null}
              placeholder="document (optional)"
              title="A document title or path to open as the session comes up. Leave it empty to start with no document."
              className="face-mono t-caption w-52 rounded-md border border-line-2 bg-transparent px-1 py-0.5 text-ink placeholder:text-ink-mute"
            />
            {/* A stopped row still owns its id, so the honest verb here is `restart`, not
                `start` — the swap the SDK's own `fix:` names. The
                document field has no say in a restart (the SDK's keep-doc leg reopens what the
                dead process had), so it is not passed. */}
            {twin ? (
              <Verb
                tone="commit"
                label={`restart ${twin.id}`}
                busy={busy === `restart-${twin.id}`}
                disabled={busy != null}
                reason={`20${startYear} already has a ${twin.row?.state ?? "gone"} session under the id ${twin.id}, and a stopped row still owns its id. Restart boots a fresh Revit process under it.`}
                onClick={() =>
                  void act(
                    { action: "restart", id: twin.id },
                    `restart ${twin.id}`,
                    `restart-${twin.id}`,
                  )
                }
              />
            ) : (
              <Verb
                tone="commit"
                label={`+ start 20${startYear}`}
                busy={busy === `start-${startYear}`}
                disabled={busy != null}
                reason={`Boot a Revit 20${startYear} session and block until it is ready. The same verb pea and an agent run — the ledger records it either way.`}
                onClick={() =>
                  void act(
                    {
                      action: "start",
                      year: startYear,
                      lane: startLane,
                      ...(startDoc.trim() ? { doc: startDoc.trim() } : {}),
                    },
                    `start a 20${startYear} session`,
                    `start-${startYear}`,
                  )
                }
              />
            )}
          </VerbGroup>

          <MasterTable
            rows={fleet}
            columns={fleetColumns}
            rowKey={(w) => w.id}
            scopeLabel="fleet"
            empty={
              isLoading ? (
                <OutcomeLine kind="busy" label="reading the fleet" />
              ) : (
                <EmptyState story="scope" exit="declare a new world above — pick a year">
                  no worlds running
                </EmptyState>
              )
            }
          />

          {error ? (
            <div className="mt-2">
              <OutcomeLine kind="error" label={`fleet unreadable: ${error.message}`} />
            </div>
          ) : null}

          {outcome ? (
            <div className="mt-2">
              <OutcomeLine kind={outcome.kind} label={outcome.text} says={outcome.says} />
            </div>
          ) : null}

          {graveyard.length ? (
            <div className="mt-8">
              <div className="flex items-center gap-1.5 pb-2">
                <span className="t-caption t-upper text-ink-2">graveyard</span>
                <HelpTip>
                  The registry&apos;s recent tail — sessions that stopped, crashed, or were never
                  launched, newest first. `pe-revit session status --all` lists them all and
                  `session gc` prunes them. Starting again boots a fresh process under the same id.
                </HelpTip>
              </div>
              <table className="w-full border-collapse">
                <tbody>
                  {graveyard.map((world) => {
                    const died = age(parseUtc(world.row?.stoppedAtUtc), nowMs);
                    return (
                      <tr key={world.id} className="border-t border-line">
                        <td className="py-2 pr-4">
                          <div className="face-mono t-value italic text-ink-mute">{world.id}</div>
                          <span className="face-mono t-caption italic text-ink-mute">
                            {yearLabel(world.year) ?? "?"} · was pid {world.pid ?? "?"}
                          </span>
                        </td>
                        <td className="max-w-[260px] py-2 pr-4">
                          {/* The crash payload is the row's one live fact — it must not wear the
                              dropped/muted-italic styling the dead identity cells wear (ruled
                              2026-08-16: "instances' crash payload un-muted"). */}
                          <span
                            className="face-mono t-caption block truncate text-ink-2"
                            title={world.row?.failureDetail ?? world.row?.detail ?? undefined}
                          >
                            {world.row?.failureCode ??
                              world.row?.failureDetail ??
                              world.row?.detail ??
                              ""}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          <span className="face-mono t-caption italic text-ink-mute">
                            {died ? `died ${died} ago` : (world.row?.state ?? "gone")}
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <Verb
                            tone="commit"
                            label="start again"
                            busy={busy === `restart-${world.id}`}
                            disabled={busy != null}
                            reason={`Boot a fresh Revit process under the id ${world.id}. Nothing of the dead process survives into it.`}
                            onClick={() =>
                              void act(
                                { action: "restart", id: world.id },
                                `restart ${world.id}`,
                                `restart-${world.id}`,
                              )
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* ledger — collapsible to a 24px rail; the cockpit favors the fleet */}
        {ledgerOpen ? (
          <div className="flex w-72 flex-col pl-5">
            <div className="flex items-baseline justify-between pb-2">
              <span className="flex items-center gap-1.5">
                <span className="t-caption t-upper text-ink-2">ledger</span>
                <HelpTip>
                  The honest record of this tab: bridge-observed world events merged with the
                  actions you took here, oldest first. Pea&apos;s actions arrive through the same
                  bridge lane, so both actors leave the same trace.
                </HelpTip>
              </span>
              <button
                type="button"
                onClick={() => setLedgerOpen(false)}
                title="Collapse the ledger to its rail — nothing is lost; events keep accumulating."
                className="t-caption cursor-pointer rounded-md border border-line-2 px-1 text-ink-2 hover:veil"
              >
                ›
              </button>
            </div>
            <div ref={logRef} className="max-h-[82vh] min-h-0 flex-1 overflow-y-auto">
              {ledger.length === 0 ? (
                <EmptyState
                  story="scope"
                  exit="act on the fleet, or let the bridge observe a change"
                >
                  nothing observed yet
                </EmptyState>
              ) : null}
              {ledger.map((e, idx) => (
                <div key={idx} className="border-t border-line py-1.5">
                  <span
                    className={`face-mono t-caption ${e.actor === "bridge" ? "text-ink-2" : "text-ink"}`}
                    title={
                      e.actor === "bridge"
                        ? "Observed by the bridge — a world changed underneath this tab."
                        : "An action you took from this tab."
                    }
                  >
                    {e.actor}
                  </span>
                  <div className="t-label text-ink">{e.label}</div>
                  <span className="face-mono t-caption text-ink-2">
                    {(() => {
                      const s = Math.max(0, Math.round((nowMs - e.atMs) / 1000));
                      return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
                    })()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLedgerOpen(true)}
            title="Open the ledger — bridge-observed world events merged with your own actions from this tab."
            className="ml-2 flex w-6 cursor-pointer flex-col items-center gap-2 self-stretch rounded-md border border-line-2 bg-transparent py-2 hover:veil"
          >
            <span className="t-caption t-upper text-ink-2 [writing-mode:vertical-rl]">
              ledger · {ledger.length}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
