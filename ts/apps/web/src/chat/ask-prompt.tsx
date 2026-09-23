/** A live `ask_user`, answered where live asks live: the Chat head (F-J1-9). */
import { useState } from "react";
import { Check } from "lucide-react";

import { ActionButton } from "#/components/lang/action-button";
import { Input } from "#/components/lang/input";
import { Textarea } from "#/components/lang/textarea";
import { readRecord, readString } from "#/workbench/chat-state";
import { Markdown } from "#/workbench/prose";

export type Question = {
  text: string;
  options: { label: string; description?: string }[];
  multiple: boolean;
};

export function readQuestion(payload: unknown): Question | undefined {
  const value = readRecord(payload);
  const text = readString(value?.question);
  if (!text) return undefined;
  const options = Array.isArray(value?.options)
    ? value.options.flatMap((option) => {
        const record = readRecord(option);
        const label = readString(record?.label);
        return label
          ? [
              {
                label,
                ...(readString(record?.description)
                  ? { description: readString(record?.description) }
                  : {}),
              },
            ]
          : [];
      })
    : [];
  return { text, options, multiple: value?.selectionMode === "multi_select" };
}

export function AskUserPrompt({
  toolCallId,
  question,
  resolve,
}: {
  toolCallId: string;
  question: Question;
  resolve: (toolCallId: string, response?: string | string[]) => Promise<void>;
}) {
  const [answer, setAnswer] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="flex min-w-0 flex-col gap-2 py-1">
      {/* A live ask sits in the HEAD, above the composer — so its question is capped and scrolls
          inside itself. A long one (numbered sections, option lists) otherwise grew the head past
          the viewport and pushed the transcript, the answer box and Answer off the page. */}
      <Markdown text={question.text} className="max-h-[22rem] overflow-y-auto pr-2" />
      {question.options.length === 0 ? (
        <>
          <Textarea
            size="compact"
            aria-label="Answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <div>
            <ActionButton
              tone="commit"
              icon={Check}
              label="Answer"
              reason="Send this answer to Pea"
              disabled={!answer.trim()}
              onClick={() => void resolve(toolCallId, answer.trim())}
            />
          </div>
        </>
      ) : question.multiple ? (
        <>
          <div className="flex min-w-0 flex-col gap-1">
            {question.options.map((option) => (
              <label key={option.label} className="flex items-start gap-2 t-prose">
                <Input
                  type="checkbox"
                  checked={selected.includes(option.label)}
                  onChange={() =>
                    setSelected((current) =>
                      current.includes(option.label)
                        ? current.filter((label) => label !== option.label)
                        : [...current, option.label],
                    )
                  }
                />
                <span>
                  {option.label}
                  {option.description ? (
                    <span className="block t-small text-ink-2">{option.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          <div>
            <ActionButton
              tone="commit"
              icon={Check}
              label="Answer"
              reason="Send the selected answers to Pea"
              disabled={selected.length === 0}
              onClick={() => void resolve(toolCallId, selected)}
            />
          </div>
        </>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          {question.options.map((option) => (
            <div key={option.label} className="flex items-baseline gap-2">
              <ActionButton
                tone="act"
                label={option.label}
                reason={option.description ?? `Answer ${option.label}`}
                onClick={() => void resolve(toolCallId, option.label)}
              />
              {option.description ? (
                <span className="t-small text-ink-2">{option.description}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
