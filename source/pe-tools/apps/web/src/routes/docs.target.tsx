import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";
import { TargetChip } from "#/components/target-chip";
import {
  resolveTarget,
  type SessionFacts,
  type TargetResolution,
  type TargetSelector,
} from "#/host/target";
import {
  ageLabel,
  chipDescriptor,
  LaneBadge,
  laneVar,
  LiveDot,
  resolutionReadout,
  toneColor,
  TONE_STYLE,
} from "#/host/target-ui";

export const Route = createFileRoute("/docs/target")({ component: DocsTarget });

/* ------------------------------------------------------------------------------------------------
 * docs/target — session & document targeting: the model, its states, and where each surface
 * reflects it. Doubles as the design exercise it grew from: a scripted world timeline drives one
 * resolveTarget() and every exhibit below is a reflection of that single resolution. The composer
 * chip exhibit renders the REAL product component (components/target-chip.tsx) against the
 * scripted world; the patch bay and worldline are explanatory instruments.
 *
 * Self-contained data; the model and visual vocabulary are imported from #/host/target(-ui) —
 * the same modules the product uses — so this page cannot drift from the shipped behavior.
 * ---------------------------------------------------------------------------------------------- */

// ── the scripted world ──────────────────────────────────────────────────────────────────────────

interface WorldStep {
  key: string;
  title: string;
  caption: string;
  sessions: SessionFacts[];
  chat: TargetSelector;
  ops: TargetSelector;
}

const T0 = 1_760_000_000_000; // fixed epoch — ages are scripted, not computed

const userA = (doc?: string, obsAgoS = 4): SessionFacts => ({
  sessionId: "a41f0c",
  processId: 4128,
  lane: "installed",
  activeDocumentTitle: doc,
  openDocumentCount: doc ? 1 : 0,
  observedAtUnixMs: doc ? T0 - obsAgoS * 1000 : undefined,
});
const sandboxB: SessionFacts = {
  sessionId: "b7e29d",
  processId: 9204,
  lane: "sandbox",
  sandboxId: "fam-lab",
  activeDocumentTitle: "Door-Single.rfa",
  activeDocumentIsFamilyDocument: true,
  openDocumentCount: 1,
  observedAtUnixMs: T0 - 2000,
};
// the same "user" after a restart: new identity (pid + start time), same selector
const userA2: SessionFacts = {
  sessionId: "c5d817",
  processId: 5330,
  lane: "installed",
  activeDocumentTitle: "Annex-B.rvt",
  openDocumentCount: 1,
  observedAtUnixMs: T0 - 1000,
};

const STEPS: WorldStep[] = [
  {
    key: "cold",
    title: "cold",
    caption: "No Revit running. The chip stays in the row, muted — absence is information.",
    sessions: [],
    chat: "",
    ops: "",
  },
  {
    key: "revit-opens",
    title: "revit opens",
    caption: "One session, no pin → implicit resolution (dashed). The UI inferred it, and says so.",
    sessions: [userA()],
    chat: "",
    ops: "",
  },
  {
    key: "doc-opens",
    title: "doc opens",
    caption:
      "Tower-A.rvt becomes the active document. Document is session state, not a second axis.",
    sessions: [userA("Tower-A.rvt")],
    chat: "",
    ops: "",
  },
  {
    key: "sandbox",
    title: "sandbox spawns",
    caption: "Two sessions, no pin → ambiguous. The UI refuses to guess, as the host 409 does.",
    sessions: [userA("Tower-A.rvt"), sandboxB],
    chat: "",
    ops: "",
  },
  {
    key: "pin",
    title: "you pin",
    caption: "Chat pins `user`; /ops pins `sandbox:fam-lab`. Two consumers, two solid wires.",
    sessions: [userA("Tower-A.rvt"), sandboxB],
    chat: "user",
    ops: "sandbox:fam-lab",
  },
  {
    key: "doc-switch",
    title: "doc switches",
    caption: "The active document changes under a stable pin — the world moved, the wire didn't.",
    sessions: [userA("Annex-B.rvt", 1), sandboxB],
    chat: "user",
    ops: "sandbox:fam-lab",
  },
  {
    key: "revit-quits",
    title: "revit quits",
    caption: "The pinned process dies. The pin dangles (no-match) instead of silently retargeting.",
    sessions: [sandboxB],
    chat: "user",
    ops: "sandbox:fam-lab",
  },
  {
    key: "revit-returns",
    title: "revit returns",
    caption:
      "New pid, new session id — same selector. `user` re-resolves on its own: pins store selectors, never ids.",
    sessions: [userA2, sandboxB],
    chat: "user",
    ops: "sandbox:fam-lab",
  },
];

// ── reference tables ────────────────────────────────────────────────────────────────────────────

const SELECTOR_ROWS: [string, string][] = [
  ["(empty)", "implicit — the sole session, or refuse when there are several"],
  ["user", "the user's Revit (lane rrd or installed)"],
  ["rrd", "the rrd lane specifically"],
  ["sandbox:<id>", "a sandbox by logical id"],
  ["<digits>", "a process id"],
  ["anything else", "a raw session id (dies with the process — UIs never store these)"],
];

const STATE_ROWS: { tone: keyof typeof TONE_STYLE; name: string; means: string }[] = [
  { tone: "implicit", name: "resolved / implicit", means: "sole session, inferred — drawn dashed" },
  { tone: "pinned", name: "resolved / pinned", means: "explicit selector matched one session" },
  { tone: "ambiguous", name: "ambiguous", means: "several candidates; untargeted calls 409" },
  { tone: "dangling", name: "unresolved / no-match", means: "pin kept; its process is gone" },
  { tone: "muted", name: "unresolved / no-sessions", means: "empty world" },
];

// ── (exhibit) faux composer hosting the real chip ───────────────────────────────────────────────

function ComposerExhibit({
  selector,
  sessions,
  onPin,
}: {
  selector: TargetSelector;
  sessions: SessionFacts[];
  onPin: (selector: TargetSelector) => void;
}) {
  return (
    <div style={{ maxWidth: 620 }}>
      <div
        style={{ border: "0.5px solid var(--line)", background: "var(--card)", borderRadius: 2 }}
      >
        <div className="px-3 py-3" style={{ color: "var(--muted-foreground)", fontSize: 13 }}>
          Ask Pea to renumber the doors on level 2…
        </div>
        <div
          className="flex items-center gap-1.5 px-2 py-1.5"
          style={{ borderTop: "0.5px solid var(--line-soft)" }}
        >
          <span className="px-1 text-[14px]" style={{ color: "var(--muted-foreground)" }}>
            +
          </span>
          {["fable-5", "propose"].map((label) => (
            <span
              key={label}
              className="tele px-2 py-0.5"
              style={{ fontSize: 11, color: "var(--muted-foreground)" }}
            >
              {label}
            </span>
          ))}
          {/* the shipped component, against the scripted world */}
          <TargetChip
            selector={selector}
            sessions={sessions}
            onPin={onPin}
            nowMs={T0}
            defaultOpen
          />
          <span className="grow" />
          <span
            className="px-2 py-0.5 text-[11px] font-semibold"
            style={{
              borderRadius: 2,
              background: "var(--pe-blue)",
              color: "var(--primary-foreground)",
            }}
          >
            send ▸
          </span>
        </div>
      </div>
    </div>
  );
}

// ── (exhibit) patch bay — the relationship model, drawn whole ───────────────────────────────────

const BAY_W = 460;
const ROW_H = 52;

function PatchBay({
  step,
  chatResolution,
  opsResolution,
  onPin,
}: {
  step: WorldStep;
  chatResolution: TargetResolution;
  opsResolution: TargetResolution;
  onPin: (selector: TargetSelector) => void;
}) {
  const consumers = [
    { key: "chat", label: "pea chat", r: chatResolution },
    { key: "ops", label: "/ops", r: opsResolution },
  ];
  const sessions = step.sessions;
  const height = Math.max(consumers.length, sessions.length, 1) * ROW_H + 16;
  const consumerY = (i: number) => 8 + i * ROW_H + ROW_H / 2;
  const sessionY = (i: number) => 8 + i * ROW_H + ROW_H / 2;
  const sIndex = (id: string) => sessions.findIndex((s) => s.sessionId === id);

  return (
    <div
      className="relative"
      style={{
        width: BAY_W,
        height,
        border: "0.5px solid var(--line)",
        background: "var(--paper-3)",
        borderRadius: 2,
      }}
    >
      <svg
        width={BAY_W}
        height={height}
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
      >
        {consumers.map((c, ci) => {
          const y1 = consumerY(ci);
          const x1 = 132;
          const x2 = BAY_W - 172;
          const wire = (y2: number, stroke: string, dashed: boolean, width = 1.25, opacity = 1) => (
            <path
              d={`M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 60} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={stroke}
              strokeWidth={width}
              strokeDasharray={dashed ? "4 3" : undefined}
              opacity={opacity}
            />
          );
          if (c.r.kind === "resolved") {
            const i = sIndex(c.r.session.sessionId);
            if (i < 0) return null;
            return (
              <g key={c.key}>
                {wire(
                  sessionY(i),
                  c.r.mode === "pinned" ? "var(--pe-blue)" : "var(--line-2)",
                  c.r.mode === "implicit",
                  c.r.mode === "pinned" ? 1.5 : 1.25,
                )}
              </g>
            );
          }
          if (c.r.kind === "ambiguous") {
            return (
              <g key={c.key}>
                {c.r.candidates.map((cand) => {
                  const i = sIndex(cand.sessionId);
                  return i < 0 ? null : (
                    <g key={cand.sessionId}>{wire(sessionY(i), "var(--cat-kiln)", true, 1, 0.5)}</g>
                  );
                })}
              </g>
            );
          }
          return (
            <g key={c.key}>
              <path
                d={`M ${x1} ${y1} h 36`}
                fill="none"
                stroke={c.r.reason === "no-match" ? "var(--cat-clay)" : "var(--line)"}
                strokeWidth={1.25}
                strokeDasharray="2 3"
              />
              <circle
                cx={x1 + 40}
                cy={y1}
                r={2}
                fill={c.r.reason === "no-match" ? "var(--cat-clay)" : "var(--line)"}
              />
            </g>
          );
        })}
      </svg>

      {consumers.map((c, ci) => (
        <div
          key={c.key}
          className="absolute px-2 py-1"
          style={{
            left: 8,
            top: consumerY(ci) - 18,
            width: 124,
            border: "0.5px solid var(--line)",
            background: "var(--card)",
            borderRadius: 2,
          }}
        >
          <div className="text-[11px] font-semibold" style={{ color: "var(--foreground)" }}>
            {c.label}
          </div>
          <div
            className="truncate font-[var(--font-pe-mono)]"
            style={{ fontSize: 9, color: TONE_STYLE[chipDescriptor(c.r).tone].color as string }}
          >
            {c.r.selector === "" ? "auto" : c.r.selector}
          </div>
        </div>
      ))}

      {sessions.map((s, si) => {
        const targetedByChat =
          chatResolution.kind === "resolved" && chatResolution.session.sessionId === s.sessionId;
        return (
          <button
            key={s.sessionId}
            onClick={() =>
              onPin(s.lane === "sandbox" && s.sandboxId ? `sandbox:${s.sandboxId}` : "user")
            }
            className="absolute px-2 py-1 text-left"
            style={{
              right: 8,
              top: sessionY(si) - 18,
              width: 160,
              border: targetedByChat ? "1px solid var(--pe-blue)" : "0.5px solid var(--line)",
              background: "var(--card)",
              borderRadius: 2,
              cursor: "pointer",
            }}
            title="pin the chat here"
          >
            <div className="flex items-center gap-1.5">
              <LiveDot tone={targetedByChat ? "pinned" : "implicit"} lane={s.lane} />
              <span
                className="truncate text-[11px] font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {s.activeDocumentTitle ?? `Revit ${s.processId}`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <LaneBadge lane={s.lane} />
              <span
                className="font-[var(--font-pe-mono)]"
                style={{ fontSize: 9, color: "var(--muted-foreground)" }}
              >
                {s.processId} · {ageLabel(s.observedAtUnixMs, T0)}
              </span>
            </div>
          </button>
        );
      })}
      {sessions.length === 0 && (
        <div
          className="absolute font-[var(--font-pe-mono)]"
          style={{ right: 24, top: height / 2 - 8, fontSize: 10, color: "var(--muted-foreground)" }}
        >
          NO SESSIONS
        </div>
      )}
    </div>
  );
}

// ── (exhibit) worldline ─────────────────────────────────────────────────────────────────────────

const WL_W = 460;
const WL_ROW = 34;

interface WorldlineRow {
  id: string;
  label: string;
  lane: SessionFacts["lane"];
  spans: [number, number, string][];
}

function buildRows(): WorldlineRow[] {
  const rows = new Map<string, WorldlineRow>();
  STEPS.forEach((step, si) => {
    for (const s of step.sessions) {
      let row = rows.get(s.sessionId);
      if (!row) {
        row = {
          id: s.sessionId,
          label: `${s.lane === "sandbox" ? (s.sandboxId ?? "sandbox") : "user"} · ${s.processId}`,
          lane: s.lane,
          spans: [],
        };
        rows.set(s.sessionId, row);
      }
      const doc = s.activeDocumentTitle ?? "(no doc)";
      const last = row.spans[row.spans.length - 1];
      if (last && last[1] === si && last[2] === doc) last[1] = si + 1;
      else row.spans.push([si, si + 1, doc]);
    }
  });
  return [...rows.values()];
}

function Worldline({
  currentStep,
  chatByStep,
  onStep,
}: {
  currentStep: number;
  chatByStep: TargetResolution[];
  onStep: (i: number) => void;
}) {
  const rows = useMemo(buildRows, []);
  const n = STEPS.length;
  const x = (step: number) => (step / n) * WL_W;
  const height = rows.length * WL_ROW + 40;

  return (
    <div
      className="relative select-none"
      style={{
        width: WL_W,
        height,
        border: "0.5px solid var(--line)",
        background: "var(--paper-3)",
        borderRadius: 2,
      }}
    >
      {STEPS.map((_, i) => (
        <div
          key={i}
          onClick={() => onStep(i)}
          className="absolute inset-y-0"
          style={{
            left: x(i),
            width: WL_W / n,
            borderLeft: i === 0 ? "none" : "0.5px solid var(--line-soft)",
            background:
              i === currentStep
                ? "color-mix(in srgb, var(--pe-blue) 5%, transparent)"
                : "transparent",
            cursor: "pointer",
          }}
        />
      ))}

      {rows.map((row, ri) => {
        const top = 8 + ri * WL_ROW;
        return (
          <div key={row.id} className="absolute inset-x-0" style={{ top, height: WL_ROW - 8 }}>
            <span
              className="absolute font-[var(--font-pe-mono)]"
              style={{
                left: 6,
                top: -1,
                fontSize: 9,
                letterSpacing: "0.04em",
                color: laneVar(row.lane),
                zIndex: 2,
              }}
            >
              {row.label}
            </span>
            {row.spans.map(([from, to, doc], k) => (
              <div
                key={k}
                className="absolute flex items-end px-1.5"
                style={{
                  left: x(from) + 2,
                  width: x(to) - x(from) - 4,
                  top: 10,
                  height: WL_ROW - 20,
                  background: `color-mix(in srgb, ${laneVar(row.lane)} 12%, transparent)`,
                  borderLeft: `2px solid ${laneVar(row.lane)}`,
                  borderRadius: 1,
                  overflow: "hidden",
                }}
              >
                <span
                  className="truncate font-[var(--font-pe-mono)]"
                  style={{ fontSize: 9, color: "var(--foreground)", opacity: 0.85 }}
                >
                  {doc}
                </span>
              </div>
            ))}
          </div>
        );
      })}

      <div className="absolute inset-x-0" style={{ bottom: 6, height: 18, pointerEvents: "none" }}>
        {chatByStep.map((r, i) => {
          const cx = x(i) + WL_W / n / 2;
          const rowIndex =
            r.kind === "resolved" ? rows.findIndex((row) => row.id === r.session.sessionId) : -1;
          const color =
            r.kind === "resolved"
              ? r.mode === "pinned"
                ? "var(--pe-blue)"
                : "var(--line-2)"
              : r.kind === "ambiguous"
                ? "var(--cat-kiln)"
                : r.selector !== ""
                  ? "var(--cat-clay)"
                  : "var(--line)";
          return (
            <div key={i}>
              <span
                className="absolute"
                style={{
                  left: cx - 3,
                  bottom: 4,
                  width: 6,
                  height: 6,
                  borderRadius: 1,
                  background:
                    r.kind === "resolved" && r.mode === "implicit" ? "transparent" : color,
                  border:
                    r.kind === "resolved" && r.mode === "implicit" ? `1px dashed ${color}` : "none",
                }}
              />
              {rowIndex >= 0 && (
                <span
                  className="absolute"
                  style={{
                    left: cx,
                    bottom: 10,
                    height: height - (8 + rowIndex * WL_ROW) - 32,
                    borderLeft: `1px ${r.kind === "resolved" && r.mode === "implicit" ? "dashed" : "solid"} ${color}`,
                    opacity: i === currentStep ? 0.9 : 0.25,
                  }}
                />
              )}
              {r.kind === "ambiguous" && (
                <span
                  className="absolute font-[var(--font-pe-mono)]"
                  style={{ left: cx - 3, bottom: 12, fontSize: 9, color }}
                >
                  ?
                </span>
              )}
              {r.kind === "unresolved" && r.selector !== "" && (
                <span
                  className="absolute font-[var(--font-pe-mono)]"
                  style={{ left: cx - 3, bottom: 12, fontSize: 9, color }}
                >
                  ×
                </span>
              )}
            </div>
          );
        })}
        <span
          className="absolute font-[var(--font-pe-mono)]"
          style={{
            left: 6,
            bottom: 4,
            fontSize: 8,
            letterSpacing: "0.08em",
            color: "var(--muted-foreground)",
          }}
        >
          CHAT PIN
        </span>
      </div>

      <div
        className="absolute inset-y-0 pointer-events-none"
        style={{
          left: x(currentStep) + WL_W / n / 2,
          borderLeft: "1.5px solid color-mix(in srgb, var(--pe-blue) 55%, transparent)",
        }}
      />
    </div>
  );
}

// ── (exhibit) inspector ─────────────────────────────────────────────────────────────────────────

function Inspector({ chat, ops }: { chat: TargetResolution; ops: TargetResolution }) {
  const line = (label: string, r: TargetResolution) => {
    const chip = chipDescriptor(r);
    return (
      <div
        className="flex items-baseline gap-3 px-3 py-1.5"
        style={{ borderBottom: "0.5px solid var(--line-soft)" }}
      >
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 10, width: 44, color: "var(--muted-foreground)" }}
        >
          {label}
        </span>
        <span
          className="break-all font-[var(--font-pe-mono)]"
          style={{ fontSize: 11, color: "var(--foreground)" }}
        >
          {resolutionReadout(r)}
        </span>
        <span className="grow" />
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 10, color: toneColor(chip.tone) }}
        >
          {chip.tone.toUpperCase()}
        </span>
      </div>
    );
  };
  return (
    <div style={{ border: "0.5px solid var(--line)", background: "var(--card)", borderRadius: 2 }}>
      {line("chat", chat)}
      {line("/ops", ops)}
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────────────────────────────────

function DocsTarget() {
  const [step, setStep] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [override, setOverride] = useState<TargetSelector | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 1900);
    return () => clearInterval(id);
  }, [playing]);

  const world = STEPS[step]!;
  const chatSelector = override ?? world.chat;
  const chat = resolveTarget(world.sessions, chatSelector);
  const ops = resolveTarget(world.sessions, world.ops);
  const chatByStep = useMemo(
    () => STEPS.map((s, i) => resolveTarget(s.sessions, i === step ? chatSelector : s.chat)),
    [step, chatSelector],
  );

  const goto = (i: number) => {
    setStep(i);
    setOverride(null);
    setPlaying(false);
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="page-wrap py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 10, letterSpacing: "0.1em", color: "var(--muted-foreground)" }}
            >
              DOCS / TARGET
            </div>
            <h1
              className="m-0 text-[22px] font-semibold"
              style={{ fontFamily: "var(--font-pe-display)", color: "var(--pe-blue)" }}
            >
              Session &amp; document targeting
            </h1>
            <p
              className="mt-1 max-w-[70ch] text-[13px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              Every Pea surface that touches Revit — the chat, data routes, plugins — answers the
              same question the same way:{" "}
              <em>which session, and therefore which document, will this act on?</em> The answer is
              a <strong>target</strong>: a stored selector, resolved live against the broker's
              session list. This page is the model's spec and its working exhibit — the scenario
              below scripts a world through every state the model has, and each exhibit reflects the
              one shared resolution.
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* ── the model ─────────────────────────────────────────────────────────────────────── */}
        <section className="mb-8 grid gap-6 md:grid-cols-2">
          <div>
            <SectionLabel label="selectors" />
            <p
              className="mb-2 max-w-[54ch] text-[12px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              UIs store selectors, never session ids: a selector is stable across process restarts,
              so a pin survives the world changing under it. The grammar is the host's
              (`resolveSessionTarget`); the web mirror is `#/host/target.ts`.
            </p>
            <table className="w-full border-collapse" style={{ border: "0.5px solid var(--line)" }}>
              <tbody>
                {SELECTOR_ROWS.map(([sel, meaning]) => (
                  <tr key={sel} style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                    <td
                      className="px-3 py-1.5 font-[var(--font-pe-mono)]"
                      style={{ fontSize: 11, color: "var(--pe-blue)", whiteSpace: "nowrap" }}
                    >
                      {sel}
                    </td>
                    <td className="px-3 py-1.5 text-[12px]" style={{ color: "var(--foreground)" }}>
                      {meaning}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <SectionLabel label="resolution states" />
            <p
              className="mb-2 max-w-[54ch] text-[12px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              Resolution is a pure function of (sessions, selector). Each state has one tone, used
              identically everywhere: dashed means inferred, solid blue means chosen, kiln means the
              UI refuses to guess, clay means a kept pin lost its process.
            </p>
            <table className="w-full border-collapse" style={{ border: "0.5px solid var(--line)" }}>
              <tbody>
                {STATE_ROWS.map((row) => (
                  <tr key={row.name} style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                    <td className="px-3 py-1.5" style={{ width: 20 }}>
                      <LiveDot tone={row.tone} />
                    </td>
                    <td
                      className="px-3 py-1.5 font-[var(--font-pe-mono)]"
                      style={{ fontSize: 11, color: "var(--foreground)", whiteSpace: "nowrap" }}
                    >
                      {row.name}
                    </td>
                    <td
                      className="px-3 py-1.5 text-[12px]"
                      style={{ color: "var(--muted-foreground)" }}
                    >
                      {row.means}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── the world in motion ───────────────────────────────────────────────────────────── */}
        <SectionLabel label="the world in motion" />
        <p className="mb-3 max-w-[70ch] text-[12px]" style={{ color: "var(--muted-foreground)" }}>
          A scripted world: sessions appear, documents change, the pinned process dies and returns.
          Scrub it, or pin a session in any exhibit — every exhibit derives from the same
          resolution, so they move together.
        </p>
        <div className="mb-2 flex items-center gap-3">
          <button
            onClick={() => setPlaying((p) => !p)}
            className="px-3 py-1 text-[12px]"
            style={{
              borderRadius: 2,
              border: "1px solid var(--line-2)",
              background: playing ? "var(--pe-blue)" : "transparent",
              color: playing ? "var(--primary-foreground)" : "var(--foreground)",
            }}
          >
            {playing ? "Pause" : "Play scenario"}
          </button>
          <div className="flex items-center">
            {STEPS.map((s, i) => (
              <button
                key={s.key}
                onClick={() => goto(i)}
                className="tele px-2 py-1"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.03em",
                  color: i === step ? "var(--pe-blue)" : "var(--muted-foreground)",
                  borderBottom:
                    i === step ? "2px solid var(--pe-blue)" : "2px solid var(--line-soft)",
                  cursor: "pointer",
                }}
              >
                {i}·{s.title}
              </button>
            ))}
          </div>
        </div>
        <p className="mb-6 text-[12px]" style={{ color: "var(--muted-foreground)", minHeight: 18 }}>
          {override !== null ? (
            <>
              <span style={{ color: "var(--pe-blue)" }}>pinned `{override || "auto"}`</span> — every
              exhibit updated from the same resolution. (changing step resumes the script)
            </>
          ) : (
            world.caption
          )}
        </p>

        <div className="grid gap-8 lg:grid-cols-2">
          <section>
            <SectionLabel label="composer chip — the product surface" />
            <p
              className="mb-2 max-w-[60ch] text-[11px] leading-snug"
              style={{ color: "var(--muted-foreground)" }}
            >
              The chip lives in the chat control row next to model and access, and on any route that
              targets a session. Its picker is a one-consumer patch bay: the wire gutter on the left
              draws this surface's relationship to each session. This exhibit renders the shipped
              component (`components/target-chip.tsx`).
            </p>
            <ComposerExhibit
              selector={chatSelector}
              sessions={world.sessions}
              onPin={(sel) => setOverride(sel)}
            />
          </section>

          <section>
            <SectionLabel label="resolution readout — provenance" />
            <p
              className="mb-2 max-w-[60ch] text-[11px] leading-snug"
              style={{ color: "var(--muted-foreground)" }}
            >
              The raw resolution both consumers derive from. In the product this readout lives in
              the chat's World lane, above the context layers.
            </p>
            <Inspector chat={chat} ops={ops} />
            <div className="mt-6">
              <SectionLabel label="patch bay — the relationship model, drawn whole" />
              <p
                className="mb-2 max-w-[60ch] text-[11px] leading-snug"
                style={{ color: "var(--muted-foreground)" }}
              >
                Consumers on the left, sessions on the right, resolution as wires. The chip's gutter
                is this diagram compressed to one consumer; this full form is the mental model
                behind it.
              </p>
              <PatchBay
                step={world}
                chatResolution={chat}
                opsResolution={ops}
                onPin={setOverride}
              />
            </div>
          </section>

          <section className="lg:col-span-2">
            <SectionLabel label="worldline — targets over time" />
            <p
              className="mb-2 max-w-[72ch] text-[11px] leading-snug"
              style={{ color: "var(--muted-foreground)" }}
            >
              Session incarnations as rows, document tenure as labeled spans, the chat pin as the
              bottom track rising to whichever row it resolves to. Between steps 6 and 7 the riser
              re-attaches to a new row: the selector, not the session id, is the stored state. In
              the product this appears as the thread lane's world rail and event ticks. Click to
              scrub.
            </p>
            <Worldline currentStep={step} chatByStep={chatByStep} onStep={goto} />
          </section>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div
      className="mb-1.5 font-[var(--font-pe-mono)]"
      style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--foreground)" }}
    >
      {label.toUpperCase()}
    </div>
  );
}
