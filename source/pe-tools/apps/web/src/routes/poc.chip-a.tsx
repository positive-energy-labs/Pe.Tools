import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useReducer, useRef, useState } from "react";

/* ------------------------------------------------------------------------------------------------
 * PROTOTYPE — poc/chip-a. Throwaway. Concept: "THE BREADCRUMB CHIP".
 * The unified-selector model (instances-d) compressed into ONE plugin-header chip whose face is a
 * path: doc ▸ family · derived-world. Replaces the three older chips (session TargetChip + .rvt
 * chip + .rfa chip). Doc segment → two-layer unified picker; family segment → straight to layer 2;
 * world dot → demoted re-carry popover. Sessions are never picked, only derived. Three fake plugin
 * headers share one mock fleet reducer. No host calls. Delete me when promoted.
 * ---------------------------------------------------------------------------------------------- */

export const Route = createFileRoute("/poc/chip-a")({ component: Page });

// ── mock world (adapted from poc/instances-d) ───────────────────────────────────────────────────

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
  excluded?: boolean; // tags/annotations — greyed, not hidden
}

interface Doc {
  name: string;
  kind: DocKind;
  year: number;
  lastOpenedMs: number;
  openIn?: string;
  pendingIn?: string;
  families?: Fam[];
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
    { name: "Tower_A.rvt", kind: "rvt", year: 26, lastOpenedMs: T0 - 6 * MIN, openIn: "user-rrd", families: TOWER_FAMS },
    { name: "Tower_A_Central_Plant.rvt", kind: "rvt", year: 26, lastOpenedMs: T0 - 3 * HR, families: CHILLER_FAMS },
    { name: "Site_Utilities.rvt", kind: "rvt", year: 26, lastOpenedMs: T0 - 2 * DAY, families: CHILLER_FAMS },
    { name: "AHU_Custom_RTU.rfa", kind: "rfa", year: 26, lastOpenedMs: T0 - 5 * HR },
    { name: "VAV_Box.rfa", kind: "rfa", year: 25, lastOpenedMs: T0 - 9 * MIN, openIn: "sbx-quartz" },
    { name: "Clinic_Renovation_MEP.rvt", kind: "rvt", year: 25, lastOpenedMs: T0 - 26 * HR, families: TOWER_FAMS },
    { name: "FanCoil_4Pipe_Horizontal.rfa", kind: "rfa", year: 25, lastOpenedMs: T0 - 4 * DAY },
    { name: "Warehouse_Retrofit.rvt", kind: "rvt", year: 24, lastOpenedMs: T0 - 12 * DAY, families: CHILLER_FAMS },
    { name: "Diffuser_Linear_Slot.rfa", kind: "rfa", year: 24, lastOpenedMs: T0 - 30 * DAY },
  ],
  instances: [
    { id: "user-rrd", year: 26, pid: 41220, phase: "live" },
    { id: "sbx-quartz", year: 25, pid: 50912, phase: "live" },
    { id: "sbx-basalt", year: 25, pid: 51544, phase: "live" }, // idle 2025 — re-carry destination
    { id: "sbx-ash", year: 24, pid: 47120, phase: "dead", diedAtMs: T0 - 14 * MIN },
  ],
  events: [
    { atMs: T0 - 20 * MIN, actor: "you", text: "open Tower_A.rvt → derived carrier user-rrd" },
    { atMs: T0 - 14 * MIN, actor: "pea", text: "stop sbx-ash (2024) — idle too long" },
    { atMs: T0 - 9 * MIN, actor: "pea", text: "declare sbx-quartz (2025) to carry VAV_Box.rfa" },
    { atMs: T0 - 8 * MIN, actor: "pea", text: "VAV_Box.rfa opened in sbx-quartz" },
  ],
};

type Act =
  | { t: "tick" }
  | { t: "openDoc"; name: string; via: string }
  | { t: "recarry"; name: string; to: string | "new"; via: string }
  | { t: "stopInstance"; id: string }
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
        const p = (i.bootProgress ?? 0) + 0.02 + Math.abs(Math.sin(i.pid ?? 1)) * 0.008;
        if (p >= 1) {
          events.push(ev("bridge", `${i.id} is live (pid ${i.pid})`));
          return { ...i, phase: "live" as Phase, bootProgress: undefined };
        }
        return { ...i, bootProgress: p };
      }
      if (i.phase === "stopping") return { ...i, phase: "dead" as Phase, diedAtMs: now };
      return i;
    });
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
    const carrier = w.instances.find((i) => i.year === doc.year && i.phase === "live");
    if (carrier) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, openIn: carrier.id, lastOpenedMs: now } : d)),
        events: [...w.events, ev("you", `open ${a.name} → derived carrier ${carrier.id} (20${doc.year} live) · via ${a.via}`)],
      };
    }
    const incoming = w.instances.find((i) => i.year === doc.year && i.phase === "booting");
    if (incoming) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: incoming.id } : d)),
        events: [...w.events, ev("you", `open ${a.name} → queued on ${incoming.id} (booting) · via ${a.via}`)],
      };
    }
    const id = `sbx-${NAMES[mint++ % NAMES.length]}`;
    return {
      ...w,
      instances: [...w.instances, { id, year: doc.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0 }],
      docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: id } : d)),
      events: [...w.events, ev("you", `open ${a.name} → no 20${doc.year} world; declaring ${id} + queueing · via ${a.via}`)],
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

// ── THE BREADCRUMB CHIP — the component this prototype exists to prove ──────────────────────────

type Panel = "doc" | "family" | "world" | null;

interface ChipConfig {
  accept: DocKind[];
  families: boolean;
}

function BreadcrumbChip({
  accept,
  families,
  label,
  world,
  dispatch,
  initialDoc,
  initialFamily,
}: ChipConfig & {
  label: string;
  world: World;
  dispatch: React.Dispatch<Act>;
  initialDoc?: string;
  initialFamily?: string;
}) {
  const [docName, setDocName] = useState<string | null>(initialDoc ?? null);
  const [famName, setFamName] = useState<string | null>(initialFamily ?? null);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panel) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPanel(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [panel]);

  const docs = world.docs.filter((d) => accept.includes(d.kind));
  const doc = docName ? docs.find((d) => d.name === docName) : undefined;
  const carrier = doc?.openIn ? world.instances.find((i) => i.id === doc.openIn) : undefined;
  const pending = doc?.pendingIn ? world.instances.find((i) => i.id === doc.pendingIn) : undefined;
  // stale bindings (carrier stopped underneath us) degrade to unbound doc, keep the name
  const worldLive = carrier?.phase === "live";

  const famLayer = families && doc?.kind === "rvt" && worldLive && !!doc.families;
  const fam = famLayer && famName ? doc.families?.find((f) => f.name === famName && !f.excluded) : undefined;

  const toggle = (p: Panel) => {
    setPanel(panel === p ? null : p);
    setQuery("");
  };

  const pickDoc = (d: Doc) => {
    if (d.name !== docName) {
      setDocName(d.name);
      setFamName(null);
    }
    if (!d.openIn && !d.pendingIn) dispatch({ t: "openDoc", name: d.name, via: label });
    // stay open: watch derivation happen inside the dropdown; family layer appears in place
  };

  const seg = (active: boolean): React.CSSProperties => ({
    cursor: "pointer",
    padding: "0 5px",
    height: "100%",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: active ? "color-mix(in srgb, var(--pe-blue) 6%, transparent)" : "transparent",
  });

  return (
    <div ref={rootRef} className="relative inline-flex" data-chip={label}>
      {/* ── the face: a path ── */}
      <div
        className="tele inline-flex h-6 items-stretch"
        style={{
          fontSize: 11,
          borderRadius: 2,
          border: doc ? "0.5px solid var(--line-2)" : "0.5px dashed var(--line-2)",
          color: "var(--foreground)",
        }}
      >
        {/* DOC segment — or the whole empty chip */}
        <button type="button" onClick={() => toggle("doc")} style={seg(panel === "doc")} data-seg="doc">
          {doc ? (
            <>
              <span
                className="font-[var(--font-pe-mono)]"
                style={{ fontSize: 8, letterSpacing: "0.06em", color: doc.kind === "rvt" ? "var(--pe-blue)" : "var(--cat-kiln)" }}
              >
                {doc.kind}
              </span>
              <span className="max-w-40 truncate">{doc.name}</span>
            </>
          ) : (
            <span style={{ color: "var(--muted-foreground)" }}>pick a document…</span>
          )}
        </button>

        {/* FAMILY segment — only when the config wants it and an open .rvt is bound */}
        {famLayer ? (
          <>
            <span style={{ alignSelf: "center", fontSize: 9, color: "var(--muted-foreground)", padding: "0 1px" }}>▸</span>
            <button type="button" onClick={() => toggle("family")} style={seg(panel === "family")} data-seg="family">
              {fam ? (
                <span className="max-w-36 truncate">{fam.name}</span>
              ) : (
                <span style={{ color: "var(--muted-foreground)" }}>family…</span>
              )}
            </button>
          </>
        ) : null}

        {/* WORLD segment — derived output, visually quieter, the demoted escape hatch */}
        {carrier || pending ? (
          <>
            <span style={{ alignSelf: "center", fontSize: 9, color: "var(--line-2)", padding: "0 1px" }}>·</span>
            <button type="button" onClick={() => toggle("world")} style={{ ...seg(panel === "world"), opacity: 0.75 }} data-seg="world">
              <span
                style={{
                  display: "inline-block", width: 5, height: 5, borderRadius: 3, flexShrink: 0,
                  background: worldLive ? "var(--pe-blue)" : "var(--cat-kiln)",
                }}
              />
              <Mono size={9}>
                {carrier ? carrier.id : `${pending?.id} ${Math.round((pending?.bootProgress ?? 0) * 100)}%`}
              </Mono>
            </button>
          </>
        ) : null}
      </div>

      {/* ── DOC panel: the two-layer unified picker, compact ── */}
      {panel === "doc" ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-80 px-2 pb-1.5"
          style={{
            border: "0.5px solid var(--line-2)", borderRadius: 2,
            background: "var(--popover, var(--background))",
            boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)",
            maxHeight: 380, overflowY: "auto",
          }}
        >
          {YEARS.map((y) => {
            const rows = docs.filter((d) => d.year === y).sort((a, b) => b.lastOpenedMs - a.lastOpenedMs);
            if (!rows.length) return null;
            return (
              <div key={y} className="mt-1.5">
                <div className="flex items-baseline gap-2 pb-0.5">
                  <Mono size={8} color="var(--foreground)">REVIT 20{y}</Mono>
                  <Mono size={8}>{rows.length}</Mono>
                </div>
                <div style={{ borderTop: "0.5px solid var(--line-2)" }}>
                  {rows.map((d) => (
                    <DocRow
                      key={d.name}
                      d={d}
                      world={world}
                      selected={docName === d.name}
                      onPick={() => pickDoc(d)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
          {/* layer 2 in place — appears indented when the selected doc is an open rvt */}
          {famLayer && doc ? (
            <div className="ml-3 mt-1.5" style={{ borderLeft: "0.5px solid var(--line-2)" }}>
              <div className="pb-0.5 pl-2">
                <Mono size={8} color="var(--cat-kiln)">FAMILIES IN {doc.name.toUpperCase()}</Mono>
              </div>
              <FamilyLayer
                doc={doc}
                query={query}
                setQuery={setQuery}
                picked={famName}
                onPick={(f) => {
                  setFamName(f);
                  setPanel(null);
                  dispatch({ t: "note", actor: "you", text: `pick family ${f} in ${doc.name} · via ${label}` });
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── FAMILY panel: straight to layer 2 ── */}
      {panel === "family" && famLayer && doc ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-72 px-2 py-1"
          style={{
            border: "0.5px solid var(--line-2)", borderRadius: 2,
            background: "var(--popover, var(--background))",
            boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)",
            maxHeight: 320, overflowY: "auto",
          }}
        >
          <div className="pb-0.5">
            <Mono size={8}>LOADED FAMILIES — {doc.name}</Mono>
          </div>
          <FamilyLayer
            doc={doc}
            query={query}
            setQuery={setQuery}
            picked={famName}
            onPick={(f) => {
              setFamName(f);
              setPanel(null);
              dispatch({ t: "note", actor: "you", text: `pick family ${f} in ${doc.name} · via ${label}` });
            }}
          />
        </div>
      ) : null}

      {/* ── WORLD popover: the demoted re-carry escape hatch ── */}
      {panel === "world" && doc ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-64 px-2 py-1"
          style={{
            border: "0.5px solid var(--line-2)", borderRadius: 2,
            background: "var(--popover, var(--background))",
            boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)",
          }}
        >
          <div className="pb-0.5">
            <Mono size={8}>DERIVED WORLD — never picked, re-carry is the escape hatch</Mono>
          </div>
          {carrier ? (
            <div className="py-0.5" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
              <Mono size={9} color="var(--foreground)">● {carrier.id}</Mono>
              <Mono size={8}> · 20{carrier.year} · pid {carrier.pid} · carrying {doc.name}</Mono>
            </div>
          ) : pending ? (
            <div className="py-0.5" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
              <Mono size={9} color="var(--cat-kiln)">◐ {pending.id}</Mono>
              <Mono size={8}> · booting {Math.round((pending.bootProgress ?? 0) * 100)}% · open queued</Mono>
            </div>
          ) : null}
          {carrier
            ? world.instances
                .filter((i) => i.year === doc.year && i.phase === "live" && i.id !== carrier.id)
                .map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className="block w-full py-0.5 text-left"
                    style={{ borderTop: "0.5px solid var(--line-soft)", cursor: "pointer" }}
                    onClick={() => {
                      dispatch({ t: "recarry", name: doc.name, to: i.id, via: label });
                      setPanel(null);
                    }}
                  >
                    <Mono size={9} color="var(--foreground)">→ re-carry to {i.id}</Mono>
                    <Mono size={8}> · 20{i.year} · pid {i.pid} · live</Mono>
                  </button>
                ))
            : null}
          {carrier ? (
            <button
              type="button"
              className="block w-full py-0.5 text-left"
              style={{ borderTop: "0.5px solid var(--line-soft)", cursor: "pointer" }}
              onClick={() => {
                dispatch({ t: "recarry", name: doc.name, to: "new", via: label });
                setPanel(null);
              }}
            >
              <Mono size={9} color="var(--cat-kiln)">+ new 20{doc.year} world (~90s)</Mono>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DocRow({ d, world, selected, onPick }: { d: Doc; world: World; selected: boolean; onPick: () => void }) {
  const carrier = d.openIn ? world.instances.find((i) => i.id === d.openIn) : undefined;
  const pending = d.pendingIn ? world.instances.find((i) => i.id === d.pendingIn) : undefined;
  const isRvt = d.kind === "rvt";

  // cost telegraph — say what the click will cost BEFORE the click
  const liveRightYear = world.instances.some((i) => i.year === d.year && i.phase === "live");
  const bootingRightYear = world.instances.some((i) => i.year === d.year && i.phase === "booting");
  const telegraph = carrier
    ? `open in ${carrier.id}`
    : liveRightYear
      ? "opens instantly — 20" + d.year + " world live"
      : bootingRightYear
        ? "queues on the booting 20" + d.year + " world"
        : `boots a 20${d.year} world (~90s)`;

  return (
    <div style={{ borderBottom: "0.5px solid var(--line-soft)", background: selected ? "color-mix(in srgb, var(--pe-blue) 5%, transparent)" : undefined }}>
      <button type="button" className="flex w-full items-center gap-1.5 py-1 text-left" style={{ cursor: "pointer" }} onClick={onPick}>
        <span
          className="font-[var(--font-pe-mono)] px-1"
          style={{
            fontSize: 8, letterSpacing: "0.06em", borderRadius: 2, flexShrink: 0,
            border: `0.5px solid ${isRvt ? "var(--pe-blue)" : "var(--cat-kiln)"}`,
            color: isRvt ? "var(--pe-blue)" : "var(--cat-kiln)",
            opacity: carrier || pending || selected ? 1 : 0.65,
          }}
        >
          {d.kind}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate" style={{ fontSize: 11.5, color: "var(--foreground)", opacity: carrier || pending || selected ? 1 : 0.75 }}>
            {d.name}
          </span>
          {pending ? (
            <Mono size={8} color="var(--cat-kiln)">◐ declaring {pending.id} · booting {Math.round((pending.bootProgress ?? 0) * 100)}%</Mono>
          ) : (
            <Mono size={8}>{age(d.lastOpenedMs, world.nowMs)} ago · {telegraph}</Mono>
          )}
        </span>
        {selected ? <Mono size={8} color="var(--pe-blue)">◉</Mono> : null}
      </button>
      {/* boot progress INSIDE the dropdown */}
      {pending ? (
        <div className="mb-1 ml-5 mr-1" style={{ height: 2, background: "var(--line-soft)", borderRadius: 2 }}>
          <div style={{ height: 2, width: `${Math.round((pending.bootProgress ?? 0) * 100)}%`, background: "var(--cat-kiln)", borderRadius: 2, transition: "width 0.9s linear" }} />
        </div>
      ) : null}
    </div>
  );
}

function FamilyLayer({
  doc, query, setQuery, picked, onPick,
}: {
  doc: Doc;
  query: string;
  setQuery: (q: string) => void;
  picked: string | null;
  onPick: (f: string) => void;
}) {
  const visible = (doc.families ?? []).filter(
    (f) => !f.excluded && (f.name + " " + f.category).toLowerCase().includes(query.toLowerCase()),
  );
  const excluded = (doc.families ?? []).filter((f) => f.excluded);
  return (
    <div className="pl-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="filter families"
        className="tele mb-0.5 w-full px-1.5 py-0.5"
        style={{
          fontSize: 10, borderRadius: 2, border: "0.5px solid var(--line-2)",
          background: "transparent", color: "var(--foreground)", outline: "none",
        }}
      />
      {visible.map((f) => (
        <button
          key={f.name}
          type="button"
          className="flex w-full items-baseline gap-1.5 py-1 text-left"
          style={{
            cursor: "pointer", borderBottom: "0.5px solid var(--line-soft)",
            background: picked === f.name ? "color-mix(in srgb, var(--cat-kiln) 8%, transparent)" : undefined,
          }}
          onClick={() => onPick(f.name)}
        >
          <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 1, border: "0.5px solid var(--cat-kiln)", transform: "rotate(45deg)", flexShrink: 0, alignSelf: "center" }} />
          <span className="truncate" style={{ fontSize: 11, color: "var(--foreground)" }}>{f.name}</span>
          <Mono size={8}>{f.category}</Mono>
          {picked === f.name ? <Mono size={8} color="var(--cat-kiln)">◉</Mono> : null}
        </button>
      ))}
      {!visible.length ? (
        <div className="py-1">
          <Mono size={8}>no family matches “{query}”</Mono>
        </div>
      ) : null}
      {excluded.length ? (
        <div className="py-0.5" style={{ opacity: 0.45 }}>
          <Mono size={8}>annotation-side, not editable here:</Mono>
          {excluded.map((f) => (
            <div key={f.name} className="flex items-baseline gap-1.5 py-0.5">
              <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 1, border: "0.5px solid var(--muted-foreground)", transform: "rotate(45deg)", flexShrink: 0, alignSelf: "center" }} />
              <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{f.name}</span>
              <Mono size={8}>{f.category}</Mono>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── page: three fake plugin headers + worlds strip + ledger ─────────────────────────────────────

function PluginHeader({
  title, caption, children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
      <div className="flex items-center gap-2 px-2 py-1" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
        <Mono size={9} color="var(--foreground)">{title.toUpperCase()}</Mono>
        <span className="ml-auto" />
        {children}
      </div>
      {/* fake plugin body */}
      <div className="px-2 py-2" style={{ minHeight: 34 }}>
        <Mono size={8}>… plugin surface …</Mono>
      </div>
      <div className="px-2 pb-1">
        <Mono size={8} color="var(--cat-kiln)">{caption}</Mono>
      </div>
    </div>
  );
}

function Page() {
  const [world, dispatch] = useReducer(reduce, seed);
  useEffect(() => {
    const t = setInterval(() => dispatch({ t: "tick" }), 1000);
    return () => clearInterval(t);
  }, []);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [world.events.length]);

  const alive = world.instances.filter((i) => i.phase !== "dead");

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto flex max-w-4xl px-4 py-4">
        <div className="min-w-0 flex-1 pr-3" style={{ borderRight: "0.5px solid var(--line-2)" }}>
          <div className="pb-2">
            <Mono size={10}>THE BREADCRUMB CHIP — one chip, one path: doc ▸ family · derived world</Mono>
          </div>

          <PluginHeader
            title="family plugin"
            caption="config: accept rvt+rfa, families on · pre-bound to Tower_A.rvt ▸ VAV_Parallel"
          >
            <BreadcrumbChip
              accept={["rvt", "rfa"]}
              families
              label="family-plugin"
              world={world}
              dispatch={dispatch}
              initialDoc="Tower_A.rvt"
              initialFamily="VAV_Parallel_FanPowered"
            />
          </PluginHeader>

          <PluginHeader
            title="schedule-grid"
            caption="config: rvt only, no family segment · same chip, fewer segments render"
          >
            <BreadcrumbChip
              accept={["rvt"]}
              families={false}
              label="schedule-grid"
              world={world}
              dispatch={dispatch}
              initialDoc="Tower_A.rvt"
            />
          </PluginHeader>

          <PluginHeader
            title="duct-sizer"
            caption="config: full accept, families on · starts unbound — the dashed empty chip"
          >
            <BreadcrumbChip
              accept={["rvt", "rfa"]}
              families
              label="duct-sizer"
              world={world}
              dispatch={dispatch}
            />
          </PluginHeader>

          {/* WORLDS — thin ops strip so derivations are observable */}
          <div className="mt-3">
            <div className="pb-0.5">
              <Mono size={9}>WORLDS — ops only, never a picking step</Mono>
            </div>
            <div style={{ borderTop: "0.5px solid var(--line-2)" }}>
              {alive.map((i) => {
                const carried = world.docs.filter((d) => d.openIn === i.id || d.pendingIn === i.id);
                return (
                  <div key={i.id} className="flex items-center gap-2 py-1" style={{ borderBottom: "0.5px solid var(--line-soft)", opacity: i.phase === "stopping" ? 0.5 : 1 }}>
                    <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 3, flexShrink: 0, background: i.phase === "live" ? "var(--pe-blue)" : i.phase === "booting" ? "var(--cat-kiln)" : "var(--muted-foreground)" }} />
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
                    {i.phase === "live" ? (
                      <button
                        type="button"
                        className="tele ml-auto px-1.5 py-0.5"
                        style={{ fontSize: 9, borderRadius: 2, cursor: "pointer", border: "0.5px solid var(--cat-clay)", color: "var(--cat-clay)" }}
                        onClick={() => dispatch({ t: "stopInstance", id: i.id })}
                      >
                        stop
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ledger — compact, w-56 */}
        <div className="flex w-56 flex-col pl-3">
          <div className="pb-1">
            <Mono size={9}>LEDGER</Mono>
          </div>
          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: "88vh" }}>
            {world.events.map((e, idx) => (
              <div key={idx} className="py-1" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                <Mono size={8} color={e.actor === "pea" ? "var(--cat-kiln)" : e.actor === "bridge" ? "var(--pe-blue)" : "var(--foreground)"}>
                  {e.actor}
                </Mono>{" "}
                <span style={{ fontSize: 10, color: "var(--foreground)" }}>{e.text}</span>{" "}
                <Mono size={8}>{age(e.atMs, world.nowMs)} ago</Mono>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
