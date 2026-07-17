import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useReducer, useRef, useState } from "react";

import { RfaChip, RvtChip } from "#/components/document-chips";
import { TargetChip } from "#/components/target-chip";
import {
  mintSelector,
  selectorLabel,
  sessionLabel,
  type SessionFacts,
  type TargetSelector,
} from "#/host/target";
import { useTarget } from "#/host/use-target";

/* ------------------------------------------------------------------------------------------------
 * PROTOTYPE — poc/instances-c. Throwaway. Concept C "COCKPIT": the three real chips
 * (TargetChip + RvtChip + RfaChip, live against the host) anchored above a tightened
 * copy of the poc/instances mock fleet. The header row IS the current target; every
 * fleet row grows a "pin" action that rewires it. Real bridge sessions surface as live
 * rows at the top of the fleet so pinning one actually makes the chips work.
 * Fleet lifecycle stays mock; chips + useTarget are real. Delete me when promoted.
 * ---------------------------------------------------------------------------------------------- */

export const Route = createFileRoute("/poc/instances-c")({ component: Page });

// ── mock fleet (same reducer as poc/instances, plus a "note" action for chip events) ────────────

type Phase = "booting" | "live" | "unresponsive" | "stopping" | "dead";
type Kind = "rrd" | "installed" | "sandbox";

interface Inst {
  id: string;
  kind: Kind;
  year: number;
  pid?: number;
  phase: Phase;
  bootProgress?: number;
  docs: string[];
  observedAtMs: number;
  diedAtMs?: number;
}

interface Ev {
  atMs: number;
  actor: "you" | "pea" | "bridge";
  text: string;
}

interface Fleet {
  nowMs: number;
  instances: Inst[];
  events: Ev[];
}

const T0 = 1_800_000_000_000;

const seed: Fleet = {
  nowMs: T0,
  instances: [
    { id: "user-rrd", kind: "rrd", year: 26, pid: 41220, phase: "live", docs: ["Tower_A.rvt", "Site.rvt"], observedAtMs: T0 - 4_000 },
    { id: "sbx-quartz", kind: "sandbox", year: 25, pid: 50912, phase: "live", docs: ["VAV_Box.rfa"], observedAtMs: T0 - 11_000 },
    { id: "sbx-basalt", kind: "sandbox", year: 24, pid: 51544, phase: "booting", bootProgress: 0.35, docs: [], observedAtMs: T0 - 2_000 },
    { id: "sbx-flint", kind: "sandbox", year: 25, pid: 49001, phase: "unresponsive", docs: ["Legacy.rvt"], observedAtMs: T0 - 97_000 },
    { id: "sbx-ash", kind: "sandbox", year: 24, pid: 47120, phase: "dead", docs: [], observedAtMs: T0 - 900_000, diedAtMs: T0 - 840_000 },
  ],
  events: [
    { atMs: T0 - 900_000, actor: "pea", text: "start sandbox sbx-ash (2024) via pe_sandbox" },
    { atMs: T0 - 840_000, actor: "pea", text: "stop sbx-ash via pe_sandbox" },
    { atMs: T0 - 320_000, actor: "you", text: "start sandbox sbx-quartz (2025)" },
    { atMs: T0 - 120_000, actor: "pea", text: "start sandbox sbx-flint (2025) via pe_sandbox" },
    { atMs: T0 - 97_000, actor: "bridge", text: "sbx-flint stopped answering — unresponsive" },
    { atMs: T0 - 40_000, actor: "you", text: "start sandbox sbx-basalt (2024)" },
  ],
};

type Act =
  | { t: "tick" }
  | { t: "start"; year: number }
  | { t: "stop"; id: string; force?: boolean }
  | { t: "restart"; id: string }
  | { t: "note"; actor: Ev["actor"]; text: string };

let mint = 0;
const NAMES = ["copper", "slate", "amber", "chert", "onyx", "tuff"];

function reduce(f: Fleet, a: Act): Fleet {
  const now = a.t === "tick" ? f.nowMs + 1000 : f.nowMs;
  const ev = (actor: Ev["actor"], text: string): Ev => ({ atMs: now, actor, text });

  if (a.t === "tick") {
    const instances = f.instances.map((i) => {
      if (i.phase === "booting") {
        const p = (i.bootProgress ?? 0) + 0.006 + Math.abs(Math.sin(i.pid ?? 1)) * 0.004;
        return p >= 1
          ? { ...i, phase: "live" as Phase, bootProgress: undefined, observedAtMs: now }
          : { ...i, bootProgress: p };
      }
      if (i.phase === "stopping") return { ...i, phase: "dead" as Phase, diedAtMs: now };
      if (i.phase === "live" && Math.random() < 0.25) return { ...i, observedAtMs: now };
      return i;
    });
    const boots = instances.filter(
      (i, idx) => i.phase === "live" && f.instances[idx]?.phase === "booting",
    );
    return {
      ...f,
      nowMs: now,
      instances,
      events: [...f.events, ...boots.map((b) => ev("bridge", `${b.id} is live (pid ${b.pid})`))],
    };
  }

  if (a.t === "start") {
    const id = `sbx-${NAMES[mint++ % NAMES.length]}`;
    return {
      ...f,
      instances: [
        ...f.instances,
        { id, kind: "sandbox", year: a.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0, docs: [], observedAtMs: now },
      ],
      events: [...f.events, ev("you", `start sandbox ${id} (20${a.year})`)],
    };
  }

  if (a.t === "stop")
    return {
      ...f,
      instances: f.instances.map((i) => (i.id === a.id ? { ...i, phase: "stopping" } : i)),
      events: [...f.events, ev("you", `${a.force ? "force-" : ""}stop ${a.id}`)],
    };

  if (a.t === "restart")
    return {
      ...f,
      instances: f.instances.map((i) =>
        i.id === a.id ? { ...i, phase: "booting", bootProgress: 0, diedAtMs: undefined } : i,
      ),
      events: [...f.events, ev("you", `restart ${a.id}`)],
    };

  if (a.t === "note") return { ...f, events: [...f.events, ev(a.actor, a.text)] };

  return f;
}

// ── shared bits ────────────────────────────────────────────────────────────────────────────────

const PHASE_COLOR: Record<Phase, string> = {
  booting: "var(--cat-kiln)",
  live: "var(--pe-blue)",
  unresponsive: "var(--cat-clay)",
  stopping: "var(--muted-foreground)",
  dead: "var(--muted-foreground)",
};

const YEARS = [24, 25, 26];

function age(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function Mono({ children, size = 10, color = "var(--muted-foreground)" }: { children: React.ReactNode; size?: number; color?: string }) {
  return (
    <span className="font-[var(--font-pe-mono)]" style={{ fontSize: size, color, letterSpacing: "0.04em" }}>
      {children}
    </span>
  );
}

function Btn({ children, onClick, danger, accent }: { children: React.ReactNode; onClick: () => void; danger?: boolean; accent?: boolean }) {
  const color = danger ? "var(--cat-clay)" : accent ? "var(--pe-blue)" : "var(--muted-foreground)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="tele ml-2 px-1.5 py-0.5"
      style={{
        fontSize: 9, borderRadius: 2, cursor: "pointer",
        border: `0.5px solid ${danger ? "var(--cat-clay)" : accent ? "var(--pe-blue)" : "var(--line-2)"}`,
        color,
      }}
    >
      {children}
    </button>
  );
}

// ── page ───────────────────────────────────────────────────────────────────────────────────────

function Page() {
  const [fleet, dispatch] = useReducer(reduce, seed);
  useEffect(() => {
    const t = setInterval(() => dispatch({ t: "tick" }), 1000);
    return () => clearInterval(t);
  }, []);

  // The cockpit target — local pin, resolved live against the real bridge. Chips are REAL.
  const [selector, setSelector] = useState<TargetSelector>("");
  const { sessions } = useTarget(selector);

  const pin = (sel: TargetSelector, why: string) => {
    setSelector(sel);
    dispatch({ t: "note", actor: "you", text: `pin target → ${selectorLabel(sel) || "auto"} (${why})` });
  };

  const [ledgerOpen, setLedgerOpen] = useState(false);

  const active = fleet.instances.filter((i) => i.phase !== "dead");
  const killed = fleet.instances.filter((i) => i.phase === "dead");

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [fleet.events.length, ledgerOpen]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto max-w-5xl px-4 py-5">
        {/* cockpit header — which Revit → which project → which family. This row IS the target. */}
        <div
          className="flex items-center gap-2 pb-3"
          style={{ borderBottom: "0.5px solid var(--line-2)" }}
        >
          <Mono size={9}>TARGET</Mono>
          <TargetChip
            selector={selector}
            sessions={sessions}
            onPin={(sel) => pin(sel, "chip")}
            consumerLabel="cockpit"
          />
          <RvtChip target={selector} />
          <RfaChip target={selector} />
          <span className="ml-auto">
            <Mono size={8}>
              {sessions.length} live session{sessions.length === 1 ? "" : "s"} on the bridge
            </Mono>
          </span>
        </div>

        <div className="flex" style={{ minHeight: "70vh" }}>
          {/* fleet */}
          <div className="min-w-0 flex-1 pr-4 pt-3" style={{ borderRight: "0.5px solid var(--line-2)" }}>
            <div className="pb-1.5">
              <Mono size={10}>FLEET</Mono>
            </div>
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <tbody>
                {sessions.map((s) => (
                  <LiveRow
                    key={s.sessionId}
                    s={s}
                    all={sessions}
                    pinned={selector !== "" && selector === mintSelector(s, sessions)}
                    onPin={pin}
                  />
                ))}
                {active.map((i) => (
                  <FleetRow
                    key={i.id}
                    i={i}
                    now={fleet.nowMs}
                    pinnedSelector={selector}
                    dispatch={dispatch}
                    onPin={pin}
                  />
                ))}
              </tbody>
            </table>

            {/* declare a new world */}
            <div className="mt-3 flex items-center gap-2">
              <Mono size={10}>declare a new world:</Mono>
              {YEARS.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => dispatch({ t: "start", year: y })}
                  className="tele flex-1 py-1"
                  style={{
                    fontSize: 10, borderRadius: 2, cursor: "pointer",
                    border: "0.5px dashed var(--line-2)", color: "var(--muted-foreground)",
                  }}
                >
                  + 20{y}
                </button>
              ))}
            </div>

            {/* killed */}
            {killed.length ? (
              <div className="mt-5">
                <div className="pb-1.5">
                  <Mono size={10}>KILLED</Mono>
                </div>
                <table className="w-full" style={{ borderCollapse: "collapse", opacity: 0.55 }}>
                  <tbody>
                    {killed.map((i) => (
                      <tr key={i.id} style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                        <td className="py-1 pr-3" style={{ width: 8 }}>
                          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, border: "1px solid var(--muted-foreground)" }} />
                        </td>
                        <td className="py-1 pr-4">
                          <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{i.id}</span>{" "}
                          <Mono size={9}>20{i.year} · was pid {i.pid}</Mono>
                        </td>
                        <td className="py-1 pr-4">
                          <Mono size={9}>died {i.diedAtMs ? age(i.diedAtMs, fleet.nowMs) : "?"} ago</Mono>
                        </td>
                        <td className="py-1 text-right">
                          <Btn onClick={() => dispatch({ t: "restart", id: i.id })}>start again</Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {/* ledger — collapsible to a 24px rail; the cockpit favors the fleet */}
          {ledgerOpen ? (
            <div className="flex w-72 flex-col pl-4 pt-3">
              <div className="flex items-baseline justify-between pb-1.5">
                <Mono size={10}>LEDGER — every actor, one log</Mono>
                <button
                  type="button"
                  onClick={() => setLedgerOpen(false)}
                  className="tele cursor-pointer px-1"
                  style={{ fontSize: 9, borderRadius: 2, border: "0.5px solid var(--line-2)", color: "var(--muted-foreground)" }}
                >
                  ›
                </button>
              </div>
              <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: "74vh" }}>
                {fleet.events.map((e, idx) => (
                  <div key={idx} className="py-1" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                    <Mono size={9} color={e.actor === "pea" ? "var(--cat-kiln)" : e.actor === "bridge" ? "var(--pe-blue)" : "var(--foreground)"}>
                      {e.actor}
                    </Mono>{" "}
                    <span style={{ fontSize: 11, color: "var(--foreground)" }}>{e.text}</span>{" "}
                    <Mono size={8}>{age(e.atMs, fleet.nowMs)} ago</Mono>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setLedgerOpen(true)}
              title="open the ledger"
              className="ml-2 mt-3 flex cursor-pointer flex-col items-center gap-2 py-2"
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
                LEDGER · {fleet.events.length}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A REAL bridge session, rendered as a fleet row. Pinning it rewires the header chips live. */
function LiveRow({
  s,
  all,
  pinned,
  onPin,
}: {
  s: SessionFacts;
  all: SessionFacts[];
  pinned: boolean;
  onPin: (sel: TargetSelector, why: string) => void;
}) {
  const sel = mintSelector(s, all);
  return (
    <tr
      style={{
        borderTop: "0.5px solid var(--line-soft)",
        background: pinned ? "color-mix(in srgb, var(--pe-blue) 6%, transparent)" : undefined,
      }}
    >
      <td className="py-1.5 pr-3" style={{ width: 8 }}>
        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "var(--pe-blue)" }} />
      </td>
      <td className="py-1.5 pr-4">
        <div style={{ fontSize: 12, color: "var(--foreground)" }}>{sessionLabel(s)}</div>
        <Mono size={9}>
          {s.lane} · pid {s.processId} · {sel}
        </Mono>
      </td>
      <td className="py-1.5 pr-4">
        <Mono size={10} color="var(--pe-blue)">LIVE</Mono>{" "}
        <Mono size={8} color="var(--pe-blue)">real</Mono>
      </td>
      <td className="py-1.5 pr-4">
        <Mono size={9}>
          {s.activeDocumentTitle ?? "—"}
          {s.openDocumentCount > 1 ? ` +${s.openDocumentCount - 1}` : ""}
        </Mono>
      </td>
      <td className="py-1.5 pr-4 text-right">
        <Mono size={9}>{s.observedAtUnixMs ? `seen ${age(s.observedAtUnixMs, Date.now())} ago` : "on the bridge"}</Mono>
      </td>
      <td className="py-1.5 text-right" style={{ whiteSpace: "nowrap" }}>
        {pinned ? (
          <Mono size={9} color="var(--pe-blue)">◉ target</Mono>
        ) : (
          <Btn accent onClick={() => onPin(sel, sessionLabel(s))}>pin</Btn>
        )}
      </td>
    </tr>
  );
}

function FleetRow({
  i,
  now,
  pinnedSelector,
  dispatch,
  onPin,
}: {
  i: Inst;
  now: number;
  pinnedSelector: TargetSelector;
  dispatch: React.Dispatch<Act>;
  onPin: (sel: TargetSelector, why: string) => void;
}) {
  // Fabricated selector for mock rows — pinning one dangles honestly (chip shows no-match).
  const mockSel: TargetSelector = i.kind === "sandbox" ? `sandbox:${i.id}` : "rrd";
  const pinned = pinnedSelector !== "" && pinnedSelector === mockSel;
  return (
    <tr
      style={{
        borderTop: "0.5px solid var(--line-soft)",
        opacity: i.phase === "stopping" ? 0.5 : 1,
        background: pinned ? "color-mix(in srgb, var(--pe-blue) 6%, transparent)" : undefined,
      }}
    >
      <td className="py-1.5 pr-3" style={{ width: 8 }}>
        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: PHASE_COLOR[i.phase] }} />
      </td>
      <td className="py-1.5 pr-4">
        <div style={{ fontSize: 12, color: "var(--foreground)" }}>
          {i.kind === "rrd" ? "your Revit (rrd)" : i.kind === "installed" ? "your Revit" : i.id}
        </div>
        <Mono size={9}>
          20{i.year} · {i.kind} · pid {i.pid} · mock
        </Mono>
      </td>
      <td className="py-1.5 pr-4">
        <Mono size={10} color={PHASE_COLOR[i.phase]}>
          {i.phase.toUpperCase()}
          {i.phase === "booting" ? ` ${Math.round((i.bootProgress ?? 0) * 100)}%` : ""}
        </Mono>
      </td>
      <td className="py-1.5 pr-4">
        <Mono size={9}>{i.docs.length ? i.docs.join(", ") : "—"}</Mono>
      </td>
      <td className="py-1.5 pr-4 text-right">
        <Mono size={9}>seen {age(i.observedAtMs, now)} ago</Mono>
      </td>
      <td className="py-1.5 text-right" style={{ whiteSpace: "nowrap" }}>
        {pinned ? (
          <Mono size={9} color="var(--pe-blue)">◉ target</Mono>
        ) : i.phase === "live" || i.phase === "unresponsive" ? (
          <Btn accent onClick={() => onPin(mockSel, `${i.id} — mock, will dangle`)}>pin</Btn>
        ) : null}
        {i.kind === "sandbox" && i.phase !== "stopping" ? (
          <>
            <Btn onClick={() => dispatch({ t: "restart", id: i.id })}>restart</Btn>
            <Btn danger={i.phase === "unresponsive"} onClick={() => dispatch({ t: "stop", id: i.id, force: i.phase === "unresponsive" })}>
              {i.phase === "unresponsive" ? "force stop" : "stop"}
            </Btn>
          </>
        ) : null}
      </td>
    </tr>
  );
}
