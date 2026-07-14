import type { CSSProperties } from "react";

import {
  selectorLabel,
  type SessionFacts,
  type SessionLane,
  type TargetResolution,
} from "#/host/target";

/**
 * The shared visual vocabulary for targets. One tone per resolution state, used identically
 * by the composer chip, the picker, the world inspector, and the docs page — so "dashed means
 * inferred" is learned once.
 */

export const LANE_CAT: Record<SessionLane, string> = {
  installed: "slate",
  rrd: "green",
  sandbox: "lichen",
  unknown: "kiln", // attention hue — an unlaned session is unreachable via `user`
};

export function laneVar(lane: SessionLane): string {
  return `var(--cat-${LANE_CAT[lane]})`;
}

export type ChipTone = "muted" | "implicit" | "pinned" | "ambiguous" | "dangling";

export function chipDescriptor(r: TargetResolution): {
  tone: ChipTone;
  text: string;
  detail: string;
} {
  switch (r.kind) {
    case "resolved": {
      const doc = r.session.activeDocumentTitle ?? `Revit ${r.session.processId}`;
      return r.mode === "implicit"
        ? { tone: "implicit", text: `auto · ${doc}`, detail: "sole session — inferred, not chosen" }
        : {
            tone: "pinned",
            text: `${selectorLabel(r.selector)} · ${doc}`,
            detail: "pinned by you",
          };
    }
    case "ambiguous":
      return {
        tone: "ambiguous",
        text: `${r.candidates.length} sessions — pick`,
        detail: "no pin and more than one session; untargeted calls would 409",
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

export const TONE_STYLE: Record<ChipTone, CSSProperties> = {
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

export function toneColor(tone: ChipTone): string {
  return tone === "pinned"
    ? "var(--pe-blue)"
    : tone === "ambiguous"
      ? "var(--cat-kiln)"
      : tone === "dangling"
        ? "var(--cat-clay)"
        : tone === "implicit"
          ? "var(--line-2)"
          : "var(--line)";
}

export function LiveDot({ tone, lane }: { tone: ChipTone; lane?: SessionLane }) {
  const color =
    tone === "pinned"
      ? "var(--pe-blue)"
      : tone === "implicit"
        ? lane
          ? laneVar(lane)
          : "var(--muted-foreground)"
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

export function LaneBadge({ lane }: { lane: SessionLane }) {
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

/** "obs 4s ago" from an observation timestamp; observation only, never computed staleness. */
export function ageLabel(observedAtUnixMs: number | undefined, nowMs: number): string {
  if (!observedAtUnixMs) return "";
  const s = Math.max(0, Math.round((nowMs - observedAtUnixMs) / 1000));
  return s < 60 ? `obs ${s}s ago` : `obs ${Math.round(s / 60)}m ago`;
}

/** One-line mono readout of a resolution — the inspector row. */
export function resolutionReadout(r: TargetResolution): string {
  const sel = `selector=${JSON.stringify(r.selector)}`;
  if (r.kind === "resolved")
    return `${sel} → resolved/${r.mode} · session ${r.session.sessionId} · pid ${r.session.processId} · doc ${r.session.activeDocumentTitle ?? "∅"}`;
  if (r.kind === "ambiguous") return `${sel} → ambiguous · ${r.candidates.length} candidates`;
  return `${sel} → unresolved · ${r.reason}`;
}

export type { SessionFacts };
