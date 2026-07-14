import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { ThemeToggle } from "#/components/ThemeToggle";
import {
  resolveTarget,
  selectorLabel,
  sessionLabel,
  type SessionFacts,
  type SessionLane,
  type TargetResolution,
  type TargetSelector,
} from "#/host/target";

export const Route = createFileRoute("/poc/target")({ component: PocTarget });

/* ------------------------------------------------------------------------------------------------
 * POC: session/document targeting — one underlying state, competing reflections.
 *
 * A scripted world timeline (Revit processes appearing, documents changing, pins dangling and
 * re-resolving) is scrubbed like poc.dial. Every panel below derives from the SAME
 * resolveTarget() output — the judgement is which reflection earns its keep:
 *   (a) composer TargetChip + picker  — the minimal instrument
 *   (b) patch bay                     — consumers wired to sessions; relationships as edges
 *   (c) worldline                     — session incarnations over time; the pin as a track
 *   (d) state inspector               — the raw resolution, proving it's one state
 *
 * Clicking a session in ANY panel pins it (a local override on top of the script) and every
 * other panel follows. Self-contained; mock data only.
 * ---------------------------------------------------------------------------------------------- */

// ── the scripted world ──────────────────────────────────────────────────────────────────────────

interface WorldStep {
  key: string;
  title: string;
  caption: string;
  sessions: SessionFacts[];
  /** the chat's pinned selector at this point in the script ("" = no pin) */
  chat: TargetSelector;
  /** the /ops route's selector, to show a second consumer */
  ops: TargetSelector;
}

const T0 = 1_760_000_000_000; // fixed mock epoch — ages are scripted, not computed

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
// same "user" after a restart: NEW identity (pid + start time), same selector
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
    caption: "One session, no pin → IMPLICIT resolution (dashed). The UI inferred it; it says so.",
    sessions: [userA()],
    chat: "",
    ops: "",
  },
  {
    key: "doc-opens",
    title: "doc opens",
    caption: "Tower-A.rvt becomes the active document. Document is session state, not a second axis.",
    sessions: [userA("Tower-A.rvt")],
    chat: "",
    ops: "",
  },
  {
    key: "sandbox",
    title: "sandbox spawns",
    caption: "Two sessions, no pin → AMBIGUOUS. The UI refuses to guess, exactly like the host 409.",
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
    caption: "Active document changes under a stable pin — the world moved, the wire didn't.",
    sessions: [userA("Annex-B.rvt", 1), sandboxB],
    chat: "user",
    ops: "sandbox:fam-lab",
  },
  {
    key: "revit-quits",
    title: "revit quits",
    caption: "The pinned process dies. The pin DANGLES (no-match) instead of silently retargeting.",
    sessions: [sandboxB],
    chat: "user",
    ops: "sandbox:fam-lab",
  },
  {
    key: "revit-returns",
    title: "revit returns",
    caption:
      "New pid, new session id — same selector. `user` re-resolves by itself: why pins store selectors, never ids.",
    sessions: [userA2, sandboxB],
    chat: "user",
    ops: "sandbox:fam-lab",
  },
];

// ── shared vocabulary ───────────────────────────────────────────────────────────────────────────

const LANE_CAT: Record<SessionLane, string> = {
  installed: "slate",
  rrd: "green",
  sandbox: "lichen",
};

function laneVar(lane: SessionLane): string {
  return `var(--cat-${LANE_CAT[lane]})`;
}

type ChipTone = "muted" | "implicit" | "pinned" | "ambiguous" | "dangling";

function chipDescriptor(r: TargetResolution): { tone: ChipTone; text: string; detail: string } {
  switch (r.kind) {
    case "resolved": {
      const doc = r.session.activeDocumentTitle ?? `Revit ${r.session.processId}`;
      return r.mode === "implicit"
        ? { tone: "implicit", text: `auto · ${doc}`, detail: "sole session — inferred, not chosen" }
        : { tone: "pinned", text: `${selectorLabel(r.selector)} · ${doc}`, detail: "pinned by you" }; // ponytail: selector, not session id
    }
    case "ambiguous":
      return {
        tone: "ambiguous",
        text: `${r.candidates.length} sessions — pick`,
        detail: "no pin and more than one session; calls would 409",
      };
    case "unresolved":
      return r.reason === "no-sessions"
        ? { tone: "muted", text: "no revit", detail: "no sessions connected" }
        : {
            tone: "dangling",
            text: `${selectorLabel(r.selector)} · offline`,
            detail: "pin kept; its process is gone",
          };
  }
}

const TONE_STYLE: Record<ChipTone, React.CSSProperties> = {
  muted: { border: "1px dashed var(--line)", color: "var(--muted-foreground)" },
  implicit: { border: "1px dashed var(--line-2)", color: "var(--foreground)" },
  pinned: { border: "1px solid var(--pe-blue)", color: "var(--foreground)" },
  ambiguous: {
    border: "1px solid color-mix(in srgb, var(--cat-kiln) 60%, transparent)",
    background: "color-mix(in srgb, var(--cat-kiln) 12%, transparent)",
    color: "var(--cat-kiln)",
  },
  dangling: {
    border: "1px solid color-mix(in srgb, var(--cat-clay) 50%, transparent)",
    background: "color-mix(in srgb, var(--cat-clay) 10%, transparent)",
    color: "var(--cat-clay)",
  },
};

function LiveDot({ tone, lane }: { tone: ChipTone; lane?: SessionLane }) {
  const color =
    tone === "pinned"
      ? "var(--pe-blue)"
      : tone === "implicit"
        ? (lane ? laneVar(lane) : "var(--muted-foreground)")
        : tone === "ambiguous"
          ? "var(--cat-kiln)"
          : tone === "dangling"
            ? "var(--cat-clay)"
            : "var(--line-2)";
  return (
    <span
      className="inline-block shrink-0"
      style={{ width: 6, height: 6, borderRadius: 1, background: color }}
    />
  );
}

function LaneBadge({ lane }: { lane: SessionLane }) {
  return (
    <span
      className="font-[var(--font-pe-mono)]"
      style={{
        fontSize: 9,
        letterSpacing: "0.06em",
        padding: "0 4px",
        borderRadius: 2,
        color: laneVar(lane),
        background: `color-mix(in srgb, ${laneVar(lane)} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${laneVar(lane)} 25%, transparent)`,
      }}
    >
      {lane.toUpperCase()}
    </span>
  );
}

function obsAge(s: SessionFacts): string {
  if (!s.observedAtUnixMs) return "—";
  return `obs ${Math.round((T0 - s.observedAtUnixMs) / 1000)}s ago`;
}

// ── (a) composer chip + picker ──────────────────────────────────────────────────────────────────

function ComposerStrip({
  resolution,
  sessions,
  onPin,
  pinned,
}: {
  resolution: TargetResolution;
  sessions: SessionFacts[];
  onPin: (selector: TargetSelector) => void;
  pinned: TargetSelector;
}) {
  const [open, setOpen] = useState(true);
  const chip = chipDescriptor(resolution);
  const resolvedId = resolution.kind === "resolved" ? resolution.session.sessionId : undefined;

  return (
    <div style={{ maxWidth: 620 }}>
      {/* faux composer */}
      <div
        style={{
          border: "0.5px solid var(--line)",
          background: "var(--card)",
          borderRadius: 2,
        }}
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
          {/* THE chip */}
          <button
            onClick={() => setOpen((o) => !o)}
            className="tele inline-flex items-center gap-1.5 px-2 py-0.5"
            style={{ fontSize: 11, borderRadius: 2, ...TONE_STYLE[chip.tone] }}
            title={chip.detail}
          >
            <LiveDot
              tone={chip.tone}
              lane={resolution.kind === "resolved" ? resolution.session.lane : undefined}
            />
            {chip.text}
          </button>
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

      {/* the chip's popover, drawn inline for judgement */}
      {open && (
        <div
          className="mt-1"
          style={{ border: "0.5px solid var(--line)", background: "var(--paper-2)", borderRadius: 2 }}
        >
          <div
            className="flex items-baseline justify-between px-3 py-1.5"
            style={{ borderBottom: "0.5px solid var(--line-soft)" }}
          >
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--muted-foreground)" }}
            >
              TARGET
            </span>
            <span
              className="font-[var(--font-pe-mono)]"
              style={{ fontSize: 10, color: "var(--muted-foreground)" }}
            >
              {chip.detail}
            </span>
          </div>

          {/* auto row */}
          <PickRow
            active={pinned === ""}
            onClick={() => onPin("")}
            left={
              <span style={{ color: "var(--muted-foreground)" }}>
                auto — follow the sole session
              </span>
            }
            right={
              sessions.length > 1 ? (
                <span style={{ color: "var(--cat-kiln)" }}>ambiguous now</span>
              ) : null
            }
          />

          {sessions.map((s) => {
            const isResolved = s.sessionId === resolvedId;
            const sel: TargetSelector =
              s.lane === "sandbox" && s.sandboxId
                ? `sandbox:${s.sandboxId}`
                : s.lane === "installed" || s.lane === "rrd"
                  ? "user"
                  : String(s.processId);
            return (
              <PickRow
                key={s.sessionId}
                active={isResolved && pinned !== ""}
                onClick={() => onPin(sel)}
                left={
                  <span className="inline-flex items-center gap-2">
                    <LiveDot tone={isResolved ? "pinned" : "implicit"} lane={s.lane} />
                    <span style={{ color: "var(--foreground)" }}>{sessionLabel(s)}</span>
                    <LaneBadge lane={s.lane} />
                  </span>
                }
                right={
                  <span
                    className="font-[var(--font-pe-mono)]"
                    style={{ fontSize: 10, color: "var(--muted-foreground)" }}
                  >
                    {sel} · pid {s.processId} · {obsAge(s)}
                  </span>
                }
              />
            );
          })}
          {sessions.length === 0 && (
            <div className="px-3 py-2 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
              no sessions connected — open Revit or spawn a sandbox
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PickRow({
  left,
  right,
  active,
  onClick,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px]"
      style={{
        borderBottom: "0.5px solid var(--line-soft)",
        background: active ? "color-mix(in srgb, var(--pe-blue) 6%, transparent)" : "transparent",
        borderLeft: active ? "2px solid var(--pe-blue)" : "2px solid transparent",
        cursor: "pointer",
      }}
    >
      {left}
      {right}
    </button>
  );
}

// ── (b) patch bay ───────────────────────────────────────────────────────────────────────────────

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
    { key: "chat", label: "pea chat", r: chatResolution, pinnable: true },
    { key: "ops", label: "/ops", r: opsResolution, pinnable: false },
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
          const wire = (
            y2: number,
            stroke: string,
            dashed: boolean,
            width = 1.25,
            opacity = 1,
          ) => (
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
                  return i < 0 ? null : wire(sessionY(i), "var(--cat-kiln)", true, 1, 0.5);
                })}
              </g>
            );
          }
          // unresolved: a stub wire to nowhere
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

      {/* consumer jacks */}
      {consumers.map((c, ci) => {
        const chip = chipDescriptor(c.r);
        return (
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
              className="font-[var(--font-pe-mono)] truncate"
              style={{ fontSize: 9, color: TONE_STYLE[chip.tone].color as string }}
            >
              {c.r.selector === "" ? "auto" : c.r.selector}
            </div>
          </div>
        );
      })}

      {/* session jacks */}
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
              border: targetedByChat
                ? "1px solid var(--pe-blue)"
                : "0.5px solid var(--line)",
              background: "var(--card)",
              borderRadius: 2,
              cursor: "pointer",
            }}
            title="click to pin chat here"
          >
            <div className="flex items-center gap-1.5">
              <LiveDot tone={targetedByChat ? "pinned" : "implicit"} lane={s.lane} />
              <span
                className="truncate text-[11px] font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {sessionLabel(s)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <LaneBadge lane={s.lane} />
              <span
                className="font-[var(--font-pe-mono)]"
                style={{ fontSize: 9, color: "var(--muted-foreground)" }}
              >
                {s.processId} · {obsAge(s)}
              </span>
            </div>
          </button>
        );
      })}
      {sessions.length === 0 && (
        <div
          className="absolute font-[var(--font-pe-mono)]"
          style={{
            right: 24,
            top: height / 2 - 8,
            fontSize: 10,
            color: "var(--muted-foreground)",
          }}
        >
          NO SESSIONS
        </div>
      )}
    </div>
  );
}

// ── (c) worldline ───────────────────────────────────────────────────────────────────────────────

const WL_W = 460;
const WL_ROW = 34;

interface WorldlineRow {
  id: string;
  label: string;
  lane: SessionLane;
  /** doc tenure segments: [fromStep, toStepExclusive, docTitle] */
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
      {/* step columns (clickable, scrubs the scenario) */}
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

      {/* session rows */}
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

      {/* the chat pin track — where the chat's target actually pointed, step by step */}
      <div
        className="absolute inset-x-0"
        style={{ bottom: 6, height: 18, pointerEvents: "none" }}
      >
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
              {/* marker in the pin lane */}
              <span
                className="absolute"
                style={{
                  left: cx - 3,
                  bottom: 4,
                  width: 6,
                  height: 6,
                  borderRadius: 1,
                  background: r.kind === "resolved" && r.mode === "implicit" ? "transparent" : color,
                  border:
                    r.kind === "resolved" && r.mode === "implicit" ? `1px dashed ${color}` : "none",
                }}
              />
              {/* riser up to the targeted row */}
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
          style={{ left: 6, bottom: 4, fontSize: 8, letterSpacing: "0.08em", color: "var(--muted-foreground)" }}
        >
          CHAT PIN
        </span>
      </div>

      {/* NOW cursor */}
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

// ── (d) inspector ───────────────────────────────────────────────────────────────────────────────

function Inspector({ chat, ops }: { chat: TargetResolution; ops: TargetResolution }) {
  const line = (label: string, r: TargetResolution) => {
    const chip = chipDescriptor(r);
    return (
      <div className="flex items-baseline gap-3 px-3 py-1.5" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 10, width: 44, color: "var(--muted-foreground)" }}
        >
          {label}
        </span>
        <span className="font-[var(--font-pe-mono)]" style={{ fontSize: 11, color: "var(--foreground)" }}>
          selector=<span style={{ color: "var(--pe-blue)" }}>{JSON.stringify(r.selector)}</span>{" "}
          → {r.kind}
          {r.kind === "resolved" && (
            <>
              /{r.mode} · session {r.session.sessionId} · pid {r.session.processId} · doc{" "}
              {r.session.activeDocumentTitle ?? "∅"}
            </>
          )}
          {r.kind === "ambiguous" && <> · {r.candidates.length} candidates</>}
          {r.kind === "unresolved" && <> · {r.reason}</>}
        </span>
        <span className="grow" />
        <span className="font-[var(--font-pe-mono)]" style={{ fontSize: 10, color: TONE_STYLE[chip.tone].color as string }}>
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

function PocTarget() {
  const [step, setStep] = useState(2);
  const [playing, setPlaying] = useState(false);
  /** local pin override on top of the script — set by clicking any session in any panel */
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
    <div className="min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className="page-wrap py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1
              className="m-0 text-[22px] font-semibold"
              style={{ fontFamily: "var(--font-pe-display)", color: "var(--pe-blue)" }}
            >
              POC — Target: one state, competing reflections
            </h1>
            <p className="mt-1 max-w-[68ch] text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              A scripted world (sessions appearing, documents changing, pins dangling) drives one{" "}
              <code>resolveTarget()</code>. Every panel is a reflection of that single resolution —
              click a session in any panel and all of them follow. The judgement: which reflection
              earns a place in the product, and where.
            </p>
          </div>
          <ThemeToggle />
        </header>

        {/* scenario transport */}
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
              <span style={{ color: "var(--pe-blue)" }}>you pinned `{override || "auto"}`</span> —
              every panel below updated from the same resolution. (changes step → script resumes)
            </>
          ) : (
            world.caption
          )}
        </p>

        <div className="grid gap-8 lg:grid-cols-2">
          <section>
            <VariantLabel
              label="(a) composer chip + picker"
              desc="Minimal: dot + selector + document in the control row, next to model and access. Dashed = inferred, solid = pinned, kiln = refuses to guess, clay = pin dangling."
            />
            <ComposerStrip
              resolution={chat}
              sessions={world.sessions}
              onPin={(sel) => setOverride(sel)}
              pinned={chatSelector}
            />
          </section>

          <section>
            <VariantLabel
              label="(d) state inspector"
              desc="The raw resolution both consumers derive from — the proof there is one state."
            />
            <Inspector chat={chat} ops={ops} />
            <div className="mt-6">
              <VariantLabel
                label="(b) patch bay"
                desc="Consumers wired to sessions. Solid blue wire = pinned, dashed = implicit, two faint kiln wires = ambiguous, stub = dangling. Click a session to pin chat."
              />
              <PatchBay step={world} chatResolution={chat} opsResolution={ops} onPin={setOverride} />
            </div>
          </section>

          <section className="lg:col-span-2">
            <VariantLabel
              label="(c) worldline"
              desc="Session incarnations over scenario time; document tenure as labeled spans; the chat pin as a bottom track rising to whichever row it resolves to. Watch the pin survive the restart (step 6→7) — the riser re-attaches to a NEW row because the selector, not the session id, is the stored state. Click anywhere to scrub."
            />
            <Worldline currentStep={step} chatByStep={chatByStep} onStep={goto} />
          </section>
        </div>
      </div>
    </div>
  );
}

function VariantLabel({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="mb-2">
      <div
        className="font-[var(--font-pe-mono)]"
        style={{ fontSize: 10, letterSpacing: "0.04em", color: "var(--foreground)" }}
      >
        {label}
      </div>
      <p className="m-0 mt-0.5 max-w-[60ch] text-[11px] leading-snug" style={{ color: "var(--muted-foreground)" }}>
        {desc}
      </p>
    </div>
  );
}
