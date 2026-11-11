import { useId, useState } from "react";
import { ChevronRight, Hand } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import type { Question } from "@pe/agent-contracts/chat-state";
import { QuestionForm } from "./question-form";

/** Pending questions keep their own identities; run consent is the topbar sweep's (ADR 0035 rule 6). */
export function ComposerPending({
  questions,
  answerQuestion,
}: {
  questions: readonly Question[];
  answerQuestion: (
    requestId: string,
    action: "accept" | "decline",
    content?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const count = questions.length;
  if (!count) return null;
  const first = questions[0]!.message;
  return (
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
  );
}
