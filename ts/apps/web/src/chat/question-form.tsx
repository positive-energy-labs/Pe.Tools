/**
 * The question card: one ACP elicitation form (`question_request`) in the composer head, beside
 * the approval cards. Each property of the requested schema is one field: a `oneOf` is a pick, an
 * array of `anyOf` a multi-pick, a boolean a check, a number or a string a box. Answer sends the
 * content keyed by property; Skip declines and the harness goes on without an answer.
 */
import { useRef, useState } from "react";

import { Input } from "@pe/kit/lang/input";
import { Button } from "@pe/kit/lang/button";
import { useScopeKeys } from "@pe/kit/keys";
import type { Question } from "#/workbench/chat-state";

type Option = { const: unknown; title?: string; description?: string };
type Property = {
  type?: string;
  title?: string;
  description?: string;
  oneOf?: Option[];
  enum?: unknown[];
  items?: { anyOf?: Option[]; enum?: unknown[] };
};

/** A schema constant as the user reads it. */
const label = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** The choices a property offers, or undefined for a free box. */
const choices = (property: Property): Option[] | undefined =>
  property.oneOf ??
  property.items?.anyOf ??
  (property.enum ?? property.items?.enum)?.map((value) => ({ const: value, title: label(value) }));

export function QuestionForm({
  question,
  onAnswer,
}: {
  question: Question;
  onAnswer: (
    action: "accept" | "decline",
    content?: Record<string, unknown>,
  ) => void | Promise<void>;
}) {
  const schema = question.requestedSchema as {
    properties?: Record<string, Property>;
    required?: string[];
  };
  const fields = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  const [content, setContent] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const region = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const set = (key: string, value: unknown) =>
    setContent((previous) => ({ ...previous, [key]: value }));
  const missing = fields.some(
    ([key]) => required.has(key) && (content[key] === undefined || content[key] === ""),
  );
  const answer = async (action: "accept" | "decline", values = content) => {
    if (
      sending.current ||
      (action === "accept" &&
        fields.some(
          ([key]) => required.has(key) && (values[key] === undefined || values[key] === ""),
        ))
    )
      return;
    sending.current = true;
    setBusy(true);
    try {
      await onAnswer(action, action === "accept" ? values : undefined);
    } finally {
      setBusy(false);
      sending.current = false;
    }
  };
  useScopeKeys(
    [
      {
        hotkey: "Enter",
        label: "Answer question",
        options: { ignoreInputs: false },
        callback: (event) => {
          if (event.isComposing || event.repeat) return;
          const target = event.target as HTMLElement;
          if (target.closest('[data-question-action="decline"]')) {
            void answer("decline");
            return;
          }
          const radio = target.closest<HTMLElement>('[role="radio"]');
          const key = radio?.dataset.field;
          const option = key && choices(schema.properties![key]!)?.[Number(radio.dataset.option)];
          const values = key && option ? { ...content, [key]: option.const } : content;
          if (key && option) set(key, option.const);
          void answer("accept", values);
        },
      },
    ],
    region,
  );
  return (
    // A group, not a form: the composer around it is the form, and a form never nests.
    <div
      ref={region}
      role="group"
      aria-label={question.message}
      className="flex w-full min-w-0 flex-col gap-2 py-0.5"
      data-question-id={question.requestId}
      aria-busy={busy}
    >
      <p className="t-prose text-ink">
        <span aria-hidden="true" className="face-mono text-ink-2">
          ?{" "}
        </span>
        {question.message}
      </p>
      {fields.map(([key, property]) => (
        <Field
          key={key}
          id={`${question.requestId}-${key}`}
          fieldKey={key}
          property={property}
          value={content[key]}
          disabled={busy}
          onChange={(value) => set(key, value)}
        />
      ))}
      <div className="flex items-center justify-end gap-2 py-2">
        <span data-question-action="decline">
          <Button
            kind="framed"
            label="Skip"
            reason="Continue without answering this question"
            busy={busy}
            onClick={() => void answer("decline")}
          >
            Skip
          </Button>
        </span>
        <Button
          kind="commit"
          label="Answer"
          busy={busy}
          reason="Send this answer · Enter"
          refusal={missing ? "Complete the required fields before answering" : null}
          onClick={() => void answer("accept")}
        >
          Answer
        </Button>
      </div>
      {busy ? (
        <span role="status" className="t-small text-ink-2">
          Sending your answer…
        </span>
      ) : null}
    </div>
  );
}

function Field({
  id,
  fieldKey,
  property,
  value,
  onChange,
  disabled,
}: {
  id: string;
  fieldKey: string;
  property: Property;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const options = choices(property);
  const head =
    property.title || property.description ? (
      <span className="t-small text-ink-2">
        {property.title}
        {property.title && property.description ? " · " : null}
        {property.description}
      </span>
    ) : null;
  if (options && property.type === "array") {
    const picked = Array.isArray(value) ? (value as unknown[]) : [];
    return (
      <div className="flex flex-col gap-1">
        {head}
        {options.map((option) => (
          <label key={label(option.const)} className="flex items-baseline gap-2 t-prose">
            <Input
              type="checkbox"
              disabled={disabled}
              checked={picked.includes(option.const)}
              onChange={(event) =>
                onChange(
                  event.currentTarget.checked
                    ? [...picked, option.const]
                    : picked.filter((item) => item !== option.const),
                )
              }
            />
            <span>{option.title ?? label(option.const)}</span>
            {option.description ? (
              <span className="t-small text-ink-2">{option.description}</span>
            ) : null}
          </label>
        ))}
      </div>
    );
  }
  if (options)
    return (
      <div className="flex flex-col gap-1">
        {head}
        <div
          role="radiogroup"
          aria-label={property.title ?? fieldKey}
          className="hairline-y hairline-rows flex w-full min-w-0 flex-col [&>button]:w-full"
          onKeyDown={(event) => {
            if (
              !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(
                event.key,
              )
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
            ];
            const current = buttons.indexOf(event.target as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (current +
                      (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) +
                      buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
            buttons[next]?.click();
          }}
        >
          {options.map((option, index) => (
            <Button
              key={label(option.const)}
              type="button"
              label={option.title ?? label(option.const)}
              refusal={disabled ? "The answer is being sent." : null}
              role="radio"
              aria-checked={value === option.const}
              tabIndex={value === option.const || (value === undefined && index === 0) ? 0 : -1}
              data-field={fieldKey}
              data-option={index}
              data-selected={value === option.const ? "" : undefined}
              onClick={() => onChange(option.const)}
            >
              <span className="grid w-full grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 px-2 py-1.5 text-left">
                <span aria-hidden="true" className="face-mono text-ink-2">
                  {value === option.const ? "●" : `${index + 1}.`}
                </span>
                <span className="min-w-0">
                  <span className="block">{option.title ?? label(option.const)}</span>
                  {option.description ? (
                    <span className="mt-0.5 block t-small text-ink-2">{option.description}</span>
                  ) : null}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </div>
    );
  if (property.type === "boolean")
    return (
      <label className="flex items-baseline gap-2 t-prose">
        <Input
          type="checkbox"
          disabled={disabled}
          checked={value === true}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        {head ?? <span>{id}</span>}
      </label>
    );
  const numeric = property.type === "number" || property.type === "integer";
  return (
    <label className="flex flex-col gap-1">
      {head}
      <Input
        id={id}
        type={numeric ? "number" : "text"}
        disabled={disabled}
        value={value === undefined ? "" : label(value)}
        placeholder={property.title ?? "Type your answer"}
        onChange={(event) => {
          const text = event.currentTarget.value;
          onChange(numeric ? (text === "" ? undefined : Number(text)) : text);
        }}
      />
    </label>
  );
}
