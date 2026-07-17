import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useReducer, useRef, useState } from "react";

/* ------------------------------------------------------------------------------------------------
 * PROTOTYPE — poc/sentence-chat. Throwaway. Capstone: "THE SENTENCE, TWO POSTURES".
 * One sentence component, two mounts:
 *   CHAT LANE (read-only)  — pea's testimony. No clickable slots, no picker. Pea routes to
 *                            documents; the sentence just narrates: actor + verb-status + target.
 *   PLUGIN HEADER (interactive) — the chip-c grammar intact: doc/family slots stay clickable,
 *                            world stays narration + demoted ⟲, because plugins are human surfaces.
 * A scripted Pea turn (preset prompts or any typed text) drives both coherently: tool lines in
 * chat, real fleet derivation (adopt/queue/declare + boot narration), a kiln proposal landing in
 * the plugin table, approve → stage → commit → both sentences resolve then relax. Mock only.
 * Delete me when promoted.
 * ---------------------------------------------------------------------------------------------- */

export const Route = createFileRoute("/poc/sentence-chat")({ component: Page });

// ── mock world (adapted from poc/chip-c) ────────────────────────────────────────────────────────

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

interface Msg {
  role: "user" | "pea" | "tool";
  text: string;
}

// ── the verb-status grammar — the tiny typed model this prototype exists to prove ──────────────

type Status =
  | { kind: "idle" }
  | { kind: "pea-active"; gerund: string; doc?: string } // "pea is <gerund> [in <world clause>]"
  | { kind: "awaiting-review" } // staged count is derived live from proposals
  | { kind: "committed"; change: string; doc: string; atMs: number }; // relaxes to idle after ~4s

interface Proposal {
  to: string;
  by: "pea" | "you";
  cite: string;
  state: "proposed" | "staged";
}

interface Param {
  name: string;
  value: string;
  proposal?: Proposal;
}

interface World {
  nowMs: number;
  docs: Doc[];
  instances: Inst[];
  events: Ev[];
  chat: Msg[];
  status: Status;
  pluginDoc: string | null;
  pluginFamily: string | null;
  params: Param[];
}

const T0 = 1_800_000_000_000;
const MIN = 60_000;
const HR = 3_600_000;
const DAY = 86_400_000;
const COMMIT_RELAX_MS = 4000;

const TOWER_FAMS: Fam[] = [
  { name: "VAV_Parallel_FanPowered", category: "Mechanical Equipment" },
  { name: "Duct_Transition_RectRound", category: "Duct Fittings" },
  { name: "AHU_RTU_25Ton", category: "Mechanical Equipment" },
  { name: "Grille_Return_24x24", category: "Air Terminals" },
  { name: "Tag_Duct_Size", category: "Duct Tags", excluded: true },
];

const seed: World = {
  nowMs: T0,
  docs: [
    { name: "Tower_A.rvt", kind: "rvt", year: 26, lastOpenedMs: T0 - 6 * MIN, openIn: "user-rrd", families: TOWER_FAMS },
    { name: "AHU_Custom_RTU.rfa", kind: "rfa", year: 26, lastOpenedMs: T0 - 5 * HR },
    { name: "VAV_Box.rfa", kind: "rfa", year: 25, lastOpenedMs: T0 - 9 * MIN },
    { name: "Clinic_Renovation_MEP.rvt", kind: "rvt", year: 25, lastOpenedMs: T0 - 26 * HR, families: TOWER_FAMS },
    { name: "FanCoil_4Pipe_Horizontal.rfa", kind: "rfa", year: 25, lastOpenedMs: T0 - 4 * DAY },
    { name: "Warehouse_Retrofit.rvt", kind: "rvt", year: 24, lastOpenedMs: T0 - 12 * DAY, families: TOWER_FAMS },
  ],
  instances: [{ id: "user-rrd", year: 26, pid: 41220, phase: "live" }],
  events: [{ atMs: T0 - 20 * MIN, actor: "you", text: "open Tower_A.rvt → derived carrier user-rrd" }],
  chat: [{ role: "pea", text: "Ready. Ask me to change something, or point me at a model." }],
  status: { kind: "idle" },
  pluginDoc: null,
  pluginFamily: null,
  params: [
    { name: "Width", value: "24in" },
    { name: "Height", value: "12in" },
    { name: "Inlet Diameter", value: "8in" },
    { name: "Max Airflow", value: "450 CFM" },
    { name: "Pressure Drop", value: "0.32 in-wg" },
  ],
};

type Act =
  | { t: "tick" }
  | { t: "openDoc"; name: string; via: string; actor: Ev["actor"] }
  | { t: "recarry"; name: string; to: string | "new"; via: string }
  | { t: "stopInstance"; id: string }
  | { t: "crashInstance"; id: string }
  | { t: "restartInstance"; id: string }
  | { t: "note"; actor: Ev["actor"]; text: string }
  | { t: "chat"; role: Msg["role"]; text: string }
  | { t: "status"; status: Status }
  | { t: "setPluginTarget"; doc: string | null; family: string | null }
  | { t: "propose"; param: string; to: string; cite: string }
  | { t: "resolveProposal"; param: string; verdict: "approve" | "deny" }
  | { t: "commit" };

let mint = 0;
const NAMES = ["copper", "slate", "amber", "chert", "onyx", "tuff"];

function reduce(w: World, a: Act): World {
  const now = a.t === "tick" ? w.nowMs + 1000 : w.nowMs;
  const ev = (actor: Ev["actor"], text: string): Ev => ({ atMs: now, actor, text });

  if (a.t === "tick") {
    const events: Ev[] = [];
    const instances = w.instances.map((i) => {
      if (i.phase === "booting") {
        // fast boot for demo pacing (~10s instead of ~90s)
        const p = (i.bootProgress ?? 0) + 0.09 + Math.abs(Math.sin(i.pid ?? 1)) * 0.03;
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
    // committed sentences relax back to the resting grammar after a beat
    const status: Status =
      w.status.kind === "committed" && now - w.status.atMs >= COMMIT_RELAX_MS ? { kind: "idle" } : w.status;
    return { ...w, nowMs: now, docs, instances, events: [...w.events, ...events], status };
  }

  if (a.t === "openDoc") {
    const doc = w.docs.find((d) => d.name === a.name);
    if (!doc || doc.openIn || doc.pendingIn) return w;
    const carrier = w.instances.find((i) => i.year === doc.year && i.phase === "live");
    if (carrier) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, openIn: carrier.id, lastOpenedMs: now } : d)),
        events: [...w.events, ev(a.actor, `open ${a.name} → derived carrier ${carrier.id} (20${doc.year} already live) · via ${a.via}`)],
      };
    }
    const incoming = w.instances.find((i) => i.year === doc.year && i.phase === "booting");
    if (incoming) {
      return {
        ...w,
        docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: incoming.id } : d)),
        events: [...w.events, ev(a.actor, `open ${a.name} → queued on ${incoming.id} (already booting) · via ${a.via}`)],
      };
    }
    const id = `sbx-${NAMES[mint++ % NAMES.length]}`;
    return {
      ...w,
      instances: [...w.instances, { id, year: doc.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0 }],
      docs: w.docs.map((d) => (d.name === a.name ? { ...d, pendingIn: id } : d)),
      events: [...w.events, ev(a.actor, `open ${a.name} → no 20${doc.year} world; declaring ${id} + queueing open · via ${a.via}`)],
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
      events: [...w.events, ev("you", `stop ${a.id}${closed.length ? ` — closes ${closed.map((d) => d.name).join(", ")}` : ""}`)],
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
      instances: w.instances.map((i) => (i.id === a.id ? { ...i, phase: "booting", bootProgress: 0, diedAtMs: undefined } : i)),
      events: [...w.events, ev("you", `restart ${a.id}`)],
    };

  if (a.t === "note") return { ...w, events: [...w.events, ev(a.actor, a.text)] };

  if (a.t === "chat") return { ...w, chat: [...w.chat, { role: a.role, text: a.text }] };

  if (a.t === "status") return { ...w, status: a.status };

  if (a.t === "setPluginTarget")
    return { ...w, pluginDoc: a.doc, pluginFamily: a.family };

  if (a.t === "propose") {
    const p = w.params.find((x) => x.name === a.param);
    if (!p) return w;
    return {
      ...w,
      params: w.params.map((x) =>
        x.name === a.param ? { ...x, proposal: { to: a.to, by: "pea" as const, cite: a.cite, state: "proposed" as const } } : x,
      ),
      events: [...w.events, ev("pea", `propose ${a.param}: ${p.value} → ${a.to} (${a.cite})`)],
    };
  }

  if (a.t === "resolveProposal") {
    const p = w.params.find((x) => x.name === a.param);
    if (!p?.proposal) return w;
    if (a.verdict === "deny")
      return {
        ...w,
        params: w.params.map((x) => (x.name === a.param ? { name: x.name, value: x.value } : x)),
        events: [...w.events, ev("you", `deny ${a.param} → ${p.proposal.to}`)],
      };
    return {
      ...w,
      params: w.params.map((x) =>
        x.name === a.param && x.proposal ? { ...x, proposal: { ...x.proposal, state: "staged" as const } } : x,
      ),
      events: [...w.events, ev("you", `approve ${a.param} → ${p.proposal.to} — staged`)],
    };
  }

  if (a.t === "commit") {
    const staged = w.params.filter((p) => p.proposal?.state === "staged");
    if (!staged.length) return w;
    const change = staged.map((p) => `${p.name}=${p.proposal?.to}`).join(", ");
    const doc = w.pluginDoc ?? "?";
    return {
      ...w,
      params: w.params.map((p) => (p.proposal?.state === "staged" ? { name: p.name, value: p.proposal.to } : p)),
      status: { kind: "committed", change, doc, atMs: now },
      events: [
        ...w.events,
        ev("you", `commit ${staged.length} change${staged.length === 1 ? "" : "s"} on ${doc}`),
        ev("bridge", `transaction committed — ${change}`),
      ],
      chat: [...w.chat, { role: "tool", text: `⚙ commit ${change}` }],
    };
  }

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

function Prose({ children, color = "var(--muted-foreground)" }: { children: React.ReactNode; color?: string }) {
  return (
    <span className="tele" style={{ fontSize: 11, color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function derivation(world: World, year: number): { clause: string; cost: string } {
  if (world.instances.some((i) => i.year === year && i.phase === "live"))
    return { clause: `a live 20${year} world`, cost: "opens instantly" };
  if (world.instances.some((i) => i.year === year && i.phase === "booting"))
    return { clause: `a 20${year} world already booting`, cost: "queues the open" };
  return { clause: `a NEW 20${year} world (boots)`, cost: `boots a 20${year} world` };
}

/** World clause as plain text — the chat lane speaks it, never offers it. */
function worldClauseText(world: World, docName: string): string {
  const d = world.docs.find((x) => x.name === docName);
  if (!d) return "";
  const pending = d.pendingIn ? world.instances.find((i) => i.id === d.pendingIn) : undefined;
  const carrier = d.openIn ? world.instances.find((i) => i.id === d.openIn) : undefined;
  if (pending) return ` in a 20${d.year} world that is still booting (${Math.round((pending.bootProgress ?? 0) * 100)}%)`;
  if (carrier?.phase === "booting") return ` in a 20${d.year} world that is still booting (${Math.round((carrier.bootProgress ?? 0) * 100)}%)`;
  if (carrier?.phase === "dead") return " — its world died";
  if (carrier?.phase === "live") return ` in a live 20${d.year} world`;
  return " — no world carries it yet";
}

// ── verb-status grammar: shared phrase derivation for both postures ─────────────────────────────

type StatusTone = "rest" | "pea-active" | "awaiting" | "committed";

const TONE_COLOR: Record<StatusTone, string> = {
  rest: "var(--muted-foreground)",
  "pea-active": "var(--cat-kiln)",
  awaiting: "var(--pe-blue)",
  committed: "var(--pe-blue)",
};

function stagedCount(world: World): number {
  return world.params.filter((p) => p.proposal).length;
}

// ── posture 1: CHAT SENTENCE — pea's testimony, pure status, zero affordance ────────────────────

function ChatSentence({ world }: { world: World }) {
  const s = world.status;
  const n = stagedCount(world);

  let tone: StatusTone = "rest";
  let text: string;
  if (s.kind === "pea-active") {
    tone = "pea-active";
    text = `pea is ${s.gerund}${s.doc ? worldClauseText(world, s.doc) : "…"}`;
  } else if (s.kind === "awaiting-review" && n > 0) {
    tone = "awaiting";
    text = `pea is waiting on your review — ${n} staged`;
  } else if (s.kind === "committed") {
    tone = "committed";
    text = `committed ${s.change} on ${s.doc} · just now`;
  } else if (world.pluginDoc) {
    // resting testimony mirrors the session target — read-only echo of the plugin sentence
    text = `editing ${world.pluginDoc}${worldClauseText(world, world.pluginDoc)}`;
  } else {
    text = "pea is idle — nothing in flight";
  }

  return (
    <div
      className="flex h-7 items-center overflow-hidden px-2"
      style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}
      title="read-only — pea routes to documents; this line is testimony, not a control"
    >
      <span className="truncate tele" style={{ fontSize: 11, color: TONE_COLOR[tone], transition: "color 0.6s" }}>
        {text}
      </span>
    </div>
  );
}

// ── posture 2: PLUGIN SENTENCE — the interactive chip-c grammar, status-aware prefix ────────────

interface ChipCfg {
  verb: string; // resting: "editing …"
  accept: DocKind[];
  families: boolean;
  label: string;
}

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

function PluginSentence({
  cfg,
  world,
  dispatch,
}: {
  cfg: ChipCfg;
  world: World;
  dispatch: React.Dispatch<Act>;
}) {
  const [openSlot, setOpenSlot] = useState<"doc" | "family" | "recarry" | null>(null);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openSlot) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenSlot(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openSlot]);

  const docs = world.docs.filter((d) => cfg.accept.includes(d.kind));
  const selDoc = world.pluginDoc ? docs.find((d) => d.name === world.pluginDoc) : undefined;
  const family = world.pluginFamily;
  const carrier = selDoc?.openIn ? world.instances.find((i) => i.id === selDoc.openIn) : undefined;
  const pending = selDoc?.pendingIn ? world.instances.find((i) => i.id === selDoc.pendingIn) : undefined;
  const wantsFamily = cfg.families && selDoc?.kind === "rvt";
  const otherWorlds = selDoc
    ? world.instances.filter((i) => i.year === selDoc.year && i.phase === "live" && i.id !== selDoc.openIn)
    : [];

  // status-aware prefix — same grammar the chat lane speaks, but the nouns stay clickable
  const n = stagedCount(world);
  const s = world.status;
  const tone: StatusTone =
    s.kind === "committed" ? "committed" : n > 0 ? "awaiting" : s.kind === "pea-active" ? "pea-active" : "rest";
  const prefix =
    s.kind === "committed" ? null : n > 0 ? `reviewing ${n} proposal${n === 1 ? "" : "s"} on` : cfg.verb;

  const pickDoc = (d: Doc) => {
    if (d.name !== selDoc?.name) dispatch({ t: "setPluginTarget", doc: d.name, family: null });
    if (!d.openIn && !d.pendingIn) dispatch({ t: "openDoc", name: d.name, via: cfg.label, actor: "you" });
    setOpenSlot(null);
  };

  const worldClause = (() => {
    if (!selDoc) return null;
    if (pending || carrier?.phase === "booting") {
      const p = pending ?? carrier;
      return <Prose> in a 20{selDoc.year} world that is still booting ({Math.round((p?.bootProgress ?? 0) * 100)}%)</Prose>;
    }
    if (carrier?.phase === "dead") {
      return (
        <>
          <Prose color="var(--cat-clay)"> — its world died · </Prose>
          <button
            type="button"
            className="tele"
            style={{ fontSize: 11, padding: 0, cursor: "pointer", background: "transparent", border: "none", borderBottom: "0.5px solid var(--cat-clay)", borderRadius: 0, color: "var(--cat-clay)" }}
            onClick={() => dispatch({ t: "restartInstance", id: carrier.id })}
          >
            restart?
          </button>
        </>
      );
    }
    if (carrier?.phase === "live") {
      return (
        <>
          <Prose> in a live 20{selDoc.year} world</Prose>
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

  return (
    <div ref={rootRef} className="relative inline-block min-w-0 flex-1">
      <div className="flex h-7 items-center overflow-hidden px-2" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
        <span className="flex items-baseline gap-1 truncate" style={{ whiteSpace: "nowrap" }}>
          {s.kind === "committed" ? (
            <Prose color={TONE_COLOR.committed}>
              committed {s.change} on {s.doc} · just now
            </Prose>
          ) : !selDoc ? (
            <>
              <Prose>nothing open — </Prose>
              <Slot text={null} placeholder="pick a document" open={openSlot === "doc"} onClick={() => setOpenSlot(openSlot === "doc" ? null : "doc")} />
              <Prose> to begin</Prose>
            </>
          ) : (
            <>
              <Prose color={TONE_COLOR[tone]}>{prefix} </Prose>
              {wantsFamily ? (
                <>
                  <Slot text={family} placeholder="pick a family" open={openSlot === "family"} onClick={() => setOpenSlot(openSlot === "family" ? null : "family")} />
                  <Prose> from </Prose>
                </>
              ) : null}
              <Slot text={selDoc.name} placeholder="pick a document" open={openSlot === "doc"} onClick={() => setOpenSlot(openSlot === "doc" ? null : "doc")} />
              {worldClause}
            </>
          )}
        </span>
      </div>

      {/* doc slot picker — mini recents list with derivation-cost subtitles */}
      {openSlot === "doc" ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-80 px-2 py-1"
          style={{ border: "0.5px solid var(--line-2)", background: "var(--background)", borderRadius: 2, boxShadow: "0 2px 8px color-mix(in srgb, var(--foreground) 8%, transparent)" }}
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
                    const isSel = d.name === selDoc?.name;
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

      {/* family slot picker */}
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
                      dispatch({ t: "setPluginTarget", doc: selDoc.name, family: f.name });
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

      {/* re-carry popover — demoted escape hatch behind ⟲ */}
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
            <Mono size={9} color="var(--cat-kiln)">+ new 20{selDoc.year} world</Mono>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── the scripted Pea turns ──────────────────────────────────────────────────────────────────────

interface Step {
  delayMs: number;
  waitFor?: (w: World) => boolean;
  run: (d: React.Dispatch<Act>, w: World) => void;
}

const docLive = (name: string) => (w: World) => {
  const d = w.docs.find((x) => x.name === name);
  return !!d?.openIn && w.instances.some((i) => i.id === d.openIn && i.phase === "live");
};

/** "make the VAV box 27in wide" — full loop: route → derive world → propose → review → commit */
function vavScript(userText: string): Step[] {
  return [
    {
      delayMs: 0,
      run: (d) => {
        d({ t: "chat", role: "user", text: userText });
        d({ t: "status", status: { kind: "pea-active", gerund: "finding the right document" } });
      },
    },
    {
      delayMs: 900,
      run: (d) => d({ t: "chat", role: "tool", text: `⚙ recents.search "vav" → VAV_Box.rfa (opened 9m ago)` }),
    },
    {
      delayMs: 900,
      run: (d) => {
        d({ t: "chat", role: "tool", text: "⚙ open VAV_Box.rfa" });
        d({ t: "setPluginTarget", doc: "VAV_Box.rfa", family: null });
        d({ t: "openDoc", name: "VAV_Box.rfa", via: "pea", actor: "pea" });
        d({ t: "status", status: { kind: "pea-active", gerund: "opening VAV_Box.rfa", doc: "VAV_Box.rfa" } });
      },
    },
    {
      delayMs: 600,
      waitFor: docLive("VAV_Box.rfa"),
      run: (d) => {
        d({ t: "chat", role: "tool", text: "⚙ propose familyParameters/Width = 27in" });
        d({ t: "propose", param: "Width", to: "27in", cite: "cites p.3" });
        d({ t: "status", status: { kind: "pea-active", gerund: "staging a proposal on VAV_Box.rfa", doc: "VAV_Box.rfa" } });
      },
    },
    {
      delayMs: 1000,
      run: (d) => {
        d({ t: "chat", role: "pea", text: "Proposed Width 27in from the submittal. Review in the family editor." });
        d({ t: "status", status: { kind: "awaiting-review" } });
      },
    },
  ];
}

/** "audit the clinic model" — rvt-only, chat-lane only, zero plugin involvement, no proposal */
function auditScript(userText: string): Step[] {
  return [
    {
      delayMs: 0,
      run: (d) => {
        d({ t: "chat", role: "user", text: userText });
        d({ t: "status", status: { kind: "pea-active", gerund: "finding the right document" } });
      },
    },
    {
      delayMs: 900,
      run: (d) => d({ t: "chat", role: "tool", text: `⚙ recents.search "clinic" → Clinic_Renovation_MEP.rvt` }),
    },
    {
      delayMs: 900,
      run: (d) => {
        d({ t: "chat", role: "tool", text: "⚙ open Clinic_Renovation_MEP.rvt" });
        d({ t: "openDoc", name: "Clinic_Renovation_MEP.rvt", via: "pea", actor: "pea" });
        d({ t: "status", status: { kind: "pea-active", gerund: "reading Clinic_Renovation_MEP.rvt", doc: "Clinic_Renovation_MEP.rvt" } });
      },
    },
    {
      delayMs: 600,
      waitFor: docLive("Clinic_Renovation_MEP.rvt"),
      run: (d) => {
        d({ t: "chat", role: "tool", text: "⚙ audit schedules · 14 schedules, 3 checks" });
        d({ t: "status", status: { kind: "pea-active", gerund: "auditing Clinic_Renovation_MEP.rvt", doc: "Clinic_Renovation_MEP.rvt" } });
      },
    },
    {
      delayMs: 1600,
      run: (d) => {
        d({ t: "chat", role: "pea", text: "Audit done — 2 duct schedules are missing a pressure-class column. Nothing proposed; read-only pass." });
        d({ t: "note", actor: "pea", text: "audit Clinic_Renovation_MEP.rvt complete — 2 flags, 0 proposals" });
        d({ t: "status", status: { kind: "idle" } });
      },
    },
  ];
}

// ── page ────────────────────────────────────────────────────────────────────────────────────────

const PRESETS = ["make the VAV box 27in wide", "audit the clinic model"];

function Page() {
  const [world, dispatch] = useReducer(reduce, seed);
  const worldRef = useRef(world);
  worldRef.current = world;
  const busyRef = useRef(false);
  const [input, setInput] = useState("");

  useEffect(() => {
    const t = setInterval(() => dispatch({ t: "tick" }), 1000);
    return () => clearInterval(t);
  }, []);

  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [world.chat.length]);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [world.events.length]);

  const runScript = (steps: Step[]) => {
    busyRef.current = true;
    let i = 0;
    const next = () => {
      if (i >= steps.length) {
        busyRef.current = false;
        return;
      }
      const s = steps[i];
      window.setTimeout(function poll() {
        if (s.waitFor && !s.waitFor(worldRef.current)) {
          window.setTimeout(poll, 300);
          return;
        }
        s.run(dispatch, worldRef.current);
        i++;
        next();
      }, s.delayMs);
    };
    next();
  };

  const submit = (text: string) => {
    const t = text.trim();
    if (!t) return;
    setInput("");
    if (busyRef.current) {
      dispatch({ t: "chat", role: "user", text: t });
      dispatch({ t: "chat", role: "pea", text: "One moment — mid-turn. I'll pick this up next." });
      return;
    }
    runScript(t.toLowerCase().includes("audit") ? auditScript(t) : vavScript(t));
  };

  const hasStaged = world.params.some((p) => p.proposal?.state === "staged");

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto flex h-screen max-w-6xl flex-col px-4 py-3">
        <div className="pb-2">
          <Mono size={9} color="var(--cat-clay)">PROTOTYPE — throwaway · </Mono>
          <Mono size={9}>THE SENTENCE, TWO POSTURES — chat lane is testimony (read-only); plugin header keeps the slots</Mono>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* ── CHAT PANE — read-only sentence, messages, input ── */}
          <div className="flex w-96 flex-shrink-0 flex-col pr-3" style={{ borderRight: "0.5px solid var(--line-2)" }}>
            <div className="pb-1">
              <Mono size={9}>PEA CHAT · sentence is status only — pea routes, you never pick here</Mono>
            </div>
            <ChatSentence world={world} />

            <div ref={chatRef} className="mt-1 min-h-0 flex-1 overflow-y-auto">
              {world.chat.map((m, idx) =>
                m.role === "tool" ? (
                  <div key={idx} className="py-0.5 pl-2">
                    <Mono size={9} color="var(--cat-kiln)">{m.text}</Mono>
                  </div>
                ) : (
                  <div key={idx} className="py-1" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                    <Mono size={8} color={m.role === "pea" ? "var(--cat-kiln)" : "var(--foreground)"}>{m.role}</Mono>
                    <div style={{ fontSize: 11.5, color: "var(--foreground)" }}>{m.text}</div>
                  </div>
                ),
              )}
            </div>

            <div className="flex gap-1 pb-1 pt-1">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="tele px-1.5 py-0.5"
                  style={{ fontSize: 9, borderRadius: 2, cursor: "pointer", border: "0.5px solid var(--line-2)", color: "var(--muted-foreground)" }}
                  onClick={() => submit(p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit(input);
              }}
              placeholder="ask pea…"
              className="tele w-full px-2 py-1"
              style={{ fontSize: 11, borderRadius: 2, border: "0.5px solid var(--line-2)", background: "transparent", color: "var(--foreground)", outline: "none" }}
            />
          </div>

          {/* ── PLUGIN PANE — interactive sentence + parameter table ── */}
          <div className="flex min-w-0 flex-1 flex-col pl-3">
            <div className="pb-1">
              <Mono size={9}>/family · FAMILY EDITOR — plugin surface: the slots stay clickable</Mono>
            </div>
            <div className="flex items-center gap-2">
              <PluginSentence
                cfg={{ verb: "editing", accept: ["rvt", "rfa"], families: true, label: "family" }}
                world={world}
                dispatch={dispatch}
              />
              {hasStaged ? (
                <button
                  type="button"
                  className="tele h-7 flex-shrink-0 px-2"
                  style={{ fontSize: 10, borderRadius: 2, cursor: "pointer", border: "0.5px solid var(--pe-blue)", color: "var(--pe-blue)", background: "color-mix(in srgb, var(--pe-blue) 6%, transparent)" }}
                  onClick={() => dispatch({ t: "commit" })}
                >
                  commit {world.params.filter((p) => p.proposal?.state === "staged").length}
                </button>
              ) : null}
            </div>

            {/* parameter table */}
            <div className="mt-2">
              <div className="flex items-baseline gap-2 pb-0.5">
                <Mono size={8} color="var(--foreground)">FAMILY PARAMETERS</Mono>
                <Mono size={8}>{world.pluginDoc ?? "no document"}</Mono>
              </div>
              <div style={{ borderTop: "0.5px solid var(--line-2)" }}>
                {world.params.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 py-1" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                    <span className="w-28 flex-shrink-0 truncate" style={{ fontSize: 11, color: "var(--foreground)" }}>{p.name}</span>
                    <Mono size={9} color="var(--foreground)">{p.value}</Mono>
                    <span className="ml-auto flex items-center gap-1.5">
                      {p.proposal ? (
                        <>
                          <span
                            className="tele px-1.5 py-0.5"
                            style={{
                              fontSize: 9, borderRadius: 2,
                              border: `0.5px solid ${p.proposal.state === "staged" ? "var(--pe-blue)" : "var(--cat-kiln)"}`,
                              color: p.proposal.state === "staged" ? "var(--pe-blue)" : "var(--cat-kiln)",
                              background: `color-mix(in srgb, ${p.proposal.state === "staged" ? "var(--pe-blue)" : "var(--cat-kiln)"} 6%, transparent)`,
                            }}
                          >
                            {p.proposal.state === "staged"
                              ? `staged → ${p.proposal.to} · will commit`
                              : `${p.value} → ${p.proposal.to} · ${p.proposal.by} · ${p.proposal.cite}`}
                          </span>
                          {p.proposal.state === "proposed" ? (
                            <>
                              <button
                                type="button"
                                title="approve — stages the change"
                                className="tele px-1 py-0.5"
                                style={{ fontSize: 9, borderRadius: 2, cursor: "pointer", border: "0.5px solid var(--pe-blue)", color: "var(--pe-blue)" }}
                                onClick={() => dispatch({ t: "resolveProposal", param: p.name, verdict: "approve" })}
                              >
                                ✓
                              </button>
                              <button
                                type="button"
                                title="deny — discards the proposal"
                                className="tele px-1 py-0.5"
                                style={{ fontSize: 9, borderRadius: 2, cursor: "pointer", border: "0.5px solid var(--cat-clay)", color: "var(--cat-clay)" }}
                                onClick={() => dispatch({ t: "resolveProposal", param: p.name, verdict: "deny" })}
                              >
                                ✕
                              </button>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <Mono size={8}>—</Mono>
                      )}
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-1">
                <Mono size={8}>mock parameters — proposals land here from pea's chat turn; approve stages, commit writes</Mono>
              </div>
            </div>
          </div>
        </div>

        {/* ── BOTTOM STRIP — worlds + ledger ── */}
        <div className="flex flex-shrink-0 pt-2" style={{ borderTop: "0.5px solid var(--line-2)" }}>
          <div className="min-w-0 flex-1 pr-3" style={{ borderRight: "0.5px solid var(--line-2)" }}>
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

          {/* ledger stays its own lane: chat is pea's conversational surface; bridge/derivation
              events are fleet truth and belong to a neutral ledger, not to the dialogue */}
          <div className="flex w-56 flex-shrink-0 flex-col pl-3">
            <Mono size={9}>LEDGER</Mono>
            <div ref={logRef} className="mt-1 min-h-0 overflow-y-auto" style={{ maxHeight: 160 }}>
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
    </div>
  );
}
