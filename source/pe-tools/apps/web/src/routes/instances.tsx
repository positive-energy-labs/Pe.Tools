import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { PHASE_COLOR, useFleet, type WorldFacts } from "#/host/fleet";
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

function worldDocs(world: WorldFacts): string {
  if (world.session)
    return world.activeDocumentTitle
      ? `${world.activeDocumentTitle}${world.openDocumentCount > 1 ? ` +${world.openDocumentCount - 1}` : ""}`
      : "—";
  return world.registry?.detail ?? "—";
}

// ── ui atoms ───────────────────────────────────────────────────────────────────────────────────

function Mono({
  children,
  size = 10,
  color = "var(--muted-foreground)",
}: {
  children: React.ReactNode;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="font-[var(--font-pe-mono)]"
      style={{ fontSize: size, color, letterSpacing: "0.04em" }}
    >
      {children}
    </span>
  );
}

function Btn({
  children,
  onClick,
  danger,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="tele ml-2 px-1.5 py-0.5"
      style={{
        fontSize: 9,
        borderRadius: 2,
        cursor: disabled ? "default" : "pointer",
        border: `0.5px solid ${danger ? "var(--cat-clay)" : "var(--line-2)"}`,
        color: danger ? "var(--cat-clay)" : "var(--muted-foreground)",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────────────────────

function Page() {
  const { worlds, sessions, isLoading } = useFleet();
  const queryClient = useQueryClient();
  const worldLog = useWorldLog(sessions);

  const [localLog, setLocalLog] = useState<{ atMs: number; actor: "you"; label: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // action key while a POST is in flight
  const [error, setError] = useState<string | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const act = async (request: SandboxAction, label: string, busyKey: string) => {
    setBusy(busyKey);
    setError(null);
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
      if (!response.ok) setError(body.error ?? `request failed (${response.status})`);
      else if (body.diagnostics?.length) setError(body.diagnostics[0]?.detail ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "request failed");
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

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto flex max-w-5xl gap-0 px-6 py-6" style={{ minHeight: "85vh" }}>
        <div className="flex-1 pr-5" style={{ borderRight: "0.5px solid var(--line-2)" }}>
          {/* declare a new world — the only way a sandbox comes to exist from this surface */}
          <div className="flex items-center gap-2 pb-4">
            <Mono size={10}>declare a new world:</Mono>
            {YEARS.map((y) => (
              <button
                key={y}
                type="button"
                disabled={busy != null}
                onClick={() =>
                  void act({ action: "start", year: y }, `start a 20${y} sandbox`, `start-${y}`)
                }
                className="tele flex-1 py-1.5"
                style={{
                  fontSize: 10,
                  borderRadius: 2,
                  cursor: busy ? "default" : "pointer",
                  border: "0.5px dashed var(--line-2)",
                  color: "var(--muted-foreground)",
                  opacity: busy === `start-${y}` ? 0.5 : 1,
                }}
              >
                {busy === `start-${y}` ? "starting…" : `+ 20${y}`}
              </button>
            ))}
          </div>

          <div className="pb-2">
            <Mono size={10}>FLEET</Mono>
          </div>
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <tbody>
              {fleet.map((world) => {
                const sandboxId = world.kind === "sandbox" ? world.id : undefined;
                const unresponsive = world.phase === "unresponsive";
                const seen = world.session
                  ? age(world.session.observedAtUnixMs, nowMs)
                  : age(parseUtc(world.registry?.startedAtUtc), nowMs);
                return (
                  <tr key={world.id} style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                    <td className="py-2 pr-3" style={{ width: 8 }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 6,
                          height: 6,
                          borderRadius: 3,
                          background: PHASE_COLOR[world.phase],
                        }}
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <div style={{ fontSize: 13, color: "var(--foreground)" }}>
                        {world.kind === "user" ? "your Revit" : world.id}
                      </div>
                      <Mono size={9}>{worldSub(world)}</Mono>
                    </td>
                    <td className="py-2 pr-4">
                      <Mono size={10} color={PHASE_COLOR[world.phase]}>
                        {(world.session
                          ? "live"
                          : (world.registry?.state ?? world.phase)
                        ).toUpperCase()}
                      </Mono>
                    </td>
                    <td className="py-2 pr-4" style={{ maxWidth: 220 }}>
                      <Mono size={9}>{worldDocs(world)}</Mono>
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <Mono size={9}>{seen ? `seen ${seen} ago` : ""}</Mono>
                    </td>
                    <td className="py-2 text-right" style={{ whiteSpace: "nowrap" }}>
                      {sandboxId ? (
                        <>
                          <Btn
                            disabled={busy != null}
                            onClick={() =>
                              void act(
                                { action: "restart", id: sandboxId },
                                `restart ${sandboxId}`,
                                `restart-${sandboxId}`,
                              )
                            }
                          >
                            restart
                          </Btn>
                          <Btn
                            disabled={busy != null}
                            danger={unresponsive}
                            onClick={() =>
                              void act(
                                { action: "stop", id: sandboxId, force: unresponsive },
                                `${unresponsive ? "force-" : ""}stop ${sandboxId}`,
                                `stop-${sandboxId}`,
                              )
                            }
                          >
                            {unresponsive ? "force stop" : "stop"}
                          </Btn>
                        </>
                      ) : (
                        <Mono size={9}>yours — not managed here</Mono>
                      )}
                    </td>
                  </tr>
                );
              })}
              {fleet.length === 0 && !isLoading ? (
                <tr>
                  <td className="py-3" colSpan={6}>
                    <Mono size={10}>no worlds running — declare one above</Mono>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>

          {error ? (
            <div className="mt-2">
              <Mono size={9} color="var(--cat-clay)">
                {error}
              </Mono>
            </div>
          ) : null}

          {killed.length ? (
            <div className="mt-8">
              <div className="pb-2">
                <Mono size={10}>KILLED</Mono>
              </div>
              <table className="w-full" style={{ borderCollapse: "collapse", opacity: 0.55 }}>
                <tbody>
                  {killed.map((world) => {
                    const died = age(parseUtc(world.registry?.stoppedAtUtc), nowMs);
                    return (
                      <tr key={world.id} style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                        <td className="py-2 pr-3" style={{ width: 8 }}>
                          <span
                            style={{
                              display: "inline-block",
                              width: 6,
                              height: 6,
                              borderRadius: 3,
                              border: "1px solid var(--muted-foreground)",
                            }}
                          />
                        </td>
                        <td className="py-2 pr-4">
                          <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
                            {world.id}
                          </div>
                          <Mono size={9}>
                            {yearLabel(world.year) ?? "?"} · was pid {world.pid ?? "?"}
                          </Mono>
                        </td>
                        <td className="py-2 pr-4" style={{ maxWidth: 260 }}>
                          <Mono size={9}>
                            {world.registry?.firstFailureEvent?.message ??
                              world.registry?.detail ??
                              ""}
                          </Mono>
                        </td>
                        <td className="py-2 pr-4">
                          <Mono size={9}>
                            {died ? `died ${died} ago` : (world.registry?.state ?? "dead")}
                          </Mono>
                        </td>
                        <td className="py-2 text-right">
                          <Btn
                            disabled={busy != null}
                            onClick={() =>
                              void act(
                                { action: "restart", id: world.id },
                                `restart ${world.id}`,
                                `restart-${world.id}`,
                              )
                            }
                          >
                            start again
                          </Btn>
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
              <Mono size={10}>LEDGER — observed from this tab</Mono>
              <button
                type="button"
                onClick={() => setLedgerOpen(false)}
                className="tele cursor-pointer px-1"
                style={{
                  fontSize: 9,
                  borderRadius: 2,
                  border: "0.5px solid var(--line-2)",
                  color: "var(--muted-foreground)",
                }}
              >
                ›
              </button>
            </div>
            <div
              ref={logRef}
              className="min-h-0 flex-1 overflow-y-auto"
              style={{ maxHeight: "82vh" }}
            >
              {ledger.length === 0 ? (
                <Mono size={9}>quiet — world changes and your actions land here</Mono>
              ) : null}
              {ledger.map((e, idx) => (
                <div
                  key={idx}
                  className="py-1.5"
                  style={{ borderTop: "0.5px solid var(--line-soft)" }}
                >
                  <Mono
                    size={9}
                    color={e.actor === "bridge" ? "var(--pe-blue)" : "var(--foreground)"}
                  >
                    {e.actor}
                  </Mono>
                  <div style={{ fontSize: 11, color: "var(--foreground)" }}>{e.label}</div>
                  <Mono size={8}>
                    {(() => {
                      const s = Math.max(0, Math.round((nowMs - e.atMs) / 1000));
                      return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
                    })()}
                  </Mono>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setLedgerOpen(true)}
            title="open the ledger"
            className="ml-2 flex cursor-pointer flex-col items-center gap-2 py-2"
            style={{
              width: 24,
              border: "0.5px solid var(--line-2)",
              borderRadius: 2,
              background: "transparent",
              alignSelf: "stretch",
            }}
          >
            <span
              className="font-[var(--font-pe-mono)]"
              style={{
                fontSize: 9,
                letterSpacing: "0.08em",
                color: "var(--muted-foreground)",
                writingMode: "vertical-rl",
              }}
            >
              LEDGER · {ledger.length}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
