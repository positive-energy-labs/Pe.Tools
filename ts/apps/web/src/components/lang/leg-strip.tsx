/**
 * LEG STRIP — the update receipt as the legs the SDK recorded (machine control plane,
 * design-system ledger 2026-10-09). An observed leg is a fact chip in its status's meaning; the
 * stages not yet observed follow it. While the host is gone they are dashed: not observed is a
 * stand-in, never a success (the honest gap, host ledger 2026-10-09 ruling 6).
 */
import { FactChip } from "./chip";

export interface Leg {
  readonly name: string;
  readonly status: string;
  readonly observedAtUtc: string;
  readonly detail: string | null;
}

/** The update's stages in order; a leg named `stop:2501` belongs to `stop`. */
export const UPDATE_STAGES = ["download", "stop", "handoff", "install", "reopen", "relaunch"];

const stageOf = (name: string) => name.split(":")[0]!;
const toneOf = (status: string) =>
  status === "ok" ? "done" : status === "failed" || status === "refused" ? "alarm" : "meta";

export function LegStrip({
  legs,
  stages = UPDATE_STAGES,
  unobserved,
}: {
  legs: readonly Leg[];
  stages?: readonly string[];
  /** Present while nothing can observe the remaining legs: why. */
  unobserved?: string;
}) {
  const reached = legs.reduce((at, leg) => Math.max(at, stages.indexOf(stageOf(leg.name))), -1);
  const ahead = stages.slice(reached + 1);
  return (
    <span className="inline-flex flex-wrap items-center gap-1" role="list" aria-label="update legs">
      {legs.map((leg, index) => (
        <span role="listitem" key={`${leg.name}-${index}`}>
          <FactChip
            tone={toneOf(leg.status)}
            title={`${leg.name} ${leg.status} at ${leg.observedAtUtc}${leg.detail ? ` · ${leg.detail}` : ""}`}
          >
            {leg.name}
          </FactChip>
        </span>
      ))}
      {ahead.map((stage) => (
        <span role="listitem" key={stage}>
          <FactChip
            dashed={unobserved !== undefined}
            title={unobserved ?? `${stage} has not been recorded yet`}
          >
            {stage}
          </FactChip>
        </span>
      ))}
    </span>
  );
}
