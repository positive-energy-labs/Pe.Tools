/**
 * ChatSentence — the chat lane's mount of THE sentence (components/sentence.tsx).
 *
 * Targeting is the sentence's core: the world clause is the chat's one bind
 * control, writing the `?target` pin through useChatTarget. Pea's testimony is
 * the status EXTENSION: `sentenceText` derives a pure status line (actor +
 * verb-status + target) from the workbench snapshot, the fleet, and the open
 * plugin's trichotomy counts, and feeds it in as the prefix.
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

import { useChatTarget } from "#/components/chat-target";
import { Sentence, type SentenceTone } from "#/components/sentence";
import { useWorkbench } from "#/workbench/provider";
import { useRouteState } from "#/workbench/route-state";

const COMMIT_RELAX_MS = 4_000;
const FAIL_RELAX_MS = 8_000;

export type { SentenceTone };

export interface SentenceLine {
  text: string;
  tone: SentenceTone;
}

/** The status grammar: one gerund + a status prefix + optional world clause. Pure. */
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
  if (target) return { text: "resting — pinned", tone: "rest" };
  return { text: "pea is idle — nothing in flight", tone: "rest" };
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

function useStatusLine(staged: CellSummary | null, target: string): SentenceLine {
  const { debug } = useWorkbench();
  const snapshot = useMemo(() => selectSentenceSnapshot(debug.state), [debug.state]);
  const nowMs = useNowMs();
  // The world clause is the sentence's own slot now — the status line stays clause-free.
  return sentenceText({ snapshot, clause: "", target: target || undefined, staged, nowMs });
}

export function ChatSentence({ spec }: { spec?: RouteStateSpec<z.ZodType> }) {
  return spec ? <WithRouteDoc spec={spec} /> : <Plain />;
}

function ChatMount({ staged }: { staged: CellSummary | null }) {
  const { selector, pin } = useChatTarget();
  const line = useStatusLine(staged, selector);
  return (
    <Sentence
      prefix={line.text}
      prefixTone={line.tone}
      target={selector}
      onBind={(next) => pin(next ?? "")}
    />
  );
}

function Plain() {
  return <ChatMount staged={null} />;
}

function WithRouteDoc({ spec }: { spec: RouteStateSpec<z.ZodType> }) {
  const route = useRouteState(spec);
  const staged = useMemo(
    () => (route.slice == null ? null : documentTrichotomySummary(route.slice)),
    [route.slice],
  );
  return <ChatMount staged={staged} />;
}
