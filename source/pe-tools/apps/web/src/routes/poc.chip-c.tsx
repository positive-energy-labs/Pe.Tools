import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useReducer, useRef, useState } from "react";

/* ------------------------------------------------------------------------------------------------
 * PROTOTYPE — poc/chip-c. Throwaway. Concept: "THE SENTENCE".
 * The plugin-header chip is a full sentence that states the target the way a colleague would:
 *   "editing VAV_Parallel from Tower_A.rvt in a live 2026 world"
 * The underlined slots (<family>, <doc>) are the ONLY interactive nouns — each anchors a
 * mini-picker. The world clause is prose, never a choice: the session is narration derived from
 * the document, with a demoted ⟲ re-carry hatch and live boot-progress narration. Replaces the
 * old TargetChip + .rvt chip + .rfa chip trio. Mock fleet only. Delete me when promoted.
 * ---------------------------------------------------------------------------------------------- */

export const Route = createFileRoute("/poc/chip-c")({ component: Page });

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
  { name: "Grille_Supply_12x12", category: "Air Terminals" },
  { name: "Tag_Pipe_System", category: "Pipe Tags", excluded: true },
];

const seed: World = {
  nowMs: T0,
  docs: [
    { name: "Tower_A.rvt", kind: "rvt", year: 26, lastOpenedMs: T0 - 6 * MIN, openIn: "user-rrd", families: TOWER_FAMS },
    { name: "Tower_A_Central_Plant.rvt", kind: "rvt", year: 26, lastOpenedMs: T0 - 3 * HR, families: CHILLER_FAMS },
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
  ],
  events: [
    { atMs: T0 - 20 * MIN, actor: "you", text: "open Tower_A.rvt → derived carrier user-rrd" },
    { atMs: T0 - 9 * MIN, actor: "pea", text: "declare sbx-quartz (2025) to carry VAV_Box.rfa" },
    { atMs: T0 - 8 * MIN, actor: "pea", text: "VAV_Box.rfa opened in sbx-quartz" },
  ],
};

type Act =
  | { t: "tick" }
  | { t: "openDoc"; name: string; via: string }
  | { t: "recarry"; name: string; to: string | "new"; via: string }
  | { t: "stopInstance"; id: string }
  | { t: "crashInstance"; id: string } // instance dies WITHOUT closing its docs — models a crash
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
        events: [...w.events, ev("you", `open ${a.name} → derived carrier ${carrier.id} (20${doc.year} already live) · via ${a.via}`)],
      };
    }
    const incoming = w.instances.find((i) => i.year === doc.year && i.phase === "booting");
    if (incoming) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: incoming.id } : d)),
        events: [...w.events, ev("you", `open ${a.name} → queued on ${incoming.id} (already booting) · via ${a.via}`)],
      };
    }
    const id = `sbx-${NAMES[mint++ % NAMES.length]}`;
    return {
      ...w,
      instances: [...w.instances, { id, year: doc.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0 }],
      docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: id } : d)),
      events: [...w.events, ev("you", `open ${a.name} → no 20${doc.year} world; declaring ${id} + queueing open · via ${a.via}`)],
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

  if (a.t === "crashInstance")
    return {
      ...w,
      instances: w.instances.map((i) => (i.id === a.id ? { ...i, phase: "dead", diedAtMs: now, bootProgress: undefined } : i)),
      events: [...w.events, ev("bridge", `${a.id} died unexpectedly — its documents are orphaned`)],
    };

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

function Mono({ children, size = 9, color = "var(--muted-foreground)" }: { children: React.ReactNode; size?: number; color?: string }) {
  return (
    <span className="font-[var(--font-pe-mono)]" style={{ fontSize: size, color, letterSpacing: "0.04em" }}>
      {children}
    </span>
  );
}

/** What opening a doc of this year would derive — used for cost subtitles AND ghost previews. */
function derivation(world: World, year: number): { clause: string; cost: string } {
  if (world.instances.some((i) => i.year === year && i.phase === "live"))
    return { clause: `a live 20${year} world`, cost: "opens instantly" };
  if (world.instances.some((i) => i.year === year && i.phase === "booting"))
    return { clause: `a 20${year} world already booting`, cost: "queues the open" };
  return { clause: `a NEW 20${year} world (~90s boot)`, cost: `boots a 20${year} world (~90s)` };
}

// ── the sentence chip — THE component this prototype exists to prove ───────────────────────────

interface ChipCfg {
  verb: string; // "editing" | "auditing" | ... — supplied by the plugin mount
  accept: DocKind[];
  families: boolean;
  label: string; // mount name, for ledger provenance
}

/** Underlined interactive slot inside the sentence. */
function Slot({ text, placeholder, onClick, open }: { text: string | null; placeholder: string; onClick: () => void; open: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="tele"
      style={{
        fontSize: 11,
        padding: 0,
        cursor: "pointer",
        background: open ? "color-mix(in srgb, var(--pe-blue) 7%, transparent)" : "transparent",
        border: "none",
        borderBottom: `0.5px solid ${text ? "var(--foreground)" : "var(--pe-blue)"}`,
        borderRadius: 0,
        color: text ? "var(--foreground)" : "var(--pe-blue)",
        whiteSpace: "nowrap",
      }}
    >
      {text ?? placeholder}
    </button>
  );
}

function Prose({ children, color = "var(--muted-foreground)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="tele" style={{ fontSize: 11, color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function SentenceChip({
  cfg,
  world,
  dispatch,
  initialDoc,
  initialFamily,
}: {
  cfg: ChipCfg;
  world: World;
  dispatch: React.Dispatch<Act>;
  initialDoc?: string;
  initialFamily?: string;
}) {
  const [selected, setSelected] = useState<string | null>(initialDoc ?? null);
  const [family, setFamily] = useState<string | null>(initialFamily ?? null);
  const [openSlot, setOpenSlot] = useState<"doc" | "family" | "recarry" | null>(null);
  const [ghost, setGhost] = useState<string | null>(null); // sentence-to-be, on picker hover
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openSlot) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpenSlot(null);
        setGhost(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openSlot]);

  const docs = world.docs.filter((d) => cfg.accept.includes(d.kind));
  const selDoc = selected ? docs.find((d) => d.name === selected) : undefined;
  const carrier = selDoc?.openIn ? world.instances.find((i) => i.id === selDoc.openIn) : undefined;
  const pending = selDoc?.pendingIn ? world.instances.find((i) => i.id === selDoc.pendingIn) : undefined;
  const wantsFamily = cfg.families && selDoc?.kind === "rvt";
  const otherWorlds = selDoc
    ? world.instances.filter((i) => i.year === selDoc.year && i.phase === "live" && i.id !== selDoc.openIn)
    : [];

  const pickDoc = (d: Doc) => {
    if (d.name !== selected) {
      setSelected(d.name);
      setFamily(null);
      setQuery("");
    }
    if (!d.openIn && !d.pendingIn) dispatch({ t: "openDoc", name: d.name, via: cfg.label });
    setOpenSlot(null);
    setGhost(null);
  };

  /** The ghost line: the sentence this hover would produce, cost stated up front. */
  const ghostFor = (d: Doc): string => {
    const famPart = cfg.families && d.kind === "rvt" ? "— from " : "";
    const clause = d.openIn
      ? `a live 20${d.year} world`
      : d.pendingIn
        ? `a 20${d.year} world already booting`
        : derivation(world, d.year).clause;
    return `would read: ${cfg.verb} ${famPart}${d.name} in ${clause}`;
  };

  // ── the world clause — session as narration, never a choice ──
  const worldClause = (() => {
    if (!selDoc) return null;
    if (pending) {
      return (
        <Prose>
          {" "}in a 20{selDoc.year} world that is still booting ({Math.round((pending.bootProgress ?? 0) * 100)}%)
        </Prose>
      );
    }
    if (carrier?.phase === "dead") {
      return (
        <>
          <Prose color="var(--cat-clay)"> — its world died</Prose>
          <Prose color="var(--cat-clay)"> · </Prose>
          <button
            type="button"
            className="tele"
            style={{
              fontSize: 11, padding: 0, cursor: "pointer", background: "transparent", border: "none",
              borderBottom: "0.5px solid var(--cat-clay)", borderRadius: 0, color: "var(--cat-clay)",
            }}
            onClick={() => dispatch({ t: "restartInstance", id: carrier.id })}
          >
            restart?
          </button>
        </>
      );
    }
    if (carrier?.phase === "booting") {
      return (
        <Prose>
          {" "}in a 20{selDoc.year} world that is still booting ({Math.round((carrier.bootProgress ?? 0) * 100)}%)
        </Prose>
      );
    }
    if (carrier?.phase === "live") {
      return (
        <>
          <Prose> in a live 20{selDoc.year} world</Prose>
          {/* demoted re-carry hatch — tiny, affixed after the prose */}
          <button
            type="button"
            title={`carried by ${carrier.id} (pid ${carrier.pid}) — re-carry`}
            className="tele"
            style={{
              fontSize: 10, padding: "0 2px", marginLeft: 2, cursor: "pointer",
              background: openSlot === "recarry" ? "color-mix(in srgb, var(--pe-blue) 7%, transparent)" : "transparent",
              border: "none", borderRadius: 2, color: "var(--muted-foreground)", opacity: 0.7,
            }}
            onClick={(e) => {
              e.stopPropagation();
              setOpenSlot(openSlot === "recarry" ? null : "recarry");
            }}
          >
            ⟲
          </button>
        </>
      );
    }
    return <Prose> — no world carries it yet</Prose>;
  })();

  // full sentence as plain text for the title tooltip
  const titleText = !selDoc
    ? "nothing open — pick a document to begin"
    : `${cfg.verb} ${wantsFamily ? `${family ?? "(pick a family)"} from ` : ""}${selDoc.name}${
        pending || carrier?.phase === "booting"
          ? ` in a 20${selDoc.year} world that is still booting`
          : carrier?.phase === "dead"
            ? " — its world died"
            : carrier?.phase === "live"
              ? ` in a live 20${selDoc.year} world (${carrier.id} · pid ${carrier.pid})`
              : ""
      }`;

  return (
    <div ref={rootRef} className="relative inline-block min-w-0" title={titleText}>
      {/* THE SENTENCE — one line, h-7, truncates gracefully */}
      <div className="flex h-7 items-center overflow-hidden px-2" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
        <span className="flex items-baseline gap-1 truncate" style={{ whiteSpace: "nowrap" }}>
          {!selDoc ? (
            <>
              <Prose>nothing open — </Prose>
              <Slot text={null} placeholder="pick a document" open={openSlot === "doc"} onClick={() => setOpenSlot(openSlot === "doc" ? null : "doc")} />
              <Prose> to begin</Prose>
            </>
          ) : (
            <>
              <Prose>{cfg.verb} </Prose>
              {wantsFamily ? (
                <>
                  <span className="relative">
                    <Slot
                      text={family}
                      placeholder="pick a family"
                      open={openSlot === "family"}
                      onClick={() => setOpenSlot(openSlot === "family" ? null : "family")}
                    />
                  </span>
                  <Prose> from </Prose>
                </>
              ) : null}
              <Slot
                text={selDoc.name}
                placeholder="pick a document"
                open={openSlot === "doc"}
                onClick={() => setOpenSlot(openSlot === "doc" ? null : "doc")}
              />
              {worldClause}
            </>
          )}
        </span>
      </div>

      {/* ghost preview — the sentence-to-be, under the chip while hovering the picker */}
      {ghost ? (
        <div className="px-2 pt-0.5" style={{ opacity: 0.75 }}>
          <Mono size={9} color="var(--cat-kiln)">{ghost}</Mono>
        </div>
      ) : null}

      {/* ── DOC SLOT PICKER — the combined two-layer recents list, cost subtitles ── */}
      {openSlot === "doc" ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-80 px-2 py-1"
          style={{ border: "0.5px solid var(--line-2)", background: "var(--background)", borderRadius: 2, boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)" }}
          onMouseLeave={() => setGhost(null)}
        >
          {YEARS.map((y) => {
            const rows = docs.filter((d) => d.year === y).sort((a, b) => b.lastOpenedMs - a.lastOpenedMs);
            if (!rows.length) return null;
            const active = world.instances.some((i) => i.year === y && (i.phase === "live" || i.phase === "booting"));
            return (
              <div key={y} style={{ opacity: active ? 1 : 0.6 }}>
                <div className="flex items-baseline gap-2 pt-1 pb-0.5">
                  <Mono size={8} color={active ? "var(--foreground)" : "var(--muted-foreground)"}>REVIT 20{y}</Mono>
                  {!active ? <Mono size={8}>no world — opens cost a boot</Mono> : null}
                </div>
                <div style={{ borderTop: "0.5px solid var(--line-2)" }}>
                  {rows.map((d) => {
                    const isSel = d.name === selected;
                    const dv = derivation(world, d.year);
                    const sub = d.openIn
                      ? `open in ${d.openIn}`
                      : d.pendingIn
                        ? `queued on ${d.pendingIn} (booting)`
                        : `last opened ${age(d.lastOpenedMs, world.nowMs)} ago · ${dv.cost}`;
                    return (
                      <div
                        key={d.name}
                        className="flex items-center gap-2 py-1"
                        style={{
                          cursor: "pointer",
                          borderBottom: "0.5px solid var(--line-soft)",
                          background: isSel ? "color-mix(in srgb, var(--pe-blue) 5%, transparent)" : undefined,
                        }}
                        onClick={() => pickDoc(d)}
                        onMouseEnter={() => setGhost(ghostFor(d))}
                      >
                        <span
                          className="font-[var(--font-pe-mono)] px-1"
                          style={{
                            fontSize: 8, letterSpacing: "0.06em", borderRadius: 2, flexShrink: 0,
                            border: `0.5px solid ${d.kind === "rvt" ? "var(--pe-blue)" : "var(--cat-kiln)"}`,
                            color: d.kind === "rvt" ? "var(--pe-blue)" : "var(--cat-kiln)",
                          }}
                        >
                          {d.kind}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate" style={{ fontSize: 11.5, color: "var(--foreground)" }}>{d.name}</div>
                          <Mono size={8}>{sub}</Mono>
                        </div>
                        {isSel ? <Mono size={8} color="var(--pe-blue)">◉</Mono> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── FAMILY SLOT PICKER — searchable loaded families of the open doc ── */}
      {openSlot === "family" && selDoc ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-72 px-2 py-1"
          style={{ border: "0.5px solid var(--line-2)", background: "var(--background)", borderRadius: 2, boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)" }}
        >
          {carrier?.phase !== "live" ? (
            <div className="py-1">
              <Mono size={8}>families load once {selDoc.name} is open in a live world</Mono>
            </div>
          ) : (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="filter families — name or category"
                className="tele mt-1 w-full px-1.5 py-0.5"
                style={{ fontSize: 10, borderRadius: 2, border: "0.5px solid var(--line-2)", background: "transparent", color: "var(--foreground)", outline: "none" }}
              />
              {(selDoc.families ?? [])
                .filter((f) => !f.excluded && (f.name + " " + f.category).toLowerCase().includes(query.toLowerCase()))
                .map((f) => (
                  <div
                    key={f.name}
                    className="flex items-baseline gap-2 py-1"
                    style={{
                      cursor: "pointer", borderBottom: "0.5px solid var(--line-soft)",
                      background: family === f.name ? "color-mix(in srgb, var(--cat-kiln) 8%, transparent)" : undefined,
                    }}
                    onClick={() => {
                      setFamily(f.name);
                      dispatch({ t: "note", actor: "you", text: `pick family ${f.name} in ${selDoc.name} · via ${cfg.label}` });
                      setOpenSlot(null);
                    }}
                  >
                    <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 1, border: "0.5px solid var(--cat-kiln)", transform: "rotate(45deg)", flexShrink: 0 }} />
                    <span className="truncate" style={{ fontSize: 11, color: "var(--foreground)" }}>{f.name}</span>
                    <Mono size={8}>{f.category}</Mono>
                  </div>
                ))}
            </>
          )}
        </div>
      ) : null}

      {/* ── RE-CARRY popover — the demoted escape hatch behind ⟲ ── */}
      {openSlot === "recarry" && selDoc?.openIn ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-64 px-2 py-1"
          style={{ border: "0.5px solid var(--line-2)", background: "var(--background)", borderRadius: 2, boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)" }}
        >
          <div className="pb-0.5">
            <Mono size={8}>RE-CARRY — the world stays derived; this is the escape hatch</Mono>
          </div>
          {otherWorlds.map((i) => (
            <div
              key={i.id}
              className="py-0.5"
              style={{ cursor: "pointer", borderTop: "0.5px solid var(--line-soft)" }}
              onClick={() => {
                dispatch({ t: "recarry", name: selDoc.name, to: i.id, via: cfg.label });
                setOpenSlot(null);
              }}
            >
              <Mono size={9} color="var(--foreground)">→ {i.id}</Mono>
              <Mono size={8}> · 20{i.year} · pid {i.pid} · live</Mono>
            </div>
          ))}
          {!otherWorlds.length ? (
            <div className="py-0.5" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
              <Mono size={8}>no other live 20{selDoc.year} world</Mono>
            </div>
          ) : null}
          <div
            className="py-0.5"
            style={{ cursor: "pointer", borderTop: "0.5px solid var(--line-soft)" }}
            onClick={() => {
              dispatch({ t: "recarry", name: selDoc.name, to: "new", via: cfg.label });
              setOpenSlot(null);
            }}
          >
            <Mono size={9} color="var(--cat-kiln)">+ new 20{selDoc.year} world (~90s)</Mono>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── page — three fake plugin headers over one fleet, worlds strip + ledger below ───────────────

function FakePluginHeader({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="mt-3" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
      <div className="flex items-center gap-3 px-2 py-1" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
        <Mono size={10} color="var(--foreground)">{title}</Mono>
        {children}
      </div>
      <div className="px-2 py-1">
        <Mono size={8}>{caption}</Mono>
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

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto flex max-w-5xl px-4 py-4">
        <div className="min-w-0 flex-1 pr-4" style={{ borderRight: "0.5px solid var(--line-2)" }}>
          <Mono size={10}>THE SENTENCE — the target as readable prose; slots are the only choices, the world is narration</Mono>

          <FakePluginHeader
            title="/family"
            caption={`config { verb: "editing", accept: ["rvt","rfa"], families: true } — full grammar; family slot appears only for an open .rvt`}
          >
            <SentenceChip
              cfg={{ verb: "editing", accept: ["rvt", "rfa"], families: true, label: "family" }}
              world={world}
              dispatch={dispatch}
              initialDoc="Tower_A.rvt"
              initialFamily="VAV_Parallel_FanPowered"
            />
          </FakePluginHeader>

          <FakePluginHeader
            title="/schedule-grid"
            caption={`config { verb: "auditing", accept: ["rvt"], families: false } — rvt-only grammar; no family slot ever`}
          >
            <SentenceChip
              cfg={{ verb: "auditing", accept: ["rvt"], families: false, label: "schedule-grid" }}
              world={world}
              dispatch={dispatch}
            />
          </FakePluginHeader>

          <FakePluginHeader
            title="/inspector (unbound)"
            caption={`config { verb: "inspecting", accept: ["rvt","rfa"], families: true } — starts empty: the sentence states the void`}
          >
            <SentenceChip
              cfg={{ verb: "inspecting", accept: ["rvt", "rfa"], families: true, label: "inspector" }}
              world={world}
              dispatch={dispatch}
            />
          </FakePluginHeader>

          {/* WORLDS — thin ops strip so derivations are observable. crash = die without closing docs */}
          <div className="mt-4">
            <Mono size={9}>WORLDS — ops only, never a picking step</Mono>
            <div className="mt-1" style={{ borderTop: "0.5px solid var(--line-2)" }}>
              {world.instances.map((i) => {
                const carried = world.docs.filter((d) => d.openIn === i.id || d.pendingIn === i.id);
                return (
                  <div key={i.id} className="flex items-center gap-2 py-1" style={{ borderBottom: "0.5px solid var(--line-soft)", opacity: i.phase === "dead" ? 0.55 : 1 }}>
                    <span
                      style={{
                        display: "inline-block", width: 5, height: 5, borderRadius: 3, flexShrink: 0,
                        background: i.phase === "live" ? "var(--pe-blue)" : i.phase === "booting" ? "var(--cat-kiln)" : "transparent",
                        border: i.phase === "dead" ? "1px solid var(--cat-clay)" : undefined,
                      }}
                    />
                    <Mono size={9} color="var(--foreground)">{i.id}</Mono>
                    <Mono size={8}>
                      20{i.year} · pid {i.pid} ·{" "}
                      {i.phase === "booting"
                        ? `booting ${Math.round((i.bootProgress ?? 0) * 100)}%`
                        : i.phase === "dead"
                          ? `died ${i.diedAtMs ? age(i.diedAtMs, world.nowMs) : "?"} ago`
                          : carried.length
                            ? `carrying ${carried.map((d) => d.name).join(", ")}`
                            : "idle"}
                    </Mono>
                    <span className="ml-auto flex gap-1" style={{ whiteSpace: "nowrap" }}>
                      {i.phase === "live" ? (
                        <>
                          <button type="button" className="tele px-1.5 py-0.5" style={{ fontSize: 8, borderRadius: 2, cursor: "pointer", border: "0.5px solid var(--cat-clay)", color: "var(--cat-clay)" }} onClick={() => dispatch({ t: "crashInstance", id: i.id })} title="simulate a crash — docs stay pointed at the dead world">
                            crash
                          </button>
                          <button type="button" className="tele px-1.5 py-0.5" style={{ fontSize: 8, borderRadius: 2, cursor: "pointer", border: "0.5px solid var(--line-2)", color: "var(--muted-foreground)" }} onClick={() => dispatch({ t: "stopInstance", id: i.id })}>
                            stop
                          </button>
                        </>
                      ) : i.phase === "dead" ? (
                        <button type="button" className="tele px-1.5 py-0.5" style={{ fontSize: 8, borderRadius: 2, cursor: "pointer", border: "0.5px solid var(--line-2)", color: "var(--muted-foreground)" }} onClick={() => dispatch({ t: "restartInstance", id: i.id })}>
                          restart
                        </button>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* compact ledger */}
        <div className="flex w-56 flex-col pl-3">
          <Mono size={9}>LEDGER</Mono>
          <div ref={logRef} className="mt-1 min-h-0 flex-1 overflow-y-auto" style={{ maxHeight: "88vh" }}>
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
