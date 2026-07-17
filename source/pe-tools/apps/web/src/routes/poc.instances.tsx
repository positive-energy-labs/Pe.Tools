import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useReducer, useRef } from "react";

/* ------------------------------------------------------------------------------------------------
 * PROTOTYPE — poc/instances. Throwaway. Consolidated winner from the 3-variant round:
 * variant A's fleet table + side ledger, minus the command bar, plus variant C's
 * "declare a new world" year buttons, plus a demoted KILLED section for dead sandboxes.
 * Mock in-memory fleet that ticks; no host calls. Delete me when promoted.
 * ---------------------------------------------------------------------------------------------- */

export const Route = createFileRoute("/poc/instances")({ component: Page });

// ── mock fleet ─────────────────────────────────────────────────────────────────────────────────

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
  | { t: "restart"; id: string };

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

function Btn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tele ml-2 px-1.5 py-0.5"
      style={{
        fontSize: 9, borderRadius: 2, cursor: "pointer",
        border: `0.5px solid ${danger ? "var(--cat-clay)" : "var(--line-2)"}`,
        color: danger ? "var(--cat-clay)" : "var(--muted-foreground)",
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

  const active = fleet.instances.filter((i) => i.phase !== "dead");
  const killed = fleet.instances.filter((i) => i.phase === "dead");

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [fleet.events.length]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto flex max-w-5xl gap-0 px-6 py-8" style={{ minHeight: "80vh" }}>
        {/* fleet */}
        <div className="flex-1 pr-5" style={{ borderRight: "0.5px solid var(--line-2)" }}>
          <div className="pb-2">
            <Mono size={10}>FLEET</Mono>
          </div>
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <tbody>
              {active.map((i) => (
                <FleetRow key={i.id} i={i} now={fleet.nowMs} dispatch={dispatch} />
              ))}
            </tbody>
          </table>

          {/* declare a new world */}
          <div className="mt-4 flex items-center gap-2">
            <Mono size={10}>declare a new world:</Mono>
            {YEARS.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => dispatch({ t: "start", year: y })}
                className="tele flex-1 py-1.5"
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
            <div className="mt-8">
              <div className="pb-2">
                <Mono size={10}>KILLED</Mono>
              </div>
              <table className="w-full" style={{ borderCollapse: "collapse", opacity: 0.55 }}>
                <tbody>
                  {killed.map((i) => (
                    <tr key={i.id} style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                      <td className="py-2 pr-3" style={{ width: 8 }}>
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, border: "1px solid var(--muted-foreground)" }} />
                      </td>
                      <td className="py-2 pr-4">
                        <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>{i.id}</div>
                        <Mono size={9}>20{i.year} · was pid {i.pid}</Mono>
                      </td>
                      <td className="py-2 pr-4">
                        <Mono size={9}>died {i.diedAtMs ? age(i.diedAtMs, fleet.nowMs) : "?"} ago</Mono>
                      </td>
                      <td className="py-2 text-right">
                        <Btn onClick={() => dispatch({ t: "restart", id: i.id })}>start again</Btn>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* ledger */}
        <div ref={logRef} className="w-80 overflow-y-auto pl-5" style={{ maxHeight: "84vh" }}>
          <div className="pb-2">
            <Mono size={10}>LEDGER — every actor, one log</Mono>
          </div>
          {fleet.events.map((e, idx) => (
            <div key={idx} className="py-1.5" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
              <Mono size={9} color={e.actor === "pea" ? "var(--cat-kiln)" : e.actor === "bridge" ? "var(--pe-blue)" : "var(--foreground)"}>
                {e.actor}
              </Mono>
              <div style={{ fontSize: 11, color: "var(--foreground)" }}>{e.text}</div>
              <Mono size={8}>{age(e.atMs, fleet.nowMs)} ago</Mono>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function FleetRow({ i, now, dispatch }: { i: Inst; now: number; dispatch: React.Dispatch<Act> }) {
  return (
    <tr style={{ borderTop: "0.5px solid var(--line-soft)", opacity: i.phase === "stopping" ? 0.5 : 1 }}>
      <td className="py-2 pr-3" style={{ width: 8 }}>
        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: PHASE_COLOR[i.phase] }} />
      </td>
      <td className="py-2 pr-4">
        <div style={{ fontSize: 13, color: "var(--foreground)" }}>
          {i.kind === "rrd" ? "your Revit (rrd)" : i.kind === "installed" ? "your Revit" : i.id}
        </div>
        <Mono size={9}>
          20{i.year} · {i.kind} · pid {i.pid}
        </Mono>
      </td>
      <td className="py-2 pr-4">
        <Mono size={10} color={PHASE_COLOR[i.phase]}>
          {i.phase.toUpperCase()}
          {i.phase === "booting" ? ` ${Math.round((i.bootProgress ?? 0) * 100)}%` : ""}
        </Mono>
      </td>
      <td className="py-2 pr-4">
        <Mono size={9}>{i.docs.length ? i.docs.join(", ") : "—"}</Mono>
      </td>
      <td className="py-2 pr-4 text-right">
        <Mono size={9}>seen {age(i.observedAtMs, now)} ago</Mono>
      </td>
      <td className="py-2 text-right" style={{ whiteSpace: "nowrap" }}>
        {i.kind === "sandbox" && i.phase !== "stopping" ? (
          <>
            <Btn onClick={() => dispatch({ t: "restart", id: i.id })}>restart</Btn>
            <Btn danger={i.phase === "unresponsive"} onClick={() => dispatch({ t: "stop", id: i.id, force: i.phase === "unresponsive" })}>
              {i.phase === "unresponsive" ? "force stop" : "stop"}
            </Btn>
          </>
        ) : i.kind !== "sandbox" ? (
          <Mono size={9}>yours — not managed here</Mono>
        ) : null}
      </td>
    </tr>
  );
}
