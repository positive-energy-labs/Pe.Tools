import { useWork } from "@pe/kit/lang/work";
import { useId, useState } from "react";
import { ChevronRight, Hand, Timer } from "lucide-react";
import { ArmingStrip } from "@pe/kit/lang/arming-strip";
import { Button } from "@pe/kit/lang/button";
import type { Approval, Question, ToolCall } from "@pe/agent-contracts/chat-state";
import { QuestionForm } from "./question-form";
import { secondsLeft, useSecondTick } from "#/shell/countdown";

/** Pending requests keep their own identities and targets; the composer pickers name the next turn. */
export function ComposerPending({
  approvals: asks,
  questions,
  calls,
  resolveApproval,
  answerQuestion,
}: {
  approvals: readonly Approval[];
  questions: readonly Question[];
  calls: readonly Pick<ToolCall, "id" | "caption">[];
  resolveApproval: (requestId: string, optionId: string) => Promise<void>;
  answerQuestion: (
    requestId: string,
    action: "accept" | "decline",
    content?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const callsById = new Map(calls.map((call) => [call.id, call]));
  // Every approval is run consent (ADR 0027 rule 11: no per-call ask). It never folds: its
  // intervention clock must remain visible.
  const count = questions.length;
  const held = asks.map((approval) => (
    <WriteHold
      key={approval.requestId}
      approval={approval}
      caption={callsById.get(approval.toolCallId)?.caption}
      resolve={resolveApproval}
    />
  ));
  if (!count) return held.length ? <>{held}</> : null;
  const first = questions[0]!.message;
  return (
    <>
      {held}
      <section aria-label="Pending requests" className="dl-composer-pending">
        <Button
          kind="framed"
          label={`${count} ${count === 1 ? "request needs" : "requests need"} you`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <span className="dl-composer-queue">
            <Hand aria-hidden="true" className="size-3.5 shrink-0" data-tone="caution" />
            <strong className="shrink-0">
              {count} {count === 1 ? "request needs" : "requests need"} you
            </strong>
            <span className="min-w-0 truncate text-ink-2">{first}</span>
            <ChevronRight
              aria-hidden="true"
              className={`ml-auto size-3.5 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            />
          </span>
        </Button>
        {/* Keep question fields mounted while folded so a partial answer survives queue review. */}
        <div id={panelId} hidden={!open} className="dl-composer-requests hairline-rows">
          {questions.map((question) => (
            <QuestionForm
              key={question.requestId}
              question={question}
              onAnswer={(action, content) => answerQuestion(question.requestId, action, content)}
            />
          ))}
        </div>
      </section>
    </>
  );
}

/** One host-owned decision covers this thread until Stop, and its delegated descendants. */
function WriteHold({
  approval,
  caption,
  resolve,
}: {
  approval: Approval;
  caption?: string;
  resolve: (requestId: string, optionId: string) => Promise<void>;
}) {
  const left = useSecondsLeft(approval.deadline);
  const [busy, setBusy] = useState(false);
  useWork(busy, "sending decision…");
  const choose = async (kind: "allow_once" | "reject_once") => {
    const option = approval.options.find((each) => each.kind === kind);
    if (busy || !option) return;
    setBusy(true);
    try {
      await resolve(approval.requestId, option.optionId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="Write waiting"
      className="dl-composer-pending"
      data-request-id={approval.requestId}
    >
      <ArmingStrip
        verb={approval.deadline ? "Allow now" : "Allow"}
        cancelLabel="Reject"
        facts={
          left === null ? (
            <span>Auto-approve is off</span>
          ) : (
            <span role="timer" aria-label="Writes apply in">
              Reject? {left}s
            </span>
          )
        }
        target={caption ?? "This thread's writes"}
        says={
          approval.deadline
            ? "When the countdown ends, Pea writes across tools and documents for this thread until Stop. Reject also stops its delegated work."
            : "Auto-approve is off: Pea's writes in this thread wait for you. Allow covers this thread until Stop."
        }
        icon={Timer}
        state={{ phase: "arming" }}
        busy={busy}
        onCommit={() => void choose("allow_once")}
        onCancel={() => void choose("reject_once")}
      />
    </section>
  );
}

/** Whole seconds until `deadline` (the shared countdown the Timeline head also draws); null without one. */
function useSecondsLeft(deadline?: string) {
  useSecondTick(!!deadline);
  return deadline ? secondsLeft(deadline) : null;
}
