import type { RuntimeContextEntry } from "./context.ts";
import { sanitizeJson } from "./events.ts";
import type { RuntimeResumeDecision } from "./interrupts.ts";
import type { RuntimeResource } from "./resources.ts";

export interface RuntimePrompt {
  content: string;
  context?: RuntimeContextEntry[];
  resources?: RuntimeResource[];
  resumeDecisions?: RuntimeResumeDecision[];
}

export interface RuntimePromptPart {
  text?: string;
  contextDescription?: string;
  contextValue?: unknown;
  resource?: RuntimeResource;
}

export function createRuntimePrompt(parts: RuntimePromptPart[]): RuntimePrompt {
  const content = parts
    .map((part) => part.text?.trim())
    .filter((text): text is string => Boolean(text))
    .join("\n\n");
  const context = parts
    .map((part) => {
      if (!part.contextDescription || part.contextValue === undefined) return undefined;
      const value =
        typeof part.contextValue === "string"
          ? part.contextValue
          : JSON.stringify(sanitizeJson(part.contextValue), null, 2);
      return {
        description: part.contextDescription,
        value,
      };
    })
    .filter((entry): entry is RuntimeContextEntry => Boolean(entry?.value.trim()));
  const resources = parts
    .map((part) => part.resource)
    .filter((resource): resource is RuntimeResource => Boolean(resource))
    .map((resource) => stripUndefined(resource));

  return stripUndefined({
    content,
    context: context.length > 0 ? context : undefined,
    resources: resources.length > 0 ? resources : undefined,
  });
}

function stripUndefined<T extends object>(value: T): T {
  const result = { ...value };
  for (const key in result) {
    if (result[key] === undefined) delete result[key];
  }
  return result;
}
