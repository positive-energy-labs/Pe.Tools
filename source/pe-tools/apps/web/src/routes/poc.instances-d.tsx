import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useReducer, useRef, useState } from "react";

/* ------------------------------------------------------------------------------------------------
 * PROTOTYPE — poc/instances-d. Throwaway. Concept D: "UNIFIED PICKER".
 * Consolidation of A ("the library") + C ("cockpit"). Sessions are ENTIRELY derived from the
 * document selection — never a picking step — but stay intuitively visible as readouts, a
 * ledger, and a demoted WORLDS ops strip. One two-layer selector component (physical files →
 * loaded families) mounted twice: hero (rvt+rfa, families) and a plugin-shaped second mount
 * (rvt only, no families) sharing the same mock fleet. No host calls. Delete me when promoted.
 * ---------------------------------------------------------------------------------------------- */

export const Route = createFileRoute("/poc/instances-d")({ component: Page });

// ── mock world ──────────────────────────────────────────────────────────────────────────────────

type Phase = "booting" | "live" | "stopping" | "dead";
type DocKind = "rvt" | "rfa";

interface Inst {
  id: string;
  year: number;
  pid?: number;
  phase: Phase;
  bootProgress?: number;
  diedAtMs?: number;
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
  lastOpenedMs: number;
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
  { name: "Grille_Supply_12x12", category: "Air Terminals" },
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
    { id: "sbx-basalt", year: 25, pid: 51544, phase: "live" }, // idle 2025 — an escape-hatch destination
    { id: "sbx-ash", year: 24, pid: 47120, phase: "dead", diedAtMs: T0 - 14 * MIN },
  ],
  events: [
    { atMs: T0 - 20 * MIN, actor: "you", text: "open Tower_A.rvt → derived carrier user-rrd" },
    { atMs: T0 - 14 * MIN, actor: "pea", text: "stop sbx-ash (2024) — idle too long" },
    { atMs: T0 - 9 * MIN, actor: "pea", text: "declare sbx-quartz (2025) to carry VAV_Box.rfa" },
    { atMs: T0 - 9 * MIN + 40_000, actor: "bridge", text: "sbx-quartz is live (pid 50912)" },
    { atMs: T0 - 8 * MIN, actor: "pea", text: "VAV_Box.rfa opened in sbx-quartz" },
    { atMs: T0 - 2 * MIN, actor: "you", text: "start sbx-basalt (2025) — idle, no doc yet" },
  ],
};

type Act =
  | { t: "tick" }
  | { t: "openDoc"; name: string; via: string }
  | { t: "startWorld"; year: number; via: string } // docless declare — boots an idle world of that year
  | { t: "recarry"; name: string; to: string | "new"; via: string }
  | { t: "stopInstance"; id: string }
  | { t: "restartInstance"; id: string }
  | { t: "note"; actor: Ev["actor"]; text: string };

let mint = 0;
const NAMES = ["copper", "slate", "amber", "chert", "onyx", "tuff"];

function reduce(w: World, a: Act): World {
  const now = a.t === "tick" ? w.nowMs + 1000 : w.nowMs;
  const ev = (actor: Ev["actor"], text: string): Ev => ({ atMs: now, actor, text });

  if (a.t === "tick") {
    const events: Ev[] = [];
    const instances = w.instances.map((i) => {
      if (i.phase === "booting") {
        const p = (i.bootProgress ?? 0) + 0.012 + Math.abs(Math.sin(i.pid ?? 1)) * 0.006;
        if (p >= 1) {
          events.push(ev("bridge", `${i.id} is live (pid ${i.pid})`));
          return { ...i, phase: "live" as Phase, bootProgress: undefined };
        }
        return { ...i, bootProgress: p };
      }
      if (i.phase === "stopping") return { ...i, phase: "dead" as Phase, diedAtMs: now };
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
    return { nowMs: now, docs, instances, events: [...w.events, ...events] };
  }

  if (a.t === "openDoc") {
    const doc = w.docs.find((d) => d.name === a.name);
    if (!doc || doc.openIn || doc.pendingIn) return w;
    // right-year live carrier already exists → adopt it, open instantly
    const carrier = w.instances.find((i) => i.year === doc.year && i.phase === "live");
    if (carrier) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, openIn: carrier.id, lastOpenedMs: now } : d)),
        events: [...w.events, ev("you", `open ${a.name} → derived carrier ${carrier.id} (20${doc.year} already live) · via ${a.via}`)],
      };
    }
    // a right-year world is on the way → queue onto it
    const incoming = w.instances.find((i) => i.year === doc.year && i.phase === "booting");
    if (incoming) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: incoming.id } : d)),
        events: [...w.events, ev("you", `open ${a.name} → queued on ${incoming.id} (already booting) · via ${a.via}`)],
      };
    }
    // no world of that year → declare one and queue the open
    const id = `sbx-${NAMES[mint++ % NAMES.length]}`;
    return {
      ...w,
      instances: [...w.instances, { id, year: doc.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0 }],
      docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: id } : d)),
      events: [...w.events, ev("you", `open ${a.name} → no 20${doc.year} world; declaring ${id} + queueing open · via ${a.via}`)],
    };
  }

  if (a.t === "startWorld") {
    // docless declare — no-op if a world of that year is already live or booting
    if (w.instances.some((i) => i.year === a.year && (i.phase === "live" || i.phase === "booting"))) return w;
    const id = `sbx-${NAMES[mint++ % NAMES.length]}`;
    return {
      ...w,
      instances: [...w.instances, { id, year: a.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0 }],
      events: [...w.events, ev("you", `start 20${a.year} world ${id} — no document, idle on arrival · via ${a.via}`)],
    };
  }

  if (a.t === "recarry") {
    const doc = w.docs.find((d) => d.name === a.name);
    if (!doc?.openIn) return w;
    if (a.to === "new") {
      const id = `sbx-${NAMES[mint++ % NAMES.length]}`;
      return {
        ...w,
        instances: [...w.instances, { id, year: doc.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0 }],
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, openIn: undefined, pendingIn: id } : d)),
        events: [...w.events, ev("you", `re-carry ${a.name}: ${doc.openIn} → new world ${id} (booting) · via ${a.via}`)],
      };
    }
    return {
      ...w,
      docs: w.docs.map((d) => (d.name === a.name ? { ...d, openIn: a.to as string, lastOpenedMs: now } : d)),
      events: [...w.events, ev("you", `re-carry ${a.name}: ${doc.openIn} → ${a.to} · via ${a.via}`)],
    };
  }

  if (a.t === "stopInstance") {
    const closed = w.docs.filter((d) => d.openIn === a.id || d.pendingIn === a.id);
    return {
      ...w,
      instances: w.instances.map((i) => (i.id === a.id ? { ...i, phase: "stopping" } : i)),
      docs: w.docs.map((d) =>
        d.openIn === a.id || d.pendingIn === a.id ? { ...d, openIn: undefined, pendingIn: undefined } : d,
      ),
      events: [
        ...w.events,
        ev("you", `stop ${a.id}${closed.length ? ` — closes ${closed.map((d) => d.name).join(", ")}` : ""}`),
      ],
    };
  }

  if (a.t === "restartInstance")
    return {
      ...w,
      instances: w.instances.map((i) =>
        i.id === a.id ? { ...i, phase: "booting", bootProgress: 0, diedAtMs: undefined } : i,
      ),
      events: [...w.events, ev("you", `restart ${a.id}`)],
    };

  if (a.t === "note") return { ...w, events: [...w.events, ev(a.actor, a.text)] };

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

// ── the unified two-layer selector — THE component this prototype exists to prove ──────────────

interface Resolved {
  doc: string;
  kind: DocKind;
  year: number;
  family?: string;
  carrier: string;
  pid?: number;
}

function UnifiedPicker({
  accept,
  families,
  label,
  world,
  dispatch,
  onResolve,
}: {
  accept: DocKind[];
  families: boolean;
  label: string;
  world: World;
  dispatch: React.Dispatch<Act>;
  onResolve: (r: Resolved | null) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hatchFor, setHatchFor] = useState<string | null>(null); // doc name whose escape hatch is open
  const [pinnedYears, setPinnedYears] = useState<number[]>([]); // years the user manually expanded

  const docs = world.docs.filter((d) => accept.includes(d.kind));
  const selDoc = selected ? docs.find((d) => d.name === selected) : undefined;
  const carrier = selDoc?.openIn ? world.instances.find((i) => i.id === selDoc.openIn) : undefined;

  // derive the resolved target — the session appears ONLY as derived output
  const complete =
    selDoc && carrier?.phase === "live" && (selDoc.kind === "rfa" || !families || (family && selDoc.families?.some((f) => f.name === family && !f.excluded)));
  const resolved: Resolved | null = complete
    ? { doc: selDoc.name, kind: selDoc.kind, year: selDoc.year, family: families && selDoc.kind === "rvt" ? (family ?? undefined) : undefined, carrier: carrier.id, pid: carrier.pid }
    : null;
  const resolvedKey = resolved ? `${resolved.doc}|${resolved.family ?? ""}|${resolved.carrier}` : "";
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current === resolvedKey) return;
    lastKey.current = resolvedKey;
    onResolve(resolved);
  });

  const pick = (d: Doc) => {
    setHatchFor(null);
    if (d.name !== selected) {
      setSelected(d.name);
      setFamily(null);
      setQuery("");
    }
    if (!d.openIn && !d.pendingIn) dispatch({ t: "openDoc", name: d.name, via: label });
  };

  return (
    <div>
      {YEARS.map((y) => {
        const rows = docs.filter((d) => d.year === y).sort((a, b) => b.lastOpenedMs - a.lastOpenedMs);
        if (!rows.length) return null;
        // ACTIVE-YEAR RULE: a year renders expanded/normal iff it has an open-or-pending doc OR a
        // live/booting world of that year. Rationale: the grey/collapse telegraphs "opening here
        // costs a ~90s boot"; once a world of that year exists (even idle, even still booting),
        // opens are instant-or-queued, so the honest render is expanded and full-strength — the
        // world's existence, not a document, is what changes the cost of the click.
        const active =
          rows.some((d) => d.openIn || d.pendingIn) ||
          world.instances.some((i) => i.year === y && (i.phase === "live" || i.phase === "booting"));
        const expanded = active || pinnedYears.includes(y);
        return (
          <div key={y} className="mt-2" style={{ opacity: active ? 1 : 0.55 }}>
            <div
              className="flex items-baseline gap-2 pb-1"
              style={{ cursor: active ? undefined : "pointer" }}
              onClick={
                active
                  ? undefined
                  : () => setPinnedYears((p) => (p.includes(y) ? p.filter((x) => x !== y) : [...p, y]))
              }
            >
              {!active ? <Mono size={8}>{expanded ? "▾" : "▸"}</Mono> : null}
              <Mono size={9} color={active ? "var(--foreground)" : "var(--muted-foreground)"}>REVIT 20{y}</Mono>
              <Mono size={8}>{rows.length} file{rows.length === 1 ? "" : "s"}</Mono>
              {!active ? (
                <>
                  <Mono size={8}>no 20{y} world — opens cost a boot</Mono>
                  <button
                    type="button"
                    className="tele ml-auto px-1.5 py-0.5"
                    style={{
                      fontSize: 8, borderRadius: 2, cursor: "pointer",
                      border: "0.5px solid var(--line-2)", color: "var(--muted-foreground)",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ t: "startWorld", year: y, via: label });
                    }}
                    title={`boot an idle 20${y} world without opening a document`}
                  >
                    start 20{y}
                  </button>
                </>
              ) : null}
            </div>
            {!expanded ? null : (
            <div style={{ borderTop: "0.5px solid var(--line-2)" }}>
              {rows.map((d) => (
                <PickerRow
                  key={d.name}
                  d={d}
                  world={world}
                  label={label}
                  selected={selected === d.name}
                  pickedFamily={selected === d.name ? family : null}
                  showFamilies={families}
                  query={query}
                  setQuery={setQuery}
                  onPick={() => pick(d)}
                  onPickFamily={(f) => {
                    setFamily(f);
                    dispatch({ t: "note", actor: "you", text: `pick family ${f} in ${d.name} · via ${label}` });
                  }}
                  hatchOpen={hatchFor === d.name}
                  onToggleHatch={() => setHatchFor(hatchFor === d.name ? null : d.name)}
                  dispatch={dispatch}
                />
              ))}
            </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PickerRow({
  d, world, label, selected, pickedFamily, showFamilies, query, setQuery, onPick, onPickFamily, hatchOpen, onToggleHatch, dispatch,
}: {
  d: Doc;
  world: World;
  label: string;
  selected: boolean;
  pickedFamily: string | null;
  showFamilies: boolean;
  query: string;
  setQuery: (q: string) => void;
  onPick: () => void;
  onPickFamily: (f: string) => void;
  hatchOpen: boolean;
  onToggleHatch: () => void;
  dispatch: React.Dispatch<Act>;
}) {
  const carrier = d.openIn ? world.instances.find((i) => i.id === d.openIn) : undefined;
  const pending = d.pendingIn ? world.instances.find((i) => i.id === d.pendingIn) : undefined;
  const isOpen = carrier?.phase === "live";
  const isRvt = d.kind === "rvt";
  const layer2 = selected && isOpen && isRvt && showFamilies && !!d.families;

  // cost telegraph — say what the click will cost BEFORE the click
  const liveRightYear = world.instances.some((i) => i.year === d.year && i.phase === "live");
  const bootingRightYear = world.instances.some((i) => i.year === d.year && i.phase === "booting");
  const telegraph = liveRightYear
    ? `a 20${d.year} world is live — opens instantly`
    : bootingRightYear
      ? `a 20${d.year} world is booting — click queues the open`
      : `click boots a 20${d.year} world (~90s)`;

  // escape hatch destinations — other live right-year worlds
  const otherWorlds = world.instances.filter((i) => i.year === d.year && i.phase === "live" && i.id !== d.openIn);

  const visibleFams = (d.families ?? []).filter(
    (f) => !f.excluded && (f.name + " " + f.category).toLowerCase().includes(query.toLowerCase()),
  );
  const excludedFams = (d.families ?? []).filter((f) => f.excluded);

  return (
    <div
      style={{
        borderBottom: "0.5px solid var(--line-soft)",
        background: selected ? "color-mix(in srgb, var(--pe-blue) 5%, transparent)" : undefined,
      }}
    >
      <div className="flex items-center gap-2 py-1 pr-1" style={{ cursor: "pointer" }} onClick={onPick}>
        {/* extension badge — one combined list, the badge does the distinguishing */}
        <span
          className="font-[var(--font-pe-mono)] px-1"
          style={{
            fontSize: 8, letterSpacing: "0.06em", borderRadius: 2, flexShrink: 0,
            border: `0.5px solid ${isRvt ? "var(--pe-blue)" : "var(--cat-kiln)"}`,
            color: isRvt ? "var(--pe-blue)" : "var(--cat-kiln)",
            opacity: isOpen || pending || selected ? 1 : 0.65,
          }}
        >
          {d.kind}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span style={{ fontSize: 12.5, color: "var(--foreground)", opacity: isOpen || pending || selected ? 1 : 0.75 }}>
              {d.name}
            </span>
            {selected ? <Mono size={8} color="var(--pe-blue)">◉ selected</Mono> : null}
          </div>
          {/* carrier readout — the session as derived output, demoted escape hatch on click */}
          {carrier ? (
            <span style={{ position: "relative" }}>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleHatch();
                }}
                style={{ cursor: "pointer" }}
                title="re-carry this document"
              >
                <Mono size={8} color="var(--muted-foreground)">
                  ● {carrier.id} · pid {carrier.pid} — derived {hatchOpen ? "▴" : "▾"}
                </Mono>
              </span>
              {hatchOpen ? (
                <span
                  className="px-2 py-1.5"
                  style={{
                    position: "absolute", left: 0, top: 16, zIndex: 10, minWidth: 220,
                    display: "block", background: "var(--background)",
                    border: "0.5px solid var(--line-2)", borderRadius: 2,
                    boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="block pb-1">
                    <Mono size={8}>RE-CARRY — sessions stay derived; this is the escape hatch</Mono>
                  </span>
                  {otherWorlds.map((i) => (
                    <span
                      key={i.id}
                      className="block py-0.5"
                      style={{ cursor: "pointer", borderTop: "0.5px solid var(--line-soft)" }}
                      onClick={() => {
                        dispatch({ t: "recarry", name: d.name, to: i.id, via: label });
                        onToggleHatch();
                      }}
                    >
                      <Mono size={9} color="var(--foreground)">→ {i.id}</Mono>
                      <Mono size={8}> · 20{i.year} · pid {i.pid} · live</Mono>
                    </span>
                  ))}
                  {!otherWorlds.length ? (
                    <span className="block py-0.5" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                      <Mono size={8}>no other live 20{d.year} world</Mono>
                    </span>
                  ) : null}
                  <span
                    className="block py-0.5"
                    style={{ cursor: "pointer", borderTop: "0.5px solid var(--line-soft)" }}
                    onClick={() => {
                      dispatch({ t: "recarry", name: d.name, to: "new", via: label });
                      onToggleHatch();
                    }}
                  >
                    <Mono size={9} color="var(--cat-kiln)">+ new 20{d.year} world (~90s)</Mono>
                  </span>
                </span>
              ) : null}
            </span>
          ) : pending ? (
            <Mono size={8} color="var(--cat-kiln)">
              ◐ declaring 20{d.year} world {pending.id} · booting {Math.round((pending.bootProgress ?? 0) * 100)}% · open queued
            </Mono>
          ) : (
            <Mono size={8}>last opened {age(d.lastOpenedMs, world.nowMs)} ago · {telegraph}</Mono>
          )}
        </div>
      </div>

      {/* boot progress bar, inline under the row */}
      {pending ? (
        <div className="mb-1.5 ml-4 mr-1" style={{ height: 2, background: "var(--line-soft)", borderRadius: 2 }}>
          <div style={{ height: 2, width: `${Math.round((pending.bootProgress ?? 0) * 100)}%`, background: "var(--cat-kiln)", borderRadius: 2, transition: "width 0.9s linear" }} />
        </div>
      ) : null}

      {/* layer 2 — loaded families, only when the selection is an open .rvt */}
      {layer2 ? (
        <div className="mb-1.5 ml-4" style={{ borderLeft: "0.5px solid var(--line-2)" }}>
          <div className="py-1 pl-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="filter families — name or category"
              className="tele w-full px-1.5 py-0.5"
              style={{
                fontSize: 10, borderRadius: 2, border: "0.5px solid var(--line-2)",
                background: "transparent", color: "var(--foreground)", outline: "none",
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          {visibleFams.map((f) => (
            <div
              key={f.name}
              className="flex items-baseline gap-2 py-1 pl-2"
              style={{
                cursor: "pointer", borderBottom: "0.5px solid var(--line-soft)",
                background: pickedFamily === f.name ? "color-mix(in srgb, var(--cat-kiln) 8%, transparent)" : undefined,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onPickFamily(f.name);
              }}
            >
              <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 1, border: "0.5px solid var(--cat-kiln)", transform: "rotate(45deg)", flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: "var(--foreground)" }}>{f.name}</span>
              <Mono size={8}>{f.category}</Mono>
              {pickedFamily === f.name ? <Mono size={8} color="var(--cat-kiln)">◉ picked</Mono> : null}
            </div>
          ))}
          {!visibleFams.length ? (
            <div className="py-1 pl-2">
              <Mono size={8}>no family matches “{query}”</Mono>
            </div>
          ) : null}
          {excludedFams.length ? (
            <div className="py-1 pl-2">
              <Mono size={8}>not editable here — annotation-side families:</Mono>
              {excludedFams.map((f) => (
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

// ── page ────────────────────────────────────────────────────────────────────────────────────────

function Page() {
  const [world, dispatch] = useReducer(reduce, seed);
  useEffect(() => {
    const t = setInterval(() => dispatch({ t: "tick" }), 1000);
    return () => clearInterval(t);
  }, []);

  const [heroResolved, setHeroResolved] = useState<Resolved | null>(null);
  const [plugResolved, setPlugResolved] = useState<Resolved | null>(null);

  const [ledgerOpen, setLedgerOpen] = useState(true);
  const [killedOpen, setKilledOpen] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [world.events.length, ledgerOpen]);

  const alive = world.instances.filter((i) => i.phase !== "dead");
  const killed = world.instances.filter((i) => i.phase === "dead");

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto flex max-w-5xl px-3 py-3">
        {/* main column */}
        <div className="min-w-0 flex-1 pr-3" style={{ borderRight: "0.5px solid var(--line-2)" }}>
          <div className="pb-1.5">
            <Mono size={10}>START REVIT & OPEN DOCUMENTS — pick a file; the session is derived</Mono>
          </div>

          {/* hero mount */}
          <UnifiedPicker
            accept={["rvt", "rfa"]}
            families
            label="hero"
            world={world}
            dispatch={dispatch}
            onResolve={setHeroResolved}
          />

          {/* resolved target — session appears only as derived output */}
          <div className="mt-2 px-2 py-1" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
            <Mono size={9} color="var(--foreground)">RESOLVED TARGET&nbsp;&nbsp;</Mono>
            {heroResolved ? (
              <Mono size={9} color="var(--pe-blue)">
                {heroResolved.doc}
                {heroResolved.family ? ` · ${heroResolved.family}` : ""}
                {" · carried by "}{heroResolved.carrier} (pid {heroResolved.pid}) · 20{heroResolved.year}
              </Mono>
            ) : (
              <Mono size={9}>nothing resolved yet — click a file above{" "}
                (an open .rvt still needs a family pick)</Mono>
            )}
          </div>

          {/* second mount — proof of composability */}
          <div className="mt-3 px-2 pb-1.5" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
            <div className="pt-1">
              <Mono size={9} color="var(--cat-kiln)">AS A PLUGIN WOULD MOUNT IT</Mono>
              <Mono size={8}>&nbsp;&nbsp;schedule-grid — rvt only · same component, same fleet, fewer affordances</Mono>
            </div>
            <UnifiedPicker
              accept={["rvt"]}
              families={false}
              label="schedule-grid"
              world={world}
              dispatch={dispatch}
              onResolve={setPlugResolved}
            />
            <div className="mt-1.5">
              <Mono size={8}>
                {plugResolved
                  ? `resolved: ${plugResolved.doc} · carried by ${plugResolved.carrier} · 20${plugResolved.year}`
                  : "unresolved — this plugin only needs an open .rvt"}
              </Mono>
            </div>
          </div>

          {/* WORLDS — demoted ops strip. Sessions are for ops here, never for picking. */}
          <div className="mt-3">
            <div className="pb-1">
              <Mono size={9}>WORLDS — ops only, never a picking step</Mono>
            </div>
            <div style={{ borderTop: "0.5px solid var(--line-2)" }}>
              {alive.map((i) => {
                const carried = world.docs.filter((d) => d.openIn === i.id || d.pendingIn === i.id);
                return (
                  <div key={i.id} className="flex items-center gap-2 py-1" style={{ borderBottom: "0.5px solid var(--line-soft)", opacity: i.phase === "stopping" ? 0.5 : 1 }}>
                    <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 3, background: i.phase === "live" ? "var(--pe-blue)" : i.phase === "booting" ? "var(--cat-kiln)" : "var(--muted-foreground)", flexShrink: 0 }} />
                    <Mono size={9} color="var(--foreground)">{i.id}</Mono>
                    <Mono size={8}>
                      20{i.year} · pid {i.pid} ·{" "}
                      {i.phase === "booting"
                        ? `booting ${Math.round((i.bootProgress ?? 0) * 100)}%`
                        : i.phase === "stopping"
                          ? "stopping…"
                          : carried.length
                            ? `carrying ${carried.map((d) => d.name).join(", ")}`
                            : "idle"}
                    </Mono>
                    <span className="ml-auto" style={{ whiteSpace: "nowrap" }}>
                      {i.phase === "live" ? (
                        <>
                          <Btn onClick={() => dispatch({ t: "restartInstance", id: i.id })}>restart</Btn>
                          <Btn danger onClick={() => dispatch({ t: "stopInstance", id: i.id })}>stop</Btn>
                        </>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
            {/* killed — collapsed to a single count line */}
            {killed.length ? (
              <div className="mt-1">
                <div
                  className="py-1"
                  style={{ cursor: "pointer" }}
                  onClick={() => setKilledOpen(!killedOpen)}
                >
                  <Mono size={8}>
                    {killedOpen ? "▾" : "▸"} {killed.length} killed world{killed.length === 1 ? "" : "s"}
                  </Mono>
                </div>
                {killedOpen
                  ? killed.map((i) => (
                      <div key={i.id} className="flex items-center gap-2 py-1 pl-3" style={{ borderTop: "0.5px solid var(--line-soft)", opacity: 0.55 }}>
                        <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 3, border: "1px solid var(--muted-foreground)", flexShrink: 0 }} />
                        <Mono size={9}>{i.id}</Mono>
                        <Mono size={8}>20{i.year} · was pid {i.pid} · died {i.diedAtMs ? age(i.diedAtMs, world.nowMs) : "?"} ago</Mono>
                        <span className="ml-auto">
                          <Btn onClick={() => dispatch({ t: "restartInstance", id: i.id })}>start again</Btn>
                        </span>
                      </div>
                    ))
                  : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* ledger — collapsible to a 24px rail, default OPEN */}
        {ledgerOpen ? (
          <div className="flex w-56 flex-col pl-3">
            <div className="flex items-baseline justify-between pb-1">
              <Mono size={10}>LEDGER</Mono>
              <button
                type="button"
                onClick={() => setLedgerOpen(false)}
                className="tele cursor-pointer px-1"
                style={{ fontSize: 9, borderRadius: 2, border: "0.5px solid var(--line-2)", color: "var(--muted-foreground)" }}
              >
                ›
              </button>
            </div>
            <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: "84vh" }}>
              {world.events.map((e, idx) => (
                <div key={idx} className="py-1" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                  <Mono size={9} color={e.actor === "pea" ? "var(--cat-kiln)" : e.actor === "bridge" ? "var(--pe-blue)" : "var(--foreground)"}>
                    {e.actor}
                  </Mono>{" "}
                  <span style={{ fontSize: 10.5, color: "var(--foreground)" }}>{e.text}</span>{" "}
                  <Mono size={8}>{age(e.atMs, world.nowMs)} ago</Mono>
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
              width: 24, border: "0.5px solid var(--line-2)", borderRadius: 2,
              background: "transparent", alignSelf: "stretch",
            }}
          >
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--muted-foreground)", writingMode: "vertical-rl" }}
            >
              LEDGER · {world.events.length}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
