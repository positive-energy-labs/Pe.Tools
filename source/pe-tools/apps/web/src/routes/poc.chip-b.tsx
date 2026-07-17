import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useReducer, useRef, useState } from "react";

/* ------------------------------------------------------------------------------------------------
 * PROTOTYPE — poc/chip-b. Throwaway. Concept B: "THE SOCKET".
 * One plugin-header chip replacing session TargetChip + .rvt chip + .rfa chip. The chip is a
 * SOCKET a document gets plugged into: empty = dashed receptacle; click = command-palette overlay
 * searching recent .rvt + .rfa + loaded families as ONE flat ranked list (lineage inline as
 * microtype); selecting runs the whole derivation chain (adopt / queue / declare) with boot
 * progress inside the palette. Docked chip HOVER-FLIPS (CSS 3D) to its provenance BACK —
 * carrier · pid · year · seen — with a demoted re-carry hatch. Session never on the front.
 * Mock fleet only. Delete me when the concept is judged.
 * ---------------------------------------------------------------------------------------------- */

export const Route = createFileRoute("/poc/chip-b")({ component: Page });

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
  excluded?: boolean;
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
  { name: "Tag_Duct_Size", category: "Duct Tags", excluded: true },
];

const CHILLER_FAMS: Fam[] = [
  { name: "Chiller_AirCooled_400Ton", category: "Mechanical Equipment" },
  { name: "CoolingTower_Crossflow", category: "Mechanical Equipment" },
  { name: "Valve_Butterfly_Lug", category: "Pipe Accessories" },
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
    { id: "sbx-basalt", year: 25, pid: 51544, phase: "live" },
    { id: "sbx-ash", year: 24, pid: 47120, phase: "dead", diedAtMs: T0 - 14 * MIN },
  ],
  events: [
    { atMs: T0 - 20 * MIN, actor: "you", text: "open Tower_A.rvt → derived carrier user-rrd" },
    { atMs: T0 - 9 * MIN, actor: "pea", text: "declare sbx-quartz (2025) to carry VAV_Box.rfa" },
    { atMs: T0 - 8 * MIN, actor: "pea", text: "VAV_Box.rfa opened in sbx-quartz" },
    { atMs: T0 - 2 * MIN, actor: "you", text: "start sbx-basalt (2025) — idle, no doc yet" },
  ],
};

type Act =
  | { t: "tick"; dtMs: number } // wall-clock delta — survives hidden-tab timer throttling
  | { t: "openDoc"; name: string; via: string }
  | { t: "recarry"; name: string; to: string | "new"; via: string }
  | { t: "stopInstance"; id: string }
  | { t: "restartInstance"; id: string }
  | { t: "note"; actor: Ev["actor"]; text: string };

let mint = 0;
const NAMES = ["copper", "slate", "amber", "chert", "onyx", "tuff"];

function reduce(w: World, a: Act): World {
  const now = a.t === "tick" ? w.nowMs + a.dtMs : w.nowMs;
  const ev = (actor: Ev["actor"], text: string): Ev => ({ atMs: now, actor, text });

  if (a.t === "tick") {
    const dtS = a.dtMs / 1000;
    const events: Ev[] = [];
    const instances = w.instances.map((i) => {
      if (i.phase === "booting") {
        const p = (i.bootProgress ?? 0) + (0.02 + Math.abs(Math.sin(i.pid ?? 1)) * 0.008) * dtS;
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
        events: [...w.events, ev("you", `plug ${a.name} → adopted ${carrier.id} (20${doc.year} live) · via ${a.via}`)],
      };
    }
    const incoming = w.instances.find((i) => i.year === doc.year && i.phase === "booting");
    if (incoming) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: incoming.id } : d)),
        events: [...w.events, ev("you", `plug ${a.name} → queued on ${incoming.id} (booting) · via ${a.via}`)],
      };
    }
    const id = `sbx-${NAMES[mint++ % NAMES.length]}`;
    return {
      ...w,
      instances: [...w.instances, { id, year: doc.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0 }],
      docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: id } : d)),
      events: [...w.events, ev("you", `plug ${a.name} → no 20${doc.year} world; declaring ${id} · via ${a.via}`)],
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

// ── palette index — recent docs + loaded families of open docs, one flat list ───────────────────

interface SocketConfig {
  accept: DocKind[];
  families: boolean;
}

type Entry =
  | { k: "doc"; doc: Doc }
  | { k: "fam"; fam: Fam; parent: Doc };

function entryKey(e: Entry): string {
  return e.k === "doc" ? `doc:${e.doc.name}` : `fam:${e.parent.name}/${e.fam.name}`;
}

function entryRecency(e: Entry): number {
  return e.k === "doc" ? e.doc.lastOpenedMs : e.parent.lastOpenedMs;
}

function telegraph(d: Doc, w: World): string {
  const carrier = d.openIn ? w.instances.find((i) => i.id === d.openIn) : undefined;
  if (carrier?.phase === "live") return `open in ${carrier.id} · instant`;
  if (d.pendingIn) return `queued on ${d.pendingIn} (booting)`;
  if (w.instances.some((i) => i.year === d.year && i.phase === "live")) return "opens instantly";
  if (w.instances.some((i) => i.year === d.year && i.phase === "booting")) return "click queues on a booting world";
  return "click boots a world (~90s)";
}

function indexEntries(cfg: SocketConfig, w: World, query: string): Entry[] {
  const q = query.trim().toLowerCase();
  const out: Entry[] = [];
  for (const d of w.docs) {
    if (!cfg.accept.includes(d.kind)) continue;
    if (!q || d.name.toLowerCase().includes(q)) out.push({ k: "doc", doc: d });
    // families of currently-open .rvt docs, indexed flat alongside
    if (cfg.families && d.kind === "rvt" && d.openIn && d.families) {
      const carrier = w.instances.find((i) => i.id === d.openIn);
      if (carrier?.phase !== "live") continue;
      for (const f of d.families) {
        if (f.excluded) continue;
        if (!q || `${f.name} ${f.category} ${d.name}`.toLowerCase().includes(q)) out.push({ k: "fam", fam: f, parent: d });
      }
    }
  }
  // rank: query → flat, prefix matches first then recency; empty query → year-grouped, recency within
  out.sort((a, b) => {
    if (q) {
      const an = (a.k === "doc" ? a.doc.name : a.fam.name).toLowerCase();
      const bn = (b.k === "doc" ? b.doc.name : b.fam.name).toLowerCase();
      const ap = an.startsWith(q) ? 0 : 1;
      const bp = bn.startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
    } else {
      const ay = a.k === "doc" ? a.doc.year : a.parent.year;
      const by = b.k === "doc" ? b.doc.year : b.parent.year;
      if (ay !== by) return by - ay;
    }
    return entryRecency(b) - entryRecency(a);
  });
  return out;
}

// ── THE SOCKET — the plugin-header chip this prototype exists to prove ──────────────────────────

interface Plugged {
  doc: string;
  family?: string;
}

function Socket({
  cfg,
  label,
  world,
  dispatch,
  initial,
}: {
  cfg: SocketConfig;
  label: string;
  world: World;
  dispatch: React.Dispatch<Act>;
  initial?: Plugged;
}) {
  const [plugged, setPlugged] = useState<Plugged | null>(initial ?? null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [landing, setLanding] = useState<Plugged | null>(null); // picked, waiting on a boot
  const [flipped, setFlipped] = useState(false);
  const [hatchOpen, setHatchOpen] = useState(false);

  const doc = plugged ? world.docs.find((d) => d.name === plugged.doc) : undefined;
  const carrier = doc?.openIn ? world.instances.find((i) => i.id === doc.openIn) : undefined;
  const pending = doc?.pendingIn ? world.instances.find((i) => i.id === doc.pendingIn) : undefined;

  // landing watcher — commit the plug once the picked doc physically lands
  const landingDoc = landing ? world.docs.find((d) => d.name === landing.doc) : undefined;
  useEffect(() => {
    if (!landing || !landingDoc) return;
    const c = landingDoc.openIn ? world.instances.find((i) => i.id === landingDoc.openIn) : undefined;
    if (c?.phase === "live") {
      setPlugged(landing);
      setLanding(null);
      setPaletteOpen(false);
    }
  }, [landing, landingDoc, world.instances]);

  const pick = (e: Entry) => {
    const target: Plugged = e.k === "doc" ? { doc: e.doc.name } : { doc: e.parent.name, family: e.fam.name };
    const d = world.docs.find((x) => x.name === target.doc);
    const live = d?.openIn && world.instances.find((i) => i.id === d.openIn)?.phase === "live";
    if (e.k === "fam") dispatch({ t: "note", actor: "you", text: `plug family ${e.fam.name} (in ${e.parent.name}) · via ${label}` });
    if (live) {
      if (e.k === "doc") dispatch({ t: "note", actor: "you", text: `plug ${target.doc} — already carried · via ${label}` });
      setPlugged(target);
      setPaletteOpen(false);
      return;
    }
    dispatch({ t: "openDoc", name: target.doc, via: label });
    setLanding(target); // palette stays open showing the boot until it lands
  };

  const face = plugged?.family ?? plugged?.doc;
  const isRfa = doc?.kind === "rfa";
  // mock "seen Ns ago" freshness — wobbles with the world clock so the back face feels alive
  const seenS = (Math.floor(world.nowMs / 1000) % 5) + 2;
  const otherWorlds = doc ? world.instances.filter((i) => i.year === doc.year && i.phase === "live" && i.id !== doc.openIn) : [];

  return (
    <span className="relative inline-flex" data-socket={label}>
      {!plugged ? (
        // EMPTY SOCKET — a dashed receptacle awaiting a plug
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="tele inline-flex h-7 items-center gap-1.5 px-2"
          style={{
            fontSize: 11, borderRadius: 2, cursor: "pointer", background: "transparent",
            border: "1px dashed var(--line-2)", color: "var(--muted-foreground)",
          }}
        >
          <span style={{ fontSize: 12, lineHeight: 1 }}>⌾</span>
          <span>plug a document</span>
        </button>
      ) : (
        // DOCKED SOCKET — front = what you edit; hover flips to the provenance back
        <span
          style={{ perspective: 600, display: "inline-block" }}
          onMouseEnter={() => setFlipped(true)}
          onMouseLeave={() => {
            if (!hatchOpen) setFlipped(false);
          }}
        >
          <span
            style={{
              display: "grid", transformStyle: "preserve-3d", transition: "transform 0.22s ease",
              transform: flipped ? "rotateX(180deg)" : "rotateX(0deg)",
            }}
          >
            {/* FRONT — document/family face */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="tele inline-flex h-7 items-center gap-1.5 px-2"
              data-face="front"
              style={{
                gridArea: "1 / 1", backfaceVisibility: "hidden", fontSize: 11, borderRadius: 2,
                cursor: "pointer", background: "color-mix(in srgb, var(--pe-blue) 5%, transparent)",
                border: `0.5px solid ${pending ? "var(--cat-kiln)" : "var(--pe-blue)"}`, color: "var(--foreground)",
              }}
            >
              <span
                className="font-[var(--font-pe-mono)]"
                style={{ fontSize: 8, letterSpacing: "0.06em", color: isRfa ? "var(--cat-kiln)" : "var(--pe-blue)" }}
              >
                {plugged.family ? "fam" : doc?.kind}
              </span>
              <span className="max-w-44 truncate">{face}</span>
              {plugged.family ? <Mono size={8}>in {plugged.doc}</Mono> : null}
            </button>

            {/* BACK — provenance face; session lives here and only here */}
            <span
              className="tele inline-flex h-7 items-center gap-1.5 px-2"
              data-face="back"
              style={{
                gridArea: "1 / 1", backfaceVisibility: "hidden", transform: "rotateX(180deg)",
                fontSize: 11, borderRadius: 2, background: "var(--background)",
                border: "0.5px solid var(--line-2)", whiteSpace: "nowrap",
              }}
            >
              {carrier ? (
                <>
                  <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--pe-blue)", flexShrink: 0 }} />
                  <Mono size={9} color="var(--foreground)">{carrier.id}</Mono>
                  <Mono size={8}>pid {carrier.pid} · 20{carrier.year} · seen {seenS}s ago</Mono>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setHatchOpen((o) => !o);
                    }}
                    className="font-[var(--font-pe-mono)] cursor-pointer px-1"
                    style={{ fontSize: 8, borderRadius: 2, border: "0.5px solid var(--line-soft)", color: "var(--muted-foreground)", background: "transparent" }}
                  >
                    re-carry
                  </button>
                </>
              ) : pending ? (
                <>
                  <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--cat-kiln)", flexShrink: 0 }} />
                  <Mono size={9} color="var(--cat-kiln)">◐ {pending.id} booting {Math.round((pending.bootProgress ?? 0) * 100)}%</Mono>
                </>
              ) : (
                <Mono size={9} color="var(--cat-clay)">carrier lost — click front to replug</Mono>
              )}
            </span>
          </span>

          {/* re-carry hatch — the demoted escape from a derived session */}
          {hatchOpen && doc ? (
            <span
              className="px-2 py-1"
              style={{
                position: "absolute", left: 0, top: "100%", marginTop: 2, zIndex: 40, minWidth: 210,
                display: "block", background: "var(--background)", border: "0.5px solid var(--line-2)",
                borderRadius: 2, boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)",
              }}
            >
              <span className="block pb-0.5">
                <Mono size={8}>RE-CARRY {doc.name}</Mono>
              </span>
              {otherWorlds.map((i) => (
                <span
                  key={i.id}
                  className="block py-0.5"
                  style={{ cursor: "pointer", borderTop: "0.5px solid var(--line-soft)" }}
                  onClick={() => {
                    dispatch({ t: "recarry", name: doc.name, to: i.id, via: label });
                    setHatchOpen(false);
                    setFlipped(false);
                  }}
                >
                  <Mono size={9} color="var(--foreground)">→ {i.id}</Mono>
                  <Mono size={8}> · pid {i.pid} · live</Mono>
                </span>
              ))}
              {!otherWorlds.length ? (
                <span className="block py-0.5" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                  <Mono size={8}>no other live 20{doc.year} world</Mono>
                </span>
              ) : null}
              <span
                className="block py-0.5"
                style={{ cursor: "pointer", borderTop: "0.5px solid var(--line-soft)" }}
                onClick={() => {
                  dispatch({ t: "recarry", name: doc.name, to: "new", via: label });
                  setHatchOpen(false);
                  setFlipped(false);
                }}
              >
                <Mono size={9} color="var(--cat-kiln)">+ new 20{doc.year} world (~90s)</Mono>
              </span>
            </span>
          ) : null}
        </span>
      )}

      {paletteOpen ? (
        <Palette
          cfg={cfg}
          label={label}
          world={world}
          landing={landing}
          onPick={pick}
          onClose={() => {
            if (!landing) setPaletteOpen(false);
          }}
        />
      ) : null}
    </span>
  );
}

// ── the palette — one search input, one flat ranked list across everything ──────────────────────

function Palette({
  cfg,
  label,
  world,
  landing,
  onPick,
  onClose,
}: {
  cfg: SocketConfig;
  label: string;
  world: World;
  landing: Plugged | null;
  onPick: (e: Entry) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const entries = indexEntries(cfg, world, query);
  const clamped = Math.min(cursor, Math.max(0, entries.length - 1));

  const landingDoc = landing ? world.docs.find((d) => d.name === landing.doc) : undefined;
  const landingInst = landingDoc?.pendingIn ? world.instances.find((i) => i.id === landingDoc.pendingIn) : undefined;

  const scope = [
    ...cfg.accept.map((k) => `.${k}`),
    ...(cfg.families ? ["loaded families"] : []),
  ].join(" + ");

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)" }}
      onMouseDown={onClose}
      data-palette={label}
    >
      <div
        className="mx-auto"
        style={{
          width: 480, maxWidth: "92vw", marginTop: "16vh", background: "var(--background)",
          border: "0.5px solid var(--line-2)", borderRadius: 2,
          boxShadow: "0 6px 24px color-mix(in srgb, var(--foreground) 14%, transparent)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: "0.5px solid var(--line-2)" }}>
          <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>⌾</span>
          <input
            ref={inputRef}
            value={query}
            disabled={!!landing}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, entries.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && entries[clamped]) {
                onPick(entries[clamped]);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder={`plug into ${label} — search ${scope}`}
            className="tele flex-1"
            style={{ fontSize: 12, background: "transparent", border: "none", outline: "none", color: "var(--foreground)" }}
          />
          <Mono size={8}>{entries.length}</Mono>
        </div>

        {landing ? (
          // derivation in flight — palette holds until the world lands
          <div className="px-3 py-2">
            <Mono size={9} color="var(--cat-kiln)">
              ◐ plugging {landing.family ?? landing.doc} — declaring {landingInst?.id ?? "world"} · booting{" "}
              {Math.round((landingInst?.bootProgress ?? 0) * 100)}%
            </Mono>
            <div className="mt-1" style={{ height: 2, background: "var(--line-soft)", borderRadius: 2 }}>
              <div
                style={{
                  height: 2, borderRadius: 2, background: "var(--cat-kiln)", transition: "width 0.9s linear",
                  width: `${Math.round((landingInst?.bootProgress ?? 0) * 100)}%`,
                }}
              />
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {entries.map((e, i) => {
              const prev = entries[i - 1];
              const year = e.k === "doc" ? e.doc.year : e.parent.year;
              const prevYear = prev ? (prev.k === "doc" ? prev.doc.year : prev.parent.year) : undefined;
              const divider = !query && year !== prevYear;
              const active = i === clamped;
              return (
                <div key={entryKey(e)}>
                  {divider ? (
                    <div className="px-3 pb-0.5 pt-1.5" style={{ borderTop: i ? "0.5px solid var(--line-soft)" : undefined }}>
                      <Mono size={8} color="var(--foreground)">REVIT 20{year}</Mono>
                    </div>
                  ) : null}
                  <div
                    className="flex items-center gap-2 px-3 py-1"
                    style={{
                      cursor: "pointer",
                      background: active ? "color-mix(in srgb, var(--pe-blue) 7%, transparent)" : undefined,
                    }}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => onPick(e)}
                  >
                    <span
                      className="font-[var(--font-pe-mono)] px-1"
                      style={{
                        fontSize: 8, letterSpacing: "0.06em", borderRadius: 2, flexShrink: 0,
                        border: `0.5px solid ${e.k === "fam" ? "var(--cat-kiln)" : e.doc.kind === "rvt" ? "var(--pe-blue)" : "var(--cat-kiln)"}`,
                        color: e.k === "fam" ? "var(--cat-kiln)" : e.doc.kind === "rvt" ? "var(--pe-blue)" : "var(--cat-kiln)",
                      }}
                    >
                      {e.k === "fam" ? "fam" : e.doc.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate" style={{ fontSize: 12, color: "var(--foreground)" }}>
                      {e.k === "fam" ? e.fam.name : e.doc.name}
                    </span>
                    <Mono size={8}>
                      {e.k === "fam"
                        ? `family in ${e.parent.name} · 20${e.parent.year} · opens instantly`
                        : `20${e.doc.year} · ${age(e.doc.lastOpenedMs, world.nowMs)} ago · ${telegraph(e.doc, world)}`}
                    </Mono>
                  </div>
                </div>
              );
            })}
            {!entries.length ? (
              <div className="px-3 py-2">
                <Mono size={9}>nothing matches “{query}” in {scope}</Mono>
              </div>
            ) : null}
          </div>
        )}

        <div className="flex justify-between px-3 py-1" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
          <Mono size={8}>↑↓ move · ↵ plug · esc close</Mono>
          <Mono size={8}>session derived on plug — never picked</Mono>
        </div>
      </div>
    </div>
  );
}

// ── demo page — 3 fake plugin headers over ONE fleet, WORLDS strip + ledger for observability ───

function PluginHeader({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
      <div className="flex items-center gap-2 px-2 py-1" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
        <Mono size={9} color="var(--foreground)">{title.toUpperCase()}</Mono>
        <span className="ml-auto" />
        {children}
      </div>
      <div className="px-2 py-1" style={{ opacity: 0.55 }}>
        <Mono size={8}>{caption}</Mono>
      </div>
      <div className="mx-2 mb-2 flex items-center justify-center" style={{ height: 42, border: "0.5px dashed var(--line-soft)", borderRadius: 2 }}>
        <Mono size={8}>plugin body — irrelevant here</Mono>
      </div>
    </div>
  );
}

function Page() {
  const [world, dispatch] = useReducer(reduce, seed);
  useEffect(() => {
    let last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      dispatch({ t: "tick", dtMs: now - last });
      last = now;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [world.events.length]);

  const alive = world.instances.filter((i) => i.phase !== "dead");

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto max-w-4xl px-4 py-4">
        <div className="pb-2">
          <Mono size={10}>THE SOCKET — one chip, plugged not picked. Hover a docked chip to flip it.</Mono>
        </div>

        <div className="flex flex-col gap-3">
          <PluginHeader
            title="family editor"
            caption="full config — accept rvt+rfa, families indexed · pre-plugged with a family, hover it for provenance"
          >
            <Socket
              cfg={{ accept: ["rvt", "rfa"], families: true }}
              label="family-editor"
              world={world}
              dispatch={dispatch}
              initial={{ doc: "Tower_A.rvt", family: "VAV_Parallel_FanPowered" }}
            />
          </PluginHeader>

          <PluginHeader
            title="schedule-grid"
            caption="narrowed — accept rvt only, no families · the palette indexes a smaller world"
          >
            <Socket
              cfg={{ accept: ["rvt"], families: false }}
              label="schedule-grid"
              world={world}
              dispatch={dispatch}
            />
          </PluginHeader>

          <PluginHeader
            title="sheet-lister"
            caption="unbound — full config, nothing plugged yet · the empty receptacle state"
          >
            <Socket
              cfg={{ accept: ["rvt", "rfa"], families: true }}
              label="sheet-lister"
              world={world}
              dispatch={dispatch}
            />
          </PluginHeader>
        </div>

        {/* observability — worlds strip + ledger so derivations are visible */}
        <div className="mt-4 flex gap-4">
          <div className="min-w-0 flex-1">
            <div className="pb-1">
              <Mono size={9}>WORLDS — derived, never picked</Mono>
            </div>
            <div style={{ borderTop: "0.5px solid var(--line-2)" }}>
              {alive.map((i) => {
                const carried = world.docs.filter((d) => d.openIn === i.id || d.pendingIn === i.id);
                return (
                  <div key={i.id} className="flex items-center gap-2 py-1" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                    <span style={{ width: 5, height: 5, borderRadius: 3, flexShrink: 0, background: i.phase === "live" ? "var(--pe-blue)" : i.phase === "booting" ? "var(--cat-kiln)" : "var(--muted-foreground)" }} />
                    <Mono size={9} color="var(--foreground)">{i.id}</Mono>
                    <Mono size={8}>
                      20{i.year} · pid {i.pid} ·{" "}
                      {i.phase === "booting"
                        ? `booting ${Math.round((i.bootProgress ?? 0) * 100)}%`
                        : carried.length
                          ? `carrying ${carried.map((d) => d.name).join(", ")}`
                          : "idle"}
                    </Mono>
                    {i.phase === "live" ? (
                      <button
                        type="button"
                        onClick={() => dispatch({ t: "stopInstance", id: i.id })}
                        className="tele ml-auto cursor-pointer px-1.5"
                        style={{ fontSize: 8, borderRadius: 2, border: "0.5px solid var(--cat-clay)", color: "var(--cat-clay)", background: "transparent" }}
                      >
                        stop
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex w-56 flex-col">
            <div className="pb-1">
              <Mono size={9}>LEDGER</Mono>
            </div>
            <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: 260, borderTop: "0.5px solid var(--line-2)" }}>
              {world.events.map((e, idx) => (
                <div key={idx} className="py-0.5" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                  <Mono size={8} color={e.actor === "pea" ? "var(--cat-kiln)" : e.actor === "bridge" ? "var(--pe-blue)" : "var(--foreground)"}>
                    {e.actor}
                  </Mono>{" "}
                  <span style={{ fontSize: 9.5, color: "var(--foreground)" }}>{e.text}</span>{" "}
                  <Mono size={7}>{age(e.atMs, world.nowMs)}</Mono>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
