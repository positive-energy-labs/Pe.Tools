import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { EmptyState } from "#/components/lang/empty";
import { HelpTip } from "#/components/lang/help";
import { OutcomeLine, type OutcomeKind } from "#/components/lang/outcome";
import { Verb, VerbGroup } from "#/components/lang/verb";
import { MasterTable } from "#/components/master-table/master-table";
import type { Column, Verdict } from "#/components/master-table/model";
import { useFleet, type WorldFacts } from "#/host/fleet";
import { HOST_QUERY_KEY } from "#/host/queries";
import { useWorldLog } from "#/host/use-target";

/**
 * /instances — the fleet dashboard. Every Revit world the bridge or the sandbox registry knows
 * about: your own Revit (display-only), pea-owned sandboxes (start/stop/restart), and recently
 * killed sandboxes demoted to their own list. Also hosted as the "instances" chat workspace
 * plugin (iframed side pane).
 *
 * State model (from the poc round): the collapsible LEDGER rail is the honest record —
 * bridge-observed world events (useWorldLog) merged with actions taken from THIS tab. Lifecycle
 * actions go through POST /sessions/sandboxes only — the same `pe-revit sandbox` CLI pea's
 * pe_sandbox tool shells, so both actors leave the same trace and there is exactly one way a
 * sandbox comes to exist. World rows derive from fuseFleet — the same fusion the sentence speaks.
 *
 * Design-language pass 2026-08-16: the fleet renders through `MasterTable` with a `verdict:`
 * phase column (live · booting · unresponsive on the meaning band — `PHASE_COLOR`'s blue/kiln/
 * clay spends die here); lifecycle controls are lang `Verb`s (all commit — every one writes
 * beyond the page); dashed declare buttons lose the seam edge they were squatting on. Gaps in
 * docs/features/instances/DESIGN-AUDIT.md.
 */

export const Route = createFileRoute("/instances")({ component: Page });

type SandboxAction =
  | { action: "start"; year: string }
  | { action: "stop"; id: string; force?: boolean }
  | { action: "restart"; id: string };

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

function parseUtc(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

function worldSub(world: WorldFacts): string {
  const year = yearLabel(world.year);
  return world.session
    ? [world.session.lane, year, `pid ${world.session.processId}`].filter(Boolean).join(" · ")
    : ["sandbox", year ?? "?", world.pid ? `pid ${world.pid}` : undefined]
        .filter(Boolean)
        .join(" · ");
}

/** The phase word, spoken as a row-level pipeline verdict on the meaning band. */
function phaseVerdict(world: WorldFacts): Verdict {
  if (world.session)
    return {
      word: "live",
      tone: "done",
      note: "The bridge holds an open connection to this world — the strongest truth this page can offer.",
    };
  if (world.phase === "booting")
    return {
      word: world.registry?.state ?? "booting",
      tone: "ink",
      note: "The registry says this process is in its boot window; no bridge connection exists yet, so everything about it is registry testimony.",
    };
  if (world.phase === "unresponsive")
    return {
      word: "unresponsive",
      tone: "caution",
      note: "The process exists but stopped answering. A busy world is not the model disagreeing — stop offers force for exactly this state.",
    };
  return {
    word: world.registry?.state ?? "dead",
    tone: "mute",
    dim: true,
    note: "The registry says this world is gone.",
  };
}

// ── page ───────────────────────────────────────────────────────────────────────────────────────

function Page() {
  const { worlds, sessions, isLoading } = useFleet();
  const queryClient = useQueryClient();
  const worldLog = useWorldLog(sessions);

  const [localLog, setLocalLog] = useState<{ atMs: number; actor: "you"; label: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // action key while a POST is in flight
  const [outcome, setOutcome] = useState<{ kind: OutcomeKind; text: string } | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const act = async (request: SandboxAction, label: string, busyKey: string) => {
    setBusy(busyKey);
    setOutcome(null);
    setLocalLog((l) => [...l.slice(-99), { atMs: Date.now(), actor: "you", label }]);
    try {
      const response = await fetch("/sessions/sandboxes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = (await response.json()) as {
        error?: string;
        diagnostics?: { detail?: string }[];
      };
      if (!response.ok)
        setOutcome({
          kind: "error",
          text: body.error ?? `${label} failed (${response.status})`,
        });
      else if (body.diagnostics?.length)
        setOutcome({
          kind: "advisory",
          text: body.diagnostics[0]?.detail ?? `${label} reported a diagnostic`,
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

  const fleet = worlds.filter((w) => w.phase !== "dead");
  const killed = worlds
    .filter((w) => w.phase === "dead")
    .sort(
      (a, b) =>
        (parseUtc(b.registry?.stoppedAtUtc) ?? 0) - (parseUtc(a.registry?.stoppedAtUtc) ?? 0),
    )
    .slice(0, 6); // ponytail: registry keeps every sandbox ever; show the recent tail only

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
        title: "The one human name for a world: your own Revit, or a sandbox id.",
        search: (w) => (w.kind === "user" ? "your revit" : w.id),
        sort: (w) => (w.kind === "user" ? "" : w.id),
        cell: (w) => (
          <span className="t-value block truncate px-1.5 text-[var(--r-ink)]">
            {w.kind === "user" ? "your Revit" : <span className="face-mono">{w.id}</span>}
          </span>
        ),
      },
      {
        key: "phase",
        label: "phase",
        title:
          "What the fusion of bridge sessions and the sandbox registry says this world is doing.",
        width: "w-32",
        verdict: phaseVerdict,
      },
      {
        key: "detail",
        label: "lane · year · pid",
        title: "Machine identity of the process behind the world.",
        cell: (w) => (
          <span className="face-mono t-caption block truncate px-1.5 text-[var(--r-ink-2)]">
            {worldSub(w)}
          </span>
        ),
      },
      {
        key: "docs",
        label: "documents",
        title: "The active document the bridge observes, or the registry's own detail line.",
        cell: (w) => {
          if (w.session)
            return w.activeDocumentTitle ? (
              <span className="face-mono t-caption block truncate px-1.5 text-[var(--r-ink-2)]">
                {w.activeDocumentTitle}
                {w.openDocumentCount > 1 ? ` +${w.openDocumentCount - 1}` : ""}
              </span>
            ) : (
              <span
                className="t-caption block truncate px-1.5 italic text-[var(--r-ink-mute)]"
                title="The bridge is connected and reports no open document — a state, not a zero."
              >
                no open document
              </span>
            );
          return w.registry?.detail ? (
            <span className="face-mono t-caption block truncate px-1.5 text-[var(--r-ink-2)]">
              {w.registry.detail}
            </span>
          ) : (
            <span
              className="t-caption block truncate px-1.5 italic text-[var(--r-ink-mute)]"
              title="No bridge connection exists yet, so nothing is known about this world's documents."
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
          "How long ago the bridge last observed this world (or, before a connection exists, when the registry says it started).",
        right: true,
        width: "w-24",
        sort: (w) =>
          (w.session ? w.session.observedAtUnixMs : parseUtc(w.registry?.startedAtUtc)) ?? 0,
        cell: (w) => {
          const seen = w.session
            ? age(w.session.observedAtUnixMs, nowMs)
            : age(parseUtc(w.registry?.startedAtUtc), nowMs);
          return (
            <span className="face-mono t-caption block px-1.5 text-right text-[var(--r-ink-2)]">
              {seen ? `${seen} ago` : ""}
            </span>
          );
        },
      },
      {
        key: "acts",
        label: "lifecycle",
        title:
          "Start, stop and restart go through POST /sessions/sandboxes — the same lane pea's pe_sandbox tool shells, so both actors leave the same trace.",
        right: true,
        cell: (w) => {
          const sandboxId = w.kind === "sandbox" ? w.id : undefined;
          if (!sandboxId)
            return (
              <span
                className="t-caption block truncate px-1.5 text-right italic text-[var(--r-ink-mute)]"
                title="Your own Revit is display-only here — this page never starts or stops the session you own."
              >
                yours — not managed here
              </span>
            );
          const unresponsive = w.phase === "unresponsive";
          return (
            <span className="flex justify-end gap-1.5 px-1">
              <Verb
                tone="commit"
                label="restart"
                busy={busy === `restart-${sandboxId}`}
                disabled={busy != null}
                reason={`Kill and re-boot ${sandboxId} — a fresh Revit process on this machine, same id.`}
                onClick={() =>
                  void act(
                    { action: "restart", id: sandboxId },
                    `restart ${sandboxId}`,
                    `restart-${sandboxId}`,
                  )
                }
              />
              <Verb
                tone="commit"
                label={unresponsive ? "force stop" : "stop"}
                busy={busy === `stop-${sandboxId}`}
                disabled={busy != null}
                reason={
                  unresponsive
                    ? `${sandboxId} stopped answering, so a polite stop cannot land — force kills the process outright.`
                    : `Stop ${sandboxId} — asks the process to shut down and demotes it to the killed list.`
                }
                onClick={() =>
                  void act(
                    { action: "stop", id: sandboxId, force: unresponsive },
                    `${unresponsive ? "force-" : ""}stop ${sandboxId}`,
                    `stop-${sandboxId}`,
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
    <div className="min-h-screen bg-[var(--r-page)]">
      <div className="mx-auto flex min-h-[85vh] max-w-5xl gap-0 px-6 py-6">
        <div className="flex flex-1 flex-col border-r border-[var(--r-line)] pr-5">
          {/* declare a new world — the only way a sandbox comes to exist from this surface */}
          <VerbGroup
            title="declare a new world"
            radius="boots a Revit process on this machine"
            className="pb-4"
          >
            {YEARS.map((y) => (
              <Verb
                key={y}
                tone="commit"
                label={`+ 20${y}`}
                busy={busy === `start-${y}`}
                disabled={busy != null}
                reason={`Boot a fresh Revit 20${y} sandbox. Same lane as pea's pe_sandbox tool — the ledger records it either way.`}
                onClick={() =>
                  void act({ action: "start", year: y }, `start a 20${y} sandbox`, `start-${y}`)
                }
              />
            ))}
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

          {outcome ? (
            <div className="mt-2">
              <OutcomeLine kind={outcome.kind} label={outcome.text} />
            </div>
          ) : null}

          {killed.length ? (
            <div className="mt-8">
              <div className="flex items-center gap-1.5 pb-2">
                <span className="t-caption t-upper text-[var(--r-ink-2)]">killed</span>
                <HelpTip>
                  The registry&apos;s recent tail — sandboxes that stopped or died, newest first.
                  They never happened as far as the bridge is concerned now; start again boots a
                  fresh process under the same id.
                </HelpTip>
              </div>
              <table className="w-full border-collapse">
                <tbody>
                  {killed.map((world) => {
                    const died = age(parseUtc(world.registry?.stoppedAtUtc), nowMs);
                    return (
                      <tr key={world.id} className="border-t border-[var(--r-line)]">
                        <td className="py-2 pr-4">
                          <div className="face-mono t-value italic text-[var(--r-ink-mute)]">
                            {world.id}
                          </div>
                          <span className="face-mono t-caption italic text-[var(--r-ink-mute)]">
                            {yearLabel(world.year) ?? "?"} · was pid {world.pid ?? "?"}
                          </span>
                        </td>
                        <td className="max-w-[260px] py-2 pr-4">
                          <span className="face-mono t-caption block truncate italic text-[var(--r-ink-mute)]">
                            {world.registry?.firstFailureEvent?.message ??
                              world.registry?.detail ??
                              ""}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          <span className="face-mono t-caption italic text-[var(--r-ink-mute)]">
                            {died ? `died ${died} ago` : (world.registry?.state ?? "dead")}
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
                <span className="t-caption t-upper text-[var(--r-ink-2)]">ledger</span>
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
                className="t-caption cursor-pointer rounded-[var(--radius)] border border-[var(--r-line-2)] px-1 text-[var(--r-ink-2)] hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))]"
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
                <div key={idx} className="border-t border-[var(--r-line)] py-1.5">
                  <span
                    className={`face-mono t-caption ${e.actor === "bridge" ? "text-[var(--r-ink-2)]" : "text-[var(--r-ink)]"}`}
                    title={
                      e.actor === "bridge"
                        ? "Observed by the bridge — a world changed underneath this tab."
                        : "An action you took from this tab."
                    }
                  >
                    {e.actor}
                  </span>
                  <div className="t-label text-[var(--r-ink)]">{e.label}</div>
                  <span className="face-mono t-caption text-[var(--r-ink-2)]">
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
            className="ml-2 flex w-6 cursor-pointer flex-col items-center gap-2 self-stretch rounded-[var(--radius)] border border-[var(--r-line-2)] bg-transparent py-2 hover:[background-image:linear-gradient(var(--r-veil),var(--r-veil))]"
          >
            <span className="t-caption t-upper text-[var(--r-ink-2)] [writing-mode:vertical-rl]">
              ledger · {ledger.length}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
