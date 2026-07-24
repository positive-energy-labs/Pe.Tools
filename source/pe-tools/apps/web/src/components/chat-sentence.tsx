/**
 * ChatSentence — pea's testimony, posture 1 of the sentence grammar.
 *
 * Read-only: pea routes to documents and worlds; this line narrates actor +
 * verb-status + target and never offers a choice (choosing lives in the plugin
 * sentence's slots). Derivation is pure (`sentenceText`) over the workbench
 * snapshot, the fleet, and the open plugin's trichotomy counts.
 */
import { useEffect, useMemo, useState } from "react";
import {
  documentTrichotomySummary,
  selectSentenceSnapshot,
  type CellSummary,
  type RouteStateSpec,
  type SentenceSnapshot,
} from "@pe/agent-contracts";
import type { z } from "zod";

import { useFleet, worldClause } from "#/host/fleet";
import { selectorLabel } from "#/host/target";
import { useWorkbench } from "#/workbench/provider";
import { useRouteState } from "#/workbench/route-state";

const COMMIT_RELAX_MS = 4_000;
const FAIL_RELAX_MS = 8_000;

export type SentenceTone = "rest" | "active" | "awaiting" | "committed" | "failed";

export interface SentenceLine {
  text: string;
  tone: SentenceTone;
}

/** The whole grammar: one gerund + a status prefix + optional world clause. */
export function sentenceText(input: {
  snapshot: SentenceSnapshot;
  clause: string;
  target?: string;
  staged: CellSummary | null;
  nowMs: number;
}): SentenceLine {
  const { snapshot, clause, target, staged, nowMs } = input;
  const last = snapshot.lastCompleted;
  const sinceLast = last?.completedAt ? nowMs - Date.parse(last.completedAt) : Number.POSITIVE_INFINITY;

  if (last?.isError && sinceLast < FAIL_RELAX_MS && snapshot.phase === "idle")
    return { text: `ran into trouble ${last.activity.gerund}${last.activity.target ? ` ${last.activity.target}` : ""}`, tone: "failed" };

  if (snapshot.phase === "asking")
    return { text: `pea is ${snapshot.activity?.gerund ?? "asking"} — your call`, tone: "awaiting" };

  if (snapshot.phase === "thinking") return { text: "pea is thinking", tone: "active" };

  if (snapshot.phase === "working") {
    const activity = snapshot.activity!;
    const noun = activity.target ? ` ${activity.target}` : "";
    return { text: `pea is ${activity.gerund}${noun}${clause}`, tone: "active" };
  }

  // idle —
  if (
    last &&
    !last.isError &&
    (last.activity.verb === "editing" || last.activity.verb === "suggesting") &&
    sinceLast < COMMIT_RELAX_MS
  ) {
    const noun = last.activity.target ? ` ${last.activity.target}` : "";
    return { text: `finished ${last.activity.gerund}${noun} · just now`, tone: "committed" };
  }
  if (staged && staged.proposals > 0)
    return {
      text: `pea is waiting on your review — ${staged.proposals} proposed${staged.staged ? `, ${staged.staged} staged` : ""}`,
      tone: "awaiting",
    };
  if (target) return { text: `resting — pinned to ${selectorLabel(target)}${clause}`, tone: "rest" };
  return { text: "pea is idle — nothing in flight", tone: "rest" };
}

const TONE_COLOR: Record<SentenceTone, string> = {
  rest: "var(--muted-foreground)",
  active: "var(--cat-kiln)",
  awaiting: "var(--pe-blue)",
  committed: "var(--pe-blue)",
  failed: "var(--cat-clay)",
};

function SentenceLineView({ line }: { line: SentenceLine }) {
  return (
    <span
      className="tele min-w-0 truncate"
      style={{ fontSize: 11, color: TONE_COLOR[line.tone], transition: "color 0.6s" }}
      title="read-only — pea routes to documents; this line is testimony, not a control"
    >
      {line.text}
    </span>
  );
}

/** Re-render heartbeat so relax timers elapse without an event. */
function useNowMs(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return nowMs;
}

function useSentence(staged: CellSummary | null, target?: string): SentenceLine {
  const { debug } = useWorkbench();
  const snapshot = useMemo(() => selectSentenceSnapshot(debug.state), [debug.state]);
  const { worlds } = useFleet();
  const nowMs = useNowMs();
  const clause = target ? worldClause(worlds, target) : "";
  return sentenceText({ snapshot, clause, target, staged, nowMs });
}

export function ChatSentence({ target, spec }: { target?: string; spec?: RouteStateSpec<z.ZodType> }) {
  return spec ? <WithRouteDoc target={target} spec={spec} /> : <Plain target={target} />;
}

function Plain({ target }: { target?: string }) {
  return <SentenceLineView line={useSentence(null, target)} />;
}

function WithRouteDoc({ target, spec }: { target?: string; spec: RouteStateSpec<z.ZodType> }) {
  const route = useRouteState(spec);
  const staged = useMemo(
    () => (route.slice == null ? null : documentTrichotomySummary(route.slice)),
    [route.slice],
  );
  return <SentenceLineView line={useSentence(staged, target)} />;
}
