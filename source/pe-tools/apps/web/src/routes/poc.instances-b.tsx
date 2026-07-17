import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

/* ------------------------------------------------------------------------------------------------
 * PROTOTYPE — poc/instances-b. Throwaway. Concept B "THE ITINERARY": compose the whole target
 * (session → project → family) as a staged plan on a transit-ticket route line, see the
 * consequences (steps + ETA) before committing, then COMMIT once and watch the mock reducer
 * execute the plan step by step. Fleet is demoted to a thin strip; ledger is a compact column.
 * Mock in-memory only; no host calls. Delete me when a winner is promoted.
 * ---------------------------------------------------------------------------------------------- */

export const Route = createFileRoute("/poc/instances-b")({ component: Page });

// ── mock world ─────────────────────────────────────────────────────────────────────────────────

type Phase = "booting" | "live" | "unresponsive" | "stopping" | "dead";
type Kind = "rrd" | "sandbox";

interface Inst {
  id: string;
  kind: Kind;
  year: number;
  pid?: number;
  phase: Phase;
  bootProgress?: number;
  docs: string[];
  observedAtMs: number;
}

interface Ev {
  atMs: number;
  actor: "you" | "pea" | "bridge";
  text: string;
}

interface RecentDoc {
  name: string;
  year: number;
  kind: "rvt" | "rfa";
}

interface Fam {
  name: string;
  category: string;
}

// plan execution state, driven by the reducer tick
interface PlanStep {
  label: string;
  status: "pending" | "running" | "done";
}

interface RunningPlan {
  instId: string;
  needsBoot: boolean;
  doc?: string; // .rvt to open (undefined = straight to family editor)
  docOpened: boolean;
  family: string;
  familyOpened: boolean;
  steps: PlanStep[];
}

interface World {
  nowMs: number;
  instances: Inst[];
  events: Ev[];
  plan?: RunningPlan;
  // set once a plan finishes — the "current position" card
  position?: { instId: string; doc?: string; family: string };
}

const T0 = 1_800_000_000_000;

const seed: World = {
  nowMs: T0,
  instances: [
    { id: "user-rrd", kind: "rrd", year: 26, pid: 41220, phase: "live", docs: ["Tower_A.rvt"], observedAtMs: T0 - 4_000 },
    { id: "sbx-quartz", kind: "sandbox", year: 25, pid: 50912, phase: "live", docs: ["Central_Plant.rvt"], observedAtMs: T0 - 11_000 },
    { id: "sbx-flint", kind: "sandbox", year: 24, pid: 49001, phase: "unresponsive", docs: [], observedAtMs: T0 - 97_000 },
  ],
  events: [
    { atMs: T0 - 320_000, actor: "you", text: "start sandbox sbx-quartz (2025)" },
    { atMs: T0 - 120_000, actor: "pea", text: "start sandbox sbx-flint (2024) via pe_sandbox" },
    { atMs: T0 - 97_000, actor: "bridge", text: "sbx-flint stopped answering — unresponsive" },
  ],
};

const RECENT_DOCS: RecentDoc[] = [
  { name: "Tower_A.rvt", year: 26, kind: "rvt" },
  { name: "Central_Plant.rvt", year: 25, kind: "rvt" },
  { name: "Hospital_L2_Mech.rvt", year: 25, kind: "rvt" },
  { name: "Data_Center_CRAH.rvt", year: 24, kind: "rvt" },
  { name: "Lab_Exhaust_Riser.rvt", year: 25, kind: "rvt" },
  { name: "Chiller_Yard.rvt", year: 26, kind: "rvt" },
  { name: "VAV_Box.rfa", year: 25, kind: "rfa" },
  { name: "FCU_Horizontal.rfa", year: 24, kind: "rfa" },
  { name: "AHU_Custom_30k.rfa", year: 25, kind: "rfa" },
  { name: "Grille_Supply_24x24.rfa", year: 26, kind: "rfa" },
];

// families "loaded in" a chosen project (mock — same list for any project, plausible MEP)
const LOADED_FAMILIES: Fam[] = [
  { name: "VAV_Box", category: "Mechanical Equipment" },
  { name: "FCU_Horizontal", category: "Mechanical Equipment" },
  { name: "AHU_Custom_30k", category: "Mechanical Equipment" },
  { name: "Grille_Supply_24x24", category: "Air Terminals" },
  { name: "Diffuser_Linear_48", category: "Air Terminals" },
  { name: "Pump_EndSuction_5HP", category: "Mechanical Equipment" },
  { name: "Valve_Balancing_2in", category: "Pipe Accessories" },
  { name: "Damper_Fire_Smoke", category: "Duct Accessories" },
  { name: "Elec_Panel_480V", category: "Electrical Equipment" },
  { name: "Fixture_WC_Wall", category: "Plumbing Fixtures" },
];

// ── reducer ────────────────────────────────────────────────────────────────────────────────────

type Act =
  | { t: "tick" }
  | { t: "commit"; session: SessionChoice; doc?: string; family: string }
  | { t: "newItinerary" };

interface SessionChoice {
  mode: "existing" | "new";
  instId?: string; // existing
  year: number;
}

let mint = 0;
const NAMES = ["copper", "slate", "amber", "chert", "onyx", "tuff"];

function markStep(steps: PlanStep[], label: string, status: PlanStep["status"]): PlanStep[] {
  return steps.map((s) => (s.label === label ? { ...s, status } : s));
}

function reduce(w: World, a: Act): World {
  const now = a.t === "tick" ? w.nowMs + 1000 : w.nowMs;
  const ev = (actor: Ev["actor"], text: string): Ev => ({ atMs: now, actor, text });

  if (a.t === "newItinerary") return { ...w, position: undefined };

  if (a.t === "commit") {
    let instId: string;
    let instances = w.instances;
    let needsBoot = false;
    const events: Ev[] = [];

    if (a.session.mode === "new") {
      instId = `sbx-${NAMES[mint++ % NAMES.length]}`;
      needsBoot = true;
      instances = [
        ...instances,
        { id: instId, kind: "sandbox", year: a.session.year, pid: 52000 + mint * 7, phase: "booting", bootProgress: 0, docs: [], observedAtMs: now },
      ];
      events.push(ev("you", `commit itinerary — boot ${instId} (20${a.session.year})`));
    } else {
      instId = a.session.instId!;
      events.push(ev("you", `commit itinerary — reuse ${instId}`));
    }

    const steps: PlanStep[] = [
      { label: needsBoot ? `boot 20${a.session.year} world` : `attach ${instId}`, status: needsBoot ? "running" : "done" },
      ...(a.doc ? [{ label: `open ${a.doc}`, status: "pending" as const }] : []),
      { label: `edit ${a.family}`, status: "pending" as const },
    ];

    return {
      ...w,
      instances,
      events: [...w.events, ...events],
      position: undefined,
      plan: { instId, needsBoot, doc: a.doc, docOpened: false, family: a.family, familyOpened: false, steps },
    };
  }

  // tick
  let instances = w.instances.map((i) => {
    if (i.phase === "booting") {
      // itinerary boots run hot for demo (~15s), background idiom kept from poc.instances
      const p = (i.bootProgress ?? 0) + 0.06 + Math.abs(Math.sin(i.pid ?? 1)) * 0.02;
      return p >= 1
        ? { ...i, phase: "live" as Phase, bootProgress: undefined, observedAtMs: now }
        : { ...i, bootProgress: p };
    }
    if (i.phase === "live" && Math.random() < 0.25) return { ...i, observedAtMs: now };
    return i;
  });
  const boots = instances.filter((i, idx) => i.phase === "live" && w.instances[idx]?.phase === "booting");
  let events = [...w.events, ...boots.map((b) => ev("bridge", `${b.id} is live (pid ${b.pid})`))];

  let plan = w.plan;
  let position = w.position;

  if (plan) {
    const inst = instances.find((i) => i.id === plan!.instId);
    if (inst?.phase === "live") {
      if (plan.needsBoot && plan.steps[0]?.status === "running") {
        plan = { ...plan, steps: markStep(plan.steps, plan.steps[0].label, "done") };
      }
      if (plan.doc && !plan.docOpened) {
        // one tick to "open" the doc after the world is live
        const label = `open ${plan.doc}`;
        if (plan.steps.find((s) => s.label === label)?.status === "pending") {
          plan = { ...plan, steps: markStep(plan.steps, label, "running") };
        } else {
          plan = { ...plan, docOpened: true, steps: markStep(plan.steps, label, "done") };
          instances = instances.map((i) => (i.id === plan!.instId && !i.docs.includes(plan!.doc!) ? { ...i, docs: [...i.docs, plan!.doc!] } : i));
          events = [...events, ev("bridge", `${plan.doc} open in ${plan.instId}`)];
        }
      } else if ((!plan.doc || plan.docOpened) && !plan.familyOpened) {
        const label = `edit ${plan.family}`;
        if (plan.steps.find((s) => s.label === label)?.status === "pending") {
          plan = { ...plan, steps: markStep(plan.steps, label, "running") };
        } else {
          plan = { ...plan, familyOpened: true, steps: markStep(plan.steps, label, "done") };
          const famDoc = `${plan.family}.rfa`;
          instances = instances.map((i) => (i.id === plan!.instId && !i.docs.includes(famDoc) ? { ...i, docs: [...i.docs, famDoc] } : i));
          events = [...events, ev("bridge", `family editor: ${plan.family} in ${plan.instId}`)];
        }
      }
      if (plan.familyOpened) {
        position = { instId: plan.instId, doc: plan.doc, family: plan.family };
        events = [...events, ev("pea", `arrived — editing ${plan.family}${plan.doc ? ` via ${plan.doc}` : ""}`)];
        plan = undefined;
      }
    }
  }

  return { ...w, nowMs: now, instances, events, plan, position };
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

// ── itinerary draft (UI state, not reducer state) ─────────────────────────────────────────────

interface Draft {
  session?: SessionChoice;
  doc?: string | null; // undefined = unset, null = explicitly "none — straight to family editor"
  family?: string;
}

type SlotId = "session" | "project" | "family";

// consequence math — mock ETAs
const ETA = { boot: 90, openDoc: 20, attach: 5, editFam: 5 };

function draftConsequence(d: Draft, instances: Inst[]): { lines: string[]; totalS: number; conflict?: string } {
  if (!d.session || d.doc === undefined || !d.family) return { lines: ["complete all three stops to see the plan"], totalS: 0 };
  const lines: string[] = [];
  let total = 0;
  const inst = d.session.mode === "existing" ? instances.find((i) => i.id === d.session!.instId) : undefined;

  if (d.session.mode === "new") {
    lines.push(`boot 20${d.session.year} world (~${ETA.boot}s)`);
    total += ETA.boot;
  } else {
    lines.push(`attach ${d.session.instId} — already live (~${ETA.attach}s)`);
    total += ETA.attach;
  }

  let conflict: string | undefined;
  if (d.doc) {
    const doc = RECENT_DOCS.find((r) => r.name === d.doc);
    if (doc && doc.year > d.session.year) {
      conflict = `⚠ ${d.doc} is a 20${doc.year} model — a 20${d.session.year} session cannot open it. fix: pick a 20${doc.year}+ session, or expect an upgrade prompt.`;
    } else if (doc && doc.year < d.session.year) {
      conflict = `⚠ ${d.doc} is 20${doc.year} — opening in 20${d.session.year} will UPGRADE it (one-way).`;
    }
    if (inst?.docs.includes(d.doc)) {
      lines.push(`${d.doc} already open — no wait`);
    } else {
      lines.push(`open ${d.doc} (~${ETA.openDoc}s)`);
      total += ETA.openDoc;
    }
  } else {
    lines.push("no project — straight to family editor");
  }

  lines.push(`edit ${d.family} (~${ETA.editFam}s)`);
  total += ETA.editFam;

  return { lines, totalS: total, conflict };
}

function fmtTotal(s: number): string {
  return s >= 60 ? `~${Math.round(s / 30) / 2}m` : `~${s}s`;
}

// ── page ───────────────────────────────────────────────────────────────────────────────────────

function Page() {
  const [world, dispatch] = useReducer(reduce, seed);
  useEffect(() => {
    const t = setInterval(() => dispatch({ t: "tick" }), 1000);
    return () => clearInterval(t);
  }, []);

  const [draft, setDraft] = useState<Draft>({});
  const [open, setOpen] = useState<SlotId | null>("session");

  const live = world.instances.filter((i) => i.phase === "live");
  const executing = !!world.plan;
  const arrived = !!world.position;

  const cons = useMemo(() => draftConsequence(draft, world.instances), [draft, world.instances]);
  const ready = !!draft.session && draft.doc !== undefined && !!draft.family && !executing;

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [world.events.length]);

  const commit = () => {
    if (!ready || !draft.session || !draft.family) return;
    dispatch({ t: "commit", session: draft.session, doc: draft.doc ?? undefined, family: draft.family });
    setOpen(null);
  };

  const reset = () => {
    dispatch({ t: "newItinerary" });
    setDraft({});
    setOpen("session");
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div className="mx-auto flex max-w-5xl gap-0 px-4 py-4">
        {/* left — itinerary + fleet strip */}
        <div className="flex-1 pr-4" style={{ borderRight: "0.5px solid var(--line-2)" }}>
          <div className="pb-1">
            <Mono size={10}>THE ITINERARY — declare where you want to be, commit once</Mono>
          </div>

          {arrived && world.position ? (
            <PositionCard pos={world.position} onNew={reset} />
          ) : executing && world.plan ? (
            <ExecutingCard plan={world.plan} instances={world.instances} />
          ) : (
            <>
              <Ticket
                draft={draft}
                open={open}
                setOpen={setOpen}
                setDraft={setDraft}
                live={live}
                conflict={cons.conflict}
              />
              {/* consequences footer */}
              <div className="mt-3 px-2 py-1.5" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
                <Mono size={9}>will: {cons.lines.join(" → ")}{cons.totalS ? ` → total ${fmtTotal(cons.totalS)}` : ""}</Mono>
                {cons.conflict ? (
                  <div className="mt-1">
                    <Mono size={9} color="var(--cat-clay)">{cons.conflict}</Mono>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={commit}
                disabled={!ready}
                className="tele mt-3 w-full py-1.5"
                style={{
                  fontSize: 10, borderRadius: 2, cursor: ready ? "pointer" : "default",
                  border: `0.5px solid ${ready ? "var(--pe-blue)" : "var(--line-2)"}`,
                  color: ready ? "var(--pe-blue)" : "var(--muted-foreground)",
                  opacity: ready ? 1 : 0.6, letterSpacing: "0.1em",
                }}
              >
                COMMIT {ready && cons.totalS ? `· ${fmtTotal(cons.totalS)}` : ""}
              </button>
            </>
          )}

          {/* fleet — demoted to a thin strip */}
          <div className="mt-4 pb-1">
            <Mono size={9}>FLEET</Mono>
          </div>
          {world.instances
            .filter((i) => i.phase !== "dead")
            .map((i) => (
              <div key={i.id} className="flex items-center gap-2 py-1" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
                <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 3, background: PHASE_COLOR[i.phase], flexShrink: 0 }} />
                <Mono size={9} color="var(--foreground)">{i.kind === "rrd" ? "your Revit (rrd)" : i.id}</Mono>
                <Mono size={8}>20{i.year}</Mono>
                <Mono size={8} color={PHASE_COLOR[i.phase]}>
                  {i.phase}{i.phase === "booting" ? ` ${Math.round((i.bootProgress ?? 0) * 100)}%` : ""}
                </Mono>
                <Mono size={8}>{i.docs.length ? i.docs.join(", ") : "no docs"}</Mono>
                <span className="ml-auto">
                  <Mono size={8}>seen {age(i.observedAtMs, world.nowMs)} ago</Mono>
                </span>
              </div>
            ))}
        </div>

        {/* ledger — compact right column */}
        <div ref={logRef} className="w-64 overflow-y-auto pl-4" style={{ maxHeight: "92vh" }}>
          <div className="pb-1">
            <Mono size={9}>LEDGER</Mono>
          </div>
          {world.events.map((e, idx) => (
            <div key={idx} className="py-1" style={{ borderTop: "0.5px solid var(--line-soft)" }}>
              <Mono size={8} color={e.actor === "pea" ? "var(--cat-kiln)" : e.actor === "bridge" ? "var(--pe-blue)" : "var(--foreground)"}>
                {e.actor}
              </Mono>
              <div style={{ fontSize: 10, color: "var(--foreground)", lineHeight: 1.3 }}>{e.text}</div>
              <Mono size={8}>{age(e.atMs, world.nowMs)} ago</Mono>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── the ticket ─────────────────────────────────────────────────────────────────────────────────

function Ticket({
  draft, open, setOpen, setDraft, live, conflict,
}: {
  draft: Draft;
  open: SlotId | null;
  setOpen: (s: SlotId | null) => void;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  live: Inst[];
  conflict?: string;
}) {
  const sessionLabel = draft.session
    ? draft.session.mode === "existing"
      ? `${draft.session.instId} · 20${draft.session.year} · live`
      : `new 20${draft.session.year} world — will boot ~${ETA.boot}s`
    : "choose a session";
  const projectLabel = draft.doc === undefined ? "choose a project (or skip)" : draft.doc === null ? "none — straight to family editor" : draft.doc;
  const familyLabel = draft.family ?? "choose a family";

  return (
    <div style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }} className="px-3 py-2">
      <Stop
        id="session" label="SESSION" value={sessionLabel} filled={!!draft.session} last={false}
        open={open === "session"} onToggle={() => setOpen(open === "session" ? null : "session")}
        conflicted={false}
      >
        <SessionPicker
          live={live}
          onPick={(s) => {
            setDraft((d) => ({ ...d, session: s }));
            setOpen("project");
          }}
        />
      </Stop>
      <Stop
        id="project" label="PROJECT" value={projectLabel} filled={draft.doc !== undefined} last={false}
        open={open === "project"} onToggle={() => setOpen(open === "project" ? null : "project")}
        conflicted={!!conflict}
      >
        <ProjectPicker
          onPick={(doc) => {
            setDraft((d) => ({ ...d, doc }));
            setOpen("family");
          }}
        />
      </Stop>
      <Stop
        id="family" label="FAMILY" value={familyLabel} filled={!!draft.family} last
        open={open === "family"} onToggle={() => setOpen(open === "family" ? null : "family")}
        conflicted={false}
      >
        <FamilyPicker
          hasProject={!!draft.doc}
          onPick={(f) => {
            setDraft((d) => ({ ...d, family: f }));
            setOpen(null);
          }}
        />
      </Stop>
    </div>
  );
}

function Stop({
  label, value, filled, last, open, onToggle, conflicted, children,
}: {
  id: SlotId;
  label: string;
  value: string;
  filled: boolean;
  last: boolean;
  open: boolean;
  onToggle: () => void;
  conflicted: boolean;
  children: React.ReactNode;
}) {
  const dotColor = conflicted ? "var(--cat-clay)" : filled ? "var(--pe-blue)" : "var(--line-2)";
  return (
    <div className="flex gap-3">
      {/* route line */}
      <div className="flex flex-col items-center" style={{ width: 10, paddingTop: 5 }}>
        <span
          style={{
            display: "inline-block", width: 8, height: 8, borderRadius: 4, flexShrink: 0,
            background: filled && !conflicted ? dotColor : "transparent",
            border: `1px solid ${dotColor}`,
          }}
        />
        {!last ? (
          <span style={{ width: 0, flex: 1, borderLeft: `1px ${conflicted ? "dashed var(--cat-clay)" : "solid var(--line-2)"}`, minHeight: 12 }} />
        ) : null}
      </div>
      {/* slot */}
      <div className="min-w-0 flex-1 pb-2">
        <button type="button" onClick={onToggle} className="flex w-full items-baseline gap-2 py-0.5 text-left" style={{ cursor: "pointer" }}>
          <Mono size={8} color={conflicted ? "var(--cat-clay)" : "var(--muted-foreground)"}>{label}</Mono>
          <span style={{ fontSize: 12, color: filled ? "var(--foreground)" : "var(--muted-foreground)" }}>{value}</span>
          <span className="ml-auto">
            <Mono size={8}>{open ? "▴" : "▾"}</Mono>
          </span>
        </button>
        {open ? (
          <div className="mt-1" style={{ border: "0.5px solid var(--line-soft)", borderRadius: 2 }}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── pickers ────────────────────────────────────────────────────────────────────────────────────

function PickerRow({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-baseline gap-2 px-2 py-1 text-left"
      style={{ cursor: "pointer", borderTop: "0.5px solid var(--line-soft)" }}
    >
      {children}
    </button>
  );
}

function SessionPicker({ live, onPick }: { live: Inst[]; onPick: (s: SessionChoice) => void }) {
  return (
    <div>
      {live.map((i) => (
        <PickerRow key={i.id} onClick={() => onPick({ mode: "existing", instId: i.id, year: i.year })}>
          <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 3, background: "var(--pe-blue)" }} />
          <span style={{ fontSize: 11, color: "var(--foreground)" }}>{i.kind === "rrd" ? "your Revit (rrd)" : i.id}</span>
          <Mono size={8}>20{i.year} · live · {i.docs.length ? i.docs.join(", ") : "empty"}</Mono>
        </PickerRow>
      ))}
      {YEARS.map((y) => (
        <PickerRow key={y} onClick={() => onPick({ mode: "new", year: y })}>
          <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: 3, border: "1px dashed var(--cat-kiln)" }} />
          <span style={{ fontSize: 11, color: "var(--foreground)" }}>new 20{y} world</span>
          <Mono size={8} color="var(--cat-kiln)">will boot ~{ETA.boot}s</Mono>
        </PickerRow>
      ))}
    </div>
  );
}

function ProjectPicker({ onPick }: { onPick: (doc: string | null) => void }) {
  return (
    <div>
      <PickerRow onClick={() => onPick(null)}>
        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>none — straight to family editor</span>
      </PickerRow>
      {RECENT_DOCS.filter((d) => d.kind === "rvt").map((d) => (
        <PickerRow key={d.name} onClick={() => onPick(d.name)}>
          <span style={{ fontSize: 11, color: "var(--foreground)" }}>{d.name}</span>
          <Mono size={8}>20{d.year}</Mono>
        </PickerRow>
      ))}
    </div>
  );
}

function FamilyPicker({ hasProject, onPick }: { hasProject: boolean; onPick: (f: string) => void }) {
  const [q, setQ] = useState("");
  const source: { name: string; meta: string }[] = hasProject
    ? LOADED_FAMILIES.map((f) => ({ name: f.name, meta: f.category }))
    : RECENT_DOCS.filter((d) => d.kind === "rfa").map((d) => ({ name: d.name.replace(/\.rfa$/, ""), meta: `recent · 20${d.year}` }));
  const hits = source.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="px-2 py-1" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={hasProject ? "search loaded families…" : "search recent .rfa…"}
          className="w-full bg-transparent outline-none"
          style={{ fontSize: 11, color: "var(--foreground)" }}
        />
      </div>
      {hits.map((f) => (
        <PickerRow key={f.name} onClick={() => onPick(f.name)}>
          <span style={{ fontSize: 11, color: "var(--foreground)" }}>{f.name}</span>
          <Mono size={8}>{f.meta}</Mono>
        </PickerRow>
      ))}
      {!hits.length ? (
        <div className="px-2 py-1">
          <Mono size={9}>no match</Mono>
        </div>
      ) : null}
    </div>
  );
}

// ── executing / arrived ────────────────────────────────────────────────────────────────────────

function ExecutingCard({ plan, instances }: { plan: RunningPlan; instances: Inst[] }) {
  const inst = instances.find((i) => i.id === plan.instId);
  return (
    <div className="px-3 py-2" style={{ border: "0.5px solid var(--pe-blue)", borderRadius: 2 }}>
      <Mono size={9} color="var(--pe-blue)">EXECUTING — {plan.instId}</Mono>
      <div className="mt-1">
        {plan.steps.map((s) => (
          <div key={s.label} className="flex items-baseline gap-2 py-0.5">
            <Mono
              size={9}
              color={s.status === "done" ? "var(--pe-blue)" : s.status === "running" ? "var(--cat-kiln)" : "var(--muted-foreground)"}
            >
              {s.status === "done" ? "✓" : s.status === "running" ? "●" : "○"}
            </Mono>
            <span style={{ fontSize: 11, color: s.status === "pending" ? "var(--muted-foreground)" : "var(--foreground)" }}>{s.label}</span>
            {s.status === "running" && inst?.phase === "booting" ? (
              <Mono size={8} color="var(--cat-kiln)">{Math.round((inst.bootProgress ?? 0) * 100)}%</Mono>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function PositionCard({ pos, onNew }: { pos: NonNullable<World["position"]>; onNew: () => void }) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-2" style={{ border: "0.5px solid var(--line-2)", borderRadius: 2 }}>
      <Mono size={9} color="var(--pe-blue)">YOU ARE HERE</Mono>
      <span style={{ fontSize: 12, color: "var(--foreground)" }}>
        {pos.instId} · {pos.doc ?? "no project"} · {pos.family}
      </span>
      <button
        type="button"
        onClick={onNew}
        className="tele ml-auto px-1.5 py-0.5"
        style={{ fontSize: 9, borderRadius: 2, cursor: "pointer", border: "0.5px solid var(--line-2)", color: "var(--muted-foreground)" }}
      >
        new itinerary
      </button>
    </div>
  );
}
