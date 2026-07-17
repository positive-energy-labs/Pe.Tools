import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { HOST_QUERY_KEY, useBridgeSessionsListQuery } from "#/host/queries";
import { fromBridgeSessions, type SessionFacts } from "#/host/target";
import { useWorldLog } from "#/host/use-target";

/**
 * /instances — the fleet dashboard. Every Revit world the bridge or the sandbox registry knows
 * about: your own Revit (display-only), pea-owned sandboxes (start/stop/restart), and recently
 * killed sandboxes demoted to their own list. Also hosted as the "instances" chat workspace
 * plugin (iframed side pane).
 *
 * State model (from the poc round): the side LEDGER is the honest record — bridge-observed world
 * events (useWorldLog) merged with actions taken from THIS tab. Lifecycle actions go through
 * POST /sessions/sandboxes only — the same `pe-revit sandbox` CLI pea's pe_sandbox tool shells,
 * so both actors leave the same trace and there is exactly one way a sandbox comes to exist.
 *
 * Reactivity: bridge sessions ride the root SSE invalidation (live). The sandbox registry has no
 * push channel while a process boots before its bridge connects, so that query also polls.
 * ponytail: 5s poll, always on while mounted; a start-scoped poll if it ever matters.
 */

export const Route = createFileRoute("/instances")({ component: Page });

// ── sandbox registry query ─────────────────────────────────────────────────────────────────────

/** One entry of `pe-revit sandbox status --json` (relayed verbatim by the host). */
interface SandboxEntry {
  id: string;
  state:
    | "materialized"
    | "booting"
    | "ready"
    | "unresponsive"
    | "stopped"
    | "dead"
    | "pid-reused";
  detail?: string | null;
  pid?: number | null;
  year?: string | null;
  payloadSource?: string | null;
  startedAtUtc?: string | null;
  stoppedAtUtc?: string | null;
  firstFailureEvent?: { message?: string } | null;
}

function useSandboxRegistry() {
  // Under HOST_QUERY_KEY so the root SSE invalidation (session connect/disconnect) refetches it
  // too; the interval covers the boot window where no bridge events exist yet.
  return useQuery({
    queryKey: [...HOST_QUERY_KEY, "", "sessions.sandboxes", ""],
    queryFn: async (): Promise<SandboxEntry[]> => {
      const response = await fetch("/sessions/sandboxes");
      if (!response.ok) throw new Error(`sandbox status ${response.status}`);
      const body = (await response.json()) as { result?: { sandboxes?: SandboxEntry[] } };
      return body.result?.sandboxes ?? [];
    },
    refetchInterval: 5_000,
    refetchOnWindowFocus: false,
  });
}

type SandboxAction =
  | { action: "start"; year: string }
  | { action: "stop"; id: string; force?: boolean }
  | { action: "restart"; id: string };

// ── row model ──────────────────────────────────────────────────────────────────────────────────

interface Row {
  key: string;
  title: string;
  sub: string;
  phase: string;
  phaseColor: string;
  docs: string;
  seen?: string;
  sandboxId?: string; // present => lifecycle buttons
  unresponsive?: boolean;
}

const RUNNING_STATES = new Set(["materialized", "booting", "ready", "unresponsive", "pid-reused"]);

const STATE_COLOR: Record<string, string> = {
  live: "var(--pe-blue)",
  ready: "var(--pe-blue)",
  booting: "var(--cat-kiln)",
  materialized: "var(--cat-kiln)",
  unresponsive: "var(--cat-clay)",
  "pid-reused": "var(--cat-clay)",
};

function age(iso: string | null | undefined, nowMs: number): string | undefined {
  if (!iso) return undefined;
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (Number.isNaN(s)) return undefined;
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

function buildRows(
  sessions: SessionFacts[],
  registry: SandboxEntry[],
  nowMs: number,
): { fleet: Row[]; killed: Row[] } {
  const fleet: Row[] = [];

  // Bridge-connected sessions are the strongest truth — user worlds and live sandboxes.
  for (const s of sessions) {
    const isSandbox = s.lane === "sandbox";
    fleet.push({
      key: s.sessionId,
      title: isSandbox ? (s.sandboxId ?? s.sessionId) : "your Revit",
      sub: `${s.lane} · pid ${s.processId}`,
      phase: "LIVE",
      phaseColor: STATE_COLOR.live!,
      docs: s.activeDocumentTitle
        ? `${s.activeDocumentTitle}${s.openDocumentCount > 1 ? ` +${s.openDocumentCount - 1}` : ""}`
        : "—",
      seen: s.observedAtUnixMs
        ? age(new Date(s.observedAtUnixMs).toISOString(), nowMs)
        : undefined,
      sandboxId: isSandbox ? s.sandboxId : undefined,
    });
  }

  // Registry sandboxes not (yet) bridge-connected: booting, unresponsive, killed.
  const connected = new Set(sessions.map((s) => s.sandboxId).filter(Boolean));
  const killedEntries: SandboxEntry[] = [];
  for (const e of registry) {
    if (connected.has(e.id)) continue;
    if (RUNNING_STATES.has(e.state)) {
      fleet.push({
        key: e.id,
        title: e.id,
        sub: `sandbox · ${e.year ?? "?"}${e.pid ? ` · pid ${e.pid}` : ""}`,
        phase: e.state.toUpperCase(),
        phaseColor: STATE_COLOR[e.state] ?? "var(--muted-foreground)",
        docs: e.detail ?? "—",
        seen: age(e.startedAtUtc, nowMs),
        sandboxId: e.id,
        unresponsive: e.state === "unresponsive" || e.state === "pid-reused",
      });
    } else {
      killedEntries.push(e);
    }
  }

  const killed = killedEntries
    .sort((a, b) => Date.parse(b.stoppedAtUtc ?? "") - Date.parse(a.stoppedAtUtc ?? ""))
    .slice(0, 6) // ponytail: registry keeps every sandbox ever; show the recent tail only
    .map<Row>((e) => ({
      key: e.id,
      title: e.id,
      sub: `20?? ${e.year ?? ""} · was pid ${e.pid ?? "?"}`,
      phase: e.state.toUpperCase(),
      phaseColor: "var(--muted-foreground)",
      docs: e.firstFailureEvent?.message ?? e.detail ?? "",
      seen: age(e.stoppedAtUtc, nowMs),
      sandboxId: e.id,
    }));

  return { fleet, killed };
}

// ── local ledger (this-tab actions merged with bridge-observed world events) ───────────────────

interface LocalEv {
  atMs: number;
  actor: "you";
  label: string;
}

const YEARS = ["24", "25", "26"];

// ── ui atoms ───────────────────────────────────────────────────────────────────────────────────

function Mono({ children, size = 10, color = "var(--muted-foreground)" }: { children: React.ReactNode; size?: number; color?: string }) {
  return (
    <span className="font-[var(--font-pe-mono)]" style={{ fontSize: size, color, letterSpacing: "0.04em" }}>
      {children}
    </span>
  );
}

function Btn({ children, onClick, danger, disabled }: { children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="tele ml-2 px-1.5 py-0.5"
      style={{
        fontSize: 9, borderRadius: 2, cursor: disabled ? "default" : "pointer",
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
  const sessionsQuery = useBridgeSessionsListQuery();
  const sessions = fromBridgeSessions(sessionsQuery.data?.sessions ?? []);
  const registry = useSandboxRegistry();
  const queryClient = useQueryClient();
  const worldLog = useWorldLog(sessions);

  const [localLog, setLocalLog] = useState<LocalEv[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // action key while a POST is in flight
  const [error, setError] = useState<string | null>(null);
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

  const { fleet, killed } = buildRows(sessions, registry.data ?? [], nowMs);

  const ledger = [
    ...worldLog.map((e) => ({ atMs: e.atMs, actor: "bridge" as const, label: e.label })),
    ...localLog,
  ].sort((a, b) => a.atMs - b.atMs);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [ledger.length]);

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
                onClick={() => void act({ action: "start", year: y }, `start a 20${y} sandbox`, `start-${y}`)}
                className="tele flex-1 py-1.5"
                style={{
                  fontSize: 10, borderRadius: 2, cursor: busy ? "default" : "pointer",
                  border: "0.5px dashed var(--line-2)", color: "var(--muted-foreground)",
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
              {fleet.map((row) => (
                <tr key={row.key} style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                  <td className="py-2 pr-3" style={{ width: 8 }}>
                    <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: row.phaseColor }} />
                  </td>
                  <td className="py-2 pr-4">
                    <div style={{ fontSize: 13, color: "var(--foreground)" }}>{row.title}</div>
                    <Mono size={9}>{row.sub}</Mono>
                  </td>
                  <td className="py-2 pr-4">
                    <Mono size={10} color={row.phaseColor}>{row.phase}</Mono>
                  </td>
                  <td className="py-2 pr-4" style={{ maxWidth: 220 }}>
                    <Mono size={9}>{row.docs}</Mono>
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <Mono size={9}>{row.seen ? `seen ${row.seen} ago` : ""}</Mono>
                  </td>
                  <td className="py-2 text-right" style={{ whiteSpace: "nowrap" }}>
                    {row.sandboxId ? (
                      <>
                        <Btn disabled={busy != null} onClick={() => void act({ action: "restart", id: row.sandboxId! }, `restart ${row.sandboxId}`, `restart-${row.sandboxId}`)}>
                          restart
                        </Btn>
                        <Btn
                          disabled={busy != null}
                          danger={row.unresponsive}
                          onClick={() =>
                            void act(
                              { action: "stop", id: row.sandboxId!, force: row.unresponsive },
                              `${row.unresponsive ? "force-" : ""}stop ${row.sandboxId}`,
                              `stop-${row.sandboxId}`,
                            )
                          }
                        >
                          {row.unresponsive ? "force stop" : "stop"}
                        </Btn>
                      </>
                    ) : (
                      <Mono size={9}>yours — not managed here</Mono>
                    )}
                  </td>
                </tr>
              ))}
              {fleet.length === 0 && !sessionsQuery.isLoading ? (
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
              <Mono size={9} color="var(--cat-clay)">{error}</Mono>
            </div>
          ) : null}

          {killed.length ? (
            <div className="mt-8">
              <div className="pb-2">
                <Mono size={10}>KILLED</Mono>
              </div>
              <table className="w-full" style={{ borderCollapse: "collapse", opacity: 0.55 }}>
                <tbody>
                  {killed.map((row) => (
                    <tr key={row.key} style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                      <td className="py-2 pr-3" style={{ width: 8 }}>
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, border: "1px solid var(--muted-foreground)" }} />
                      </td>
                      <td className="py-2 pr-4">
                        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{row.title}</div>
                        <Mono size={9}>{row.sub}</Mono>
                      </td>
                      <td className="py-2 pr-4">
                        <Mono size={9}>{row.seen ? `died ${row.seen} ago` : row.phase.toLowerCase()}</Mono>
                      </td>
                      <td className="py-2 text-right">
                        <Btn disabled={busy != null} onClick={() => void act({ action: "restart", id: row.sandboxId! }, `restart ${row.sandboxId}`, `restart-${row.sandboxId}`)}>
                          start again
                        </Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* ledger */}
        <div ref={logRef} className="w-72 overflow-y-auto pl-5" style={{ maxHeight: "88vh" }}>
          <div className="pb-2">
            <Mono size={10}>LEDGER — observed from this tab</Mono>
          </div>
          {ledger.length === 0 ? (
            <Mono size={9}>quiet — world changes and your actions land here</Mono>
          ) : null}
          {ledger.map((e, idx) => (
            <div key={idx} className="py-1.5" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
              <Mono size={9} color={e.actor === "bridge" ? "var(--pe-blue)" : "var(--foreground)"}>
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
    </div>
  );
}
