import { selectorLabel, type Lane, type TargetResolution } from "#/host/target";

/**
 * The shared visual vocabulary for targets. One tone per resolution state, used identically
 * by the composer chip, the picker, and the world inspector — so "dashed means inferred" is
 * learned once.
 *
 * Colour (2026-08-16 shared-chrome pass): lanes are TAXONOMY — they spend the viz ladder
 * (label carries the meaning; colour only speeds it up). Resolution states spend meaning
 * roles: a resolved live connection is `--r-done` (the /instances phase verdict precedent),
 * ambiguity and a dangling pin are `--r-caution` (attention/stale — a busy or stale target
 * is not the model disagreeing), and "nothing there" is a hairline. No blue: pinned-by-you
 * is authorship, and authorship never buys the commit hue.
 */

// Keyed by the SDK's `Lane` union, so a lane the SDK adds is a compile error here rather than an
// undefined viz rung. A session that reported no lane has no lane badge at all — the honest
// rendering of "not reported", and the reason there is no "unknown" member to colour.
const LANE_VIZ: Record<Lane, string> = {
  installed: "3", // slate's viz rung — series identity carried over from cat-slate
  dev: "2",
};

export function laneVar(lane: Lane): string {
  return `var(--viz-${LANE_VIZ[lane]})`;
}

type ChipTone = "muted" | "implicit" | "pinned" | "ambiguous" | "dangling";

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

export function LiveDot({ tone, lane }: { tone: ChipTone; lane?: Lane | null }) {
  const color =
    tone === "pinned"
      ? "var(--r-done)"
      : tone === "implicit"
        ? lane
          ? laneVar(lane)
          : "var(--r-ink-2)"
        : tone === "ambiguous"
          ? "var(--r-caution)"
          : tone === "dangling"
            ? "var(--r-caution)"
            : "var(--r-line-2)";
  return (
    <span
      className="inline-block shrink-0"
      style={{ width: 6, height: 6, borderRadius: 1, background: color }}
    />
  );
}

export function LaneBadge({ lane }: { lane: Lane }) {
  return (
    <span
      className="face-mono t-caption"
      style={{
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

/** One-line mono readout of a resolution — the inspector row. */
export function resolutionReadout(r: TargetResolution): string {
  const sel = `selector=${JSON.stringify(r.selector)}`;
  if (r.kind === "resolved")
    return `${sel} → resolved/${r.mode} · session ${r.session.sessionId} · pid ${r.session.processId} · doc ${r.session.activeDocumentTitle ?? "∅"}`;
  if (r.kind === "ambiguous") return `${sel} → ambiguous · ${r.candidates.length} candidates`;
  return `${sel} → unresolved · ${r.reason}`;
}
