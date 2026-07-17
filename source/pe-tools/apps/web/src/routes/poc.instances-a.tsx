import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useReducer, useRef, useState } from "react";

/* ------------------------------------------------------------------------------------------------
 * PROTOTYPE — poc/instances-a. Throwaway. Concept A: "THE LIBRARY".
 * Radical inversion of the fleet page: documents first, sessions are carriers.
 * Clicking a closed doc declares the world (boots an instance if needed) and queues the open.
 * Open .rvt expands its loaded families inline. Idle instances demoted to a thin bottom strip.
 * Mock in-memory reducer + 1s tick; no host calls. Delete me when promoted.
 * ---------------------------------------------------------------------------------------------- */

export const Route = createFileRoute("/poc/instances-a")({ component: Page });

// ── mock library ────────────────────────────────────────────────────────────────────────────────

type Phase = "booting" | "live" | "stopping" | "dead";
type DocKind = "rvt" | "rfa";

interface Inst {
  id: string;
  year: number;
  pid?: number;
  phase: Phase;
  bootProgress?: number;
}

interface Fam {
  name: string;
  category: string;
  excluded?: boolean; // tags/annotations — shown greyed, not hidden
}

interface Doc {
  name: string;
  kind: DocKind;
  year: number;
  lastOpenedMs: number; // last-opened, relative to T0
  openIn?: string; // instance id when open
  pendingIn?: string; // instance id it's queued to open in (while that instance boots)
  families?: Fam[]; // only for .rvt
}

interface Ev {
  atMs: number;
  actor: "you" | "pea" | "bridge";
  text: string;
}

interface World {
  nowMs: number;
  docs: Doc[];
  instances: Inst[];
  events: Ev[];
}

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const HR = 3_600_000;
const DAY = 86_400_000;

const TOWER_FAMS: Fam[] = [
  { name: "VAV_Parallel_FanPowered", category: "Mechanical Equipment" },
  { name: "Duct_Transition_RectRound", category: "Duct Fittings" },
  { name: "AHU_RTU_25Ton", category: "Mechanical Equipment" },
  { name: "Grille_Return_24x24", category: "Air Terminals" },
  { name: "Pipe_Tee_Grooved", category: "Pipe Fittings" },
  { name: "Pump_Inline_Circulator", category: "Mechanical Equipment" },
  { name: "Tag_Duct_Size", category: "Duct Tags", excluded: true },
  { name: "Tag_Equipment_Mark", category: "Mechanical Equipment Tags", excluded: true },
];

const CHILLER_FAMS: Fam[] = [
  { name: "Chiller_AirCooled_400Ton", category: "Mechanical Equipment" },
  { name: "CoolingTower_Crossflow", category: "Mechanical Equipment" },
  { name: "Valve_Butterfly_Lug", category: "Pipe Accessories" },
  { name: "Pipe_Elbow_Welded", category: "Pipe Fittings" },
  { name: "Sensor_Temp_Immersion", category: "Specialty Equipment" },
  { name: "Tag_Pipe_System", category: "Pipe Tags", excluded: true },
];

const seed: World = {
  nowMs: T0,
  docs: [
    // 2026
    { name: "Tower_A.rvt", kind: "rvt", year: 26, lastOpenedMs: T0 - 6 * MIN, openIn: "user-rrd", families: TOWER_FAMS },
    { name: "Tower_A_Central_Plant.rvt", kind: "rvt", year: 26, lastOpenedMs: T0 - 3 * HR, families: CHILLER_FAMS },
    { name: "Site_Utilities.rvt", kind: "rvt", year: 26, lastOpenedMs: T0 - 2 * DAY, families: CHILLER_FAMS },
    { name: "AHU_Custom_RTU.rfa", kind: "rfa", year: 26, lastOpenedMs: T0 - 5 * HR },
    // 2025
    { name: "VAV_Box.rfa", kind: "rfa", year: 25, lastOpenedMs: T0 - 9 * MIN, openIn: "sbx-quartz" },
    { name: "Clinic_Renovation_MEP.rvt", kind: "rvt", year: 25, lastOpenedMs: T0 - 26 * HR, families: TOWER_FAMS },
    { name: "FanCoil_4Pipe_Horizontal.rfa", kind: "rfa", year: 25, lastOpenedMs: T0 - 4 * DAY },
    { name: "Pump_EndSuction_Base.rfa", kind: "rfa", year: 25, lastOpenedMs: T0 - 9 * DAY },
    // 2024
    { name: "Warehouse_Retrofit.rvt", kind: "rvt", year: 24, lastOpenedMs: T0 - 12 * DAY, families: CHILLER_FAMS },
    { name: "Diffuser_Linear_Slot.rfa", kind: "rfa", year: 24, lastOpenedMs: T0 - 30 * DAY },
  ],
  instances: [
    { id: "user-rrd", year: 26, pid: 41220, phase: "live" },
    { id: "sbx-quartz", year: 25, pid: 50912, phase: "live" },
    { id: "sbx-basalt", year: 24, pid: 51544, phase: "live" }, // idle — no docs
  ],
  events: [
    { atMs: T0 - 20 * MIN, actor: "you", text: "open Tower_A.rvt in user-rrd" },
    { atMs: T0 - 9 * MIN, actor: "pea", text: "start sbx-quartz (2025) to carry VAV_Box.rfa" },
    { atMs: T0 - 9 * MIN + 40_000, actor: "bridge", text: "sbx-quartz is live (pid 50912)" },
    { atMs: T0 - 8 * MIN, actor: "pea", text: "VAV_Box.rfa opened in sbx-quartz" },
    { atMs: T0 - 2 * MIN, actor: "you", text: "start sbx-basalt (2024) — idle, no doc yet" },
  ],
};

type Act =
  | { t: "tick" }
  | { t: "openDoc"; name: string }
  | { t: "closeDoc"; name: string }
  | { t: "openFamily"; doc: string; family: string }
  | { t: "stopInstance"; id: string };

let mint = 0;
const NAMES = ["copper", "slate", "amber", "chert", "onyx", "tuff"];

function reduce(w: World, a: Act): World {
  const now = a.t === "tick" ? w.nowMs + 1000 : w.nowMs;
  const ev = (actor: Ev["actor"], text: string): Ev => ({ atMs: now, actor, text });

  if (a.t === "tick") {
    const events: Ev[] = [];
    let instances = w.instances.map((i) => {
      if (i.phase === "booting") {
        const p = (i.bootProgress ?? 0) + 0.012 + Math.abs(Math.sin(i.pid ?? 1)) * 0.006;
        if (p >= 1) {
          events.push(ev("bridge", `${i.id} is live (pid ${i.pid})`));
          return { ...i, phase: "live" as Phase, bootProgress: undefined };
        }
        return { ...i, bootProgress: p };
      }
      if (i.phase === "stopping") return { ...i, phase: "dead" as Phase };
      return i;
    });
    // land queued docs on instances that just went live
    const docs = w.docs.map((d) => {
      if (!d.pendingIn) return d;
      const carrier = instances.find((i) => i.id === d.pendingIn);
      if (carrier?.phase === "live") {
        events.push(ev("pea", `${d.name} opened in ${carrier.id}`));
        return { ...d, pendingIn: undefined, openIn: carrier.id, lastOpenedMs: now };
      }
      return d;
    });
    instances = instances.filter((i) => i.phase !== "dead");
    return { nowMs: now, docs, instances, events: [...w.events, ...events] };
  }

  if (a.t === "openDoc") {
    const doc = w.docs.find((d) => d.name === a.name);
    if (!doc || doc.openIn || doc.pendingIn) return w;
    // right-year live carrier already exists → open here
    const carrier = w.instances.find((i) => i.year === doc.year && i.phase === "live");
    if (carrier) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, openIn: carrier.id, lastOpenedMs: now } : d)),
        events: [...w.events, ev("you", `open ${a.name} in ${carrier.id} (20${doc.year} already live)`)],
      };
    }
    // reuse a booting right-year instance if one is on the way
    const incoming = w.instances.find((i) => i.year === doc.year && i.phase === "booting");
    if (incoming) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: incoming.id } : d)),
        events: [...w.events, ev("you", `queue ${a.name} → ${incoming.id} (already booting)`)],
      };
    }
    // no world of that year → declare one and queue the open
    const id = `sbx-${NAMES[mint++ % NAMES.length]}`;
    return {
      ...w,
      instances: [...w.instances, { id, year: doc.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0 }],
      docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: id } : d)),
      events: [...w.events, ev("you", `open ${a.name} — no 20${doc.year} world; declaring ${id} + queueing open`)],
    };
  }

  if (a.t === "closeDoc") {
    const doc = w.docs.find((d) => d.name === a.name);
    if (!doc?.openIn) return w;
    return {
      ...w,
      docs: w.docs.map((d) => (d.name === a.name ? { ...d, openIn: undefined, lastOpenedMs: now } : d)),
      events: [...w.events, ev("you", `close ${a.name} (was in ${doc.openIn})`)],
    };
  }

  if (a.t === "openFamily")
    return {
      ...w,
      events: [...w.events, ev("you", `open ${a.family} in family editor (from ${a.doc})`)],
    };

  if (a.t === "stopInstance")
    return {
      ...w,
      instances: w.instances.map((i) => (i.id === a.id ? { ...i, phase: "stopping" } : i)),
      events: [...w.events, ev("you", `stop idle world ${a.id}`)],
    };

  return w;
}

// ── shared bits ─────────────────────────────────────────────────────────────────────────────────

const YEARS = [26, 25, 24];

function age(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
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

// ── page ────────────────────────────────────────────────────────────────────────────────────────

function Page() {
  const [world, dispatch] = useReducer(reduce, seed);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => dispatch({ t: "tick" }), 1000);
    return () => clearInterval(t);
  }, []);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [world.events.length]);

  const carriedIds = new Set(
    world.docs.flatMap((d) => [d.openIn, d.pendingIn]).filter((x): x is string => !!x),
  );
  const idle = world.instances.filter((i) => !carriedIds.has(i.id) && i.phase !== "dead");

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto flex max-w-5xl gap-0 px-4 py-5" style={{ minHeight: "80vh" }}>
        {/* library */}
        <div className="flex-1 pr-4" style={{ borderRight: "0.5px solid var(--line-2)" }}>
          <div className="pb-1.5">
            <Mono size={10}>THE LIBRARY — documents first, sessions are carriers</Mono>
          </div>

          {YEARS.map((y) => {
            const docs = world.docs.filter((d) => d.year === y);
            if (!docs.length) return null;
            return (
              <div key={y} className="mt-3">
                <div className="flex items-baseline gap-2 pb-1">
                  <Mono size={9} color="var(--foreground)">REVIT 20{y}</Mono>
                  <Mono size={8}>{docs.length} doc{docs.length === 1 ? "" : "s"}</Mono>
                </div>
                <div style={{ borderTop: "0.5px solid var(--line-2)" }}>
                  {docs.map((d) => (
                    <DocRow
                      key={d.name}
                      d={d}
                      world={world}
                      expanded={expanded === d.name}
                      onToggleExpand={() => setExpanded(expanded === d.name ? null : d.name)}
                      dispatch={dispatch}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* idle worlds strip */}
          <div className="mt-4">
            <div className="pb-1">
              <Mono size={9}>IDLE WORLDS — live, carrying nothing</Mono>
            </div>
            {idle.length ? (
              <div className="flex flex-wrap gap-2">
                {idle.map((i) => (
                  <div
                    key={i.id}
                    className="flex items-center px-2 py-1"
                    style={{ border: "0.5px solid var(--line-soft)", borderRadius: 2, opacity: i.phase === "stopping" ? 0.5 : 1 }}
                  >
                    <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 3, background: i.phase === "live" ? "var(--pe-blue)" : "var(--muted-foreground)", marginRight: 6 }} />
                    <Mono size={9} color="var(--foreground)">{i.id}</Mono>
                    <Mono size={8}>&nbsp;· 20{i.year} · pid {i.pid}</Mono>
                    {i.phase === "live" ? <Btn onClick={() => dispatch({ t: "stopInstance", id: i.id })}>stop</Btn> : <Mono size={8}>&nbsp;stopping…</Mono>}
                  </div>
                ))}
              </div>
            ) : (
              <Mono size={9}>none — every live world is carrying a document</Mono>
            )}
          </div>
        </div>

        {/* ledger */}
        <div ref={logRef} className="w-64 overflow-y-auto pl-4" style={{ maxHeight: "88vh" }}>
          <div className="pb-1.5">
            <Mono size={10}>LEDGER</Mono>
          </div>
          {world.events.map((e, idx) => (
            <div key={idx} className="py-1" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
              <Mono size={9} color={e.actor === "pea" ? "var(--cat-kiln)" : e.actor === "bridge" ? "var(--pe-blue)" : "var(--foreground)"}>
                {e.actor}
              </Mono>
              <div style={{ fontSize: 10.5, color: "var(--foreground)" }}>{e.text}</div>
              <Mono size={8}>{age(e.atMs, world.nowMs)} ago</Mono>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── document row ────────────────────────────────────────────────────────────────────────────────

function DocRow({
  d, world, expanded, onToggleExpand, dispatch,
}: {
  d: Doc;
  world: World;
  expanded: boolean;
  onToggleExpand: () => void;
  dispatch: React.Dispatch<Act>;
}) {
  const carrier = d.openIn ? world.instances.find((i) => i.id === d.openIn) : undefined;
  const pending = d.pendingIn ? world.instances.find((i) => i.id === d.pendingIn) : undefined;
  const isOpen = !!carrier;
  const isRvt = d.kind === "rvt";

  const onClick = () => {
    if (pending) return; // in flight — nothing to do
    if (isOpen && isRvt) onToggleExpand();
    else if (!isOpen) dispatch({ t: "openDoc", name: d.name });
  };

  return (
    <div style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
      <div
        className="flex items-center gap-2 py-1.5 pr-1"
        style={{ cursor: pending ? "default" : "pointer" }}
        onClick={onClick}
      >
        {/* kind badge — .rvt filled square, .rfa outlined diamond */}
        {isRvt ? (
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 1, background: isOpen ? "var(--pe-blue)" : "var(--line-2)", flexShrink: 0 }} />
        ) : (
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 1, border: `0.5px solid ${isOpen ? "var(--cat-kiln)" : "var(--muted-foreground)"}`, background: isOpen ? "var(--cat-kiln)" : "transparent", transform: "rotate(45deg)", flexShrink: 0 }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span style={{ fontSize: 12.5, color: "var(--foreground)", opacity: isOpen || pending ? 1 : 0.75 }}>
              {d.name}
            </span>
            <Mono size={8}>{d.kind === "rvt" ? "project" : "family"}</Mono>
            {isOpen && isRvt ? <Mono size={8} color="var(--pe-blue)">{expanded ? "▾ families" : "▸ families"}</Mono> : null}
          </div>
          {/* carrier tag — sessions are carriers, not subjects */}
          {carrier ? (
            <Mono size={8} color="var(--pe-blue)">
              ● live in {carrier.id} · pid {carrier.pid} · 20{carrier.year}
            </Mono>
          ) : pending ? (
            <Mono size={8} color="var(--cat-kiln)">
              ◐ declaring 20{d.year} world {pending.id} · booting {Math.round((pending.bootProgress ?? 0) * 100)}% · open queued
            </Mono>
          ) : (
            <Mono size={8}>last opened {age(d.lastOpenedMs, world.nowMs)} ago{world.instances.some((i) => i.year === d.year && i.phase === "live") ? " · a 20" + d.year + " world is live — opens instantly" : " · click boots a 20" + d.year + " world"}</Mono>
          )}
        </div>
        {carrier ? <Btn onClick={() => dispatch({ t: "closeDoc", name: d.name })}>close</Btn> : null}
      </div>

      {/* boot progress bar, inline under the document */}
      {pending ? (
        <div className="mb-1.5 ml-4 mr-1" style={{ height: 2, background: "var(--line-soft)", borderRadius: 2 }}>
          <div style={{ height: 2, width: `${Math.round((pending.bootProgress ?? 0) * 100)}%`, background: "var(--cat-kiln)", borderRadius: 2, transition: "width 0.9s linear" }} />
        </div>
      ) : null}

      {/* loaded families sub-tree */}
      {isOpen && isRvt && expanded && d.families ? (
        <div className="mb-1.5 ml-4" style={{ borderLeft: "0.5px solid var(--line-2)" }}>
          {d.families.filter((f) => !f.excluded).map((f) => (
            <div
              key={f.name}
              className="flex items-baseline gap-2 py-1 pl-2"
              style={{ cursor: "pointer", borderBottom: "0.5px solid var(--line-soft)" }}
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ t: "openFamily", doc: d.name, family: f.name });
              }}
            >
              <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 1, border: "0.5px solid var(--cat-kiln)", transform: "rotate(45deg)", flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: "var(--foreground)" }}>{f.name}</span>
              <Mono size={8}>{f.category}</Mono>
              <Mono size={8} color="var(--pe-blue)">open in editor →</Mono>
            </div>
          ))}
          {d.families.some((f) => f.excluded) ? (
            <div className="py-1 pl-2">
              <Mono size={8}>not editable here — annotation-side families:</Mono>
              {d.families.filter((f) => f.excluded).map((f) => (
                <div key={f.name} className="flex items-baseline gap-2 py-0.5" style={{ opacity: 0.45 }}>
                  <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 1, border: "0.5px solid var(--muted-foreground)", transform: "rotate(45deg)", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{f.name}</span>
                  <Mono size={8}>{f.category}</Mono>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
