import { token } from "#/lib/token";
import type { Lane } from "#/readings";

/**
 * The shared visual vocabulary for targets. One tone per resolution state, used identically
 * by the composer chip, the picker, and the world inspector — so "dashed means inferred" is
 * learned once.
 *
 * Colour (2026-08-16 shared-chrome pass): lanes are TAXONOMY — they spend the viz ladder
 * (label carries the meaning; colour only speeds it up). Resolution states spend meaning
 * roles: a resolved live connection is `--pe-done` (the /instances phase verdict precedent),
 * ambiguity and a dangling pin are `--pe-caution` (attention/stale — a busy or stale target
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
  return token(`viz-${LANE_VIZ[lane]}`);
}

type ChipTone = "muted" | "implicit" | "pinned" | "ambiguous" | "dangling";

export function LiveDot({ tone, lane }: { tone: ChipTone; lane?: Lane | null }) {
  const color =
    tone === "pinned"
      ? token("done")
      : tone === "implicit"
        ? lane
          ? laneVar(lane)
          : token("ink-2")
        : tone === "ambiguous"
          ? token("caution")
          : tone === "dangling"
            ? token("caution")
            : token("line-2");
  return <span style={{ width: 6, height: 6, borderRadius: 1, backgroundColor: color }} />;
}

export function DeployBadge({ lane }: { lane: Lane }) {
  return (
    <span
      style={{
        padding: "0 4px",
        borderRadius: "var(--radius)",
        color: laneVar(lane),
        backgroundColor: `color-mix(in srgb, ${laneVar(lane)} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${laneVar(lane)} 25%, transparent)`,
      }}
    >
      {lane.toUpperCase()}
    </span>
  );
}
