import { useWork } from "@pe/kit/lang/pane";
import { useEffect, useId, useState } from "react";
import { ChevronRight, Hand, Timer } from "lucide-react";
import { toolTitle } from "@pe/agent-contracts";
import { ArmingStrip } from "@pe/kit/lang/arming-strip";
import { Button } from "@pe/kit/lang/button";
import {
  toolDetail,
  type Approval,
  type Question,
  type ToolCall,
} from "@pe/agent-contracts/chat-state";
import { QuestionForm } from "./question-form";

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
  calls: readonly ToolCall[];
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
  // Run consent never folds: its intervention clock must remain visible.
  const holds = asks.filter((approval) => approval.deadline);
  const approvals = asks.filter((approval) => !approval.deadline);
  const count = approvals.length + questions.length;
  const held = holds.map((approval) => (
    <WriteHold
      key={approval.requestId}
      approval={approval}
      caption={callsById.get(approval.toolCallId)?.caption}
      resolve={resolveApproval}
    />
  ));
  if (!count) return held.length ? <>{held}</> : null;
  const firstCall = approvals[0] && callsById.get(approvals[0].toolCallId);
  const first =
    questions[0]?.message ??
    (firstCall && toolDetail(firstCall)?.text) ??
    toolTitle(approvals[0]!.toolName);
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
          {approvals.map((approval) => (
            <ApprovalRequest
              key={approval.requestId}
              approval={approval}
              call={callsById.get(approval.toolCallId)}
              resolve={resolveApproval}
            />
          ))}
        </div>
      </section>
    </>
  );
}

/** One host-owned decision covers this root turn and its delegated descendants. */
function WriteHold({
  approval,
  caption,
  resolve,
}: {
  approval: Approval;
  caption?: string;
  resolve: (requestId: string, optionId: string) => Promise<void>;
}) {
  const left = useSecondsLeft(approval.deadline!);
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
        verb="Allow now"
        cancelLabel="Stop writes for this turn"
        facts={
          <span role="timer" aria-label="Writes allowed in">
            {left}s
          </span>
        }
        target={caption ?? "This turn's writes"}
        says="When the countdown ends, Pea may write across tools and documents for the rest of this turn. Stop writes also stops its delegated work."
        icon={Timer}
        state={{ phase: "arming" }}
        busy={busy}
        onCommit={() => void choose("allow_once")}
        onCancel={() => void choose("reject_once")}
      />
    </section>
  );
}

/** Whole seconds until `deadline`, redrawn each second; zero once it passes. */
function useSecondsLeft(deadline: string) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
}

function ApprovalRequest({
  approval,
  call,
  resolve,
}: {
  approval: Approval;
  call?: ToolCall;
  resolve: (requestId: string, optionId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  useWork(busy, "sending decision…");
  const choose = async (optionId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await resolve(approval.requestId, optionId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="flex min-w-0 flex-col gap-2 py-2"
      data-request-id={approval.requestId}
      data-tool-id={approval.toolCallId}
      aria-busy={busy}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-2">
        <span className="text-ink">{toolTitle(approval.toolName)}</span>
        {call?.target ? (
          <code className="face-mono break-all" data-testid="approval-target">
            {call.target}
          </code>
        ) : null}
      </div>
      {call?.caption ? <p className="text-ink-2">{call.caption}</p> : null}
      <div className="flex min-w-0 flex-col gap-1">
        {approval.options.map((option, index) => (
          <Button
            key={option.optionId}
            kind="framed"
            label={option.name}
            refusal={busy ? "A decision is already being sent." : null}
            data-kind={option.kind}
            onClick={() => void choose(option.optionId)}
          >
            <span className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-2 py-1 text-left">
              <span aria-hidden="true" className="face-mono text-ink-2">
                {index + 1}.
              </span>
              <span className="min-w-0">
                <span className="block">{option.name}</span>
                <span
                  className="block text-ink-2"
                  data-tone={option.kind === "allow_always" ? "caution" : undefined}
                >
                  {VERDICT[option.kind]}
                </span>
              </span>
            </span>
          </Button>
        ))}
      </div>
      {busy ? (
        <span role="status" className="text-ink-2">
          Sending your decision…
        </span>
      ) : null}
    </div>
  );
}

const VERDICT = {
  allow_once: "this call only",
  allow_always: "every call of this kind in this session, beyond this thread",
  reject_once: "refuse",
  reject_always: "refuse every call of this kind in this session, beyond this thread",
} as const;
