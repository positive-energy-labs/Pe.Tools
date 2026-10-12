/**
 * The question card: one ACP elicitation form (`question_request`) in the composer head, beside
 * the approval cards. Each property of the requested schema is one field: a `oneOf` is a pick, an
 * array of `anyOf` a multi-pick, a boolean a check, a number or a string a box. Answer sends the
 * content keyed by property; Skip declines and the harness goes on without an answer.
 */
import { useState } from "react";

import { Input } from "#/components/lang/input";
import { Press } from "#/components/lang/press";
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
  onAnswer: (action: "accept" | "decline", content?: Record<string, unknown>) => void;
}) {
  const schema = question.requestedSchema as {
    properties?: Record<string, Property>;
    required?: string[];
  };
  const fields = Object.entries(schema.properties ?? {});
  const required = new Set(schema.required ?? []);
  const [content, setContent] = useState<Record<string, unknown>>({});
  const set = (key: string, value: unknown) =>
    setContent((previous) => ({ ...previous, [key]: value }));
  const missing = fields.some(
    ([key]) => required.has(key) && (content[key] === undefined || content[key] === ""),
  );
  return (
    // A group, not a form: the composer around it is the form, and a form never nests.
    <div
      role="group"
      aria-label={question.message}
      className="flex w-full min-w-0 flex-col gap-2 py-0.5"
      data-question-id={question.requestId}
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
          property={property}
          value={content[key]}
          onChange={(value) => set(key, value)}
        />
      ))}
      <div className="flex gap-2">
        <Press
          type="button"
          size="value"
          disabled={missing}
          aria-label="Answer"
          onClick={() => onAnswer("accept", content)}
        >
          <span className="px-2 py-1">Answer</span>
        </Press>
        <Press
          type="button"
          tone="quiet"
          size="value"
          aria-label="Skip the question"
          onClick={() => onAnswer("decline")}
        >
          <span className="px-2 py-1">Skip</span>
        </Press>
      </div>
    </div>
  );
}

function Field({
  id,
  property,
  value,
  onChange,
}: {
  id: string;
  property: Property;
  value: unknown;
  onChange: (value: unknown) => void;
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
        <div className="hairline-y hairline-rows flex w-full min-w-0 flex-col [&>button]:w-full">
          {options.map((option, index) => (
            <Press
              key={label(option.const)}
              type="button"
              size="value"
              aria-label={option.title ?? label(option.const)}
              aria-pressed={value === option.const}
              data-picked={value === option.const ? "" : undefined}
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
            </Press>
          ))}
        </div>
      </div>
    );
  if (property.type === "boolean")
    return (
      <label className="flex items-baseline gap-2 t-prose">
        <Input
          type="checkbox"
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
