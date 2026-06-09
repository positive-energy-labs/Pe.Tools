import type { PeaRuntimeContextEntry } from "./pea-runtime-context.js";
import { sanitizeJson } from "./pea-runtime-events.js";
import type { PeaRuntimeResumeDecision } from "./pea-runtime-interrupts.js";
import type { PeaRuntimeResource } from "./pea-runtime-resources.js";

export interface PeaRuntimePrompt {
  content: string;
  context?: PeaRuntimeContextEntry[];
  resources?: PeaRuntimeResource[];
  resumeDecisions?: PeaRuntimeResumeDecision[];
}

export interface PeaRuntimePromptPart {
  text?: string;
  contextDescription?: string;
  contextValue?: unknown;
  resource?: PeaRuntimeResource;
}

export function createPeaRuntimePrompt(parts: PeaRuntimePromptPart[]): PeaRuntimePrompt {
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
    .filter((entry): entry is PeaRuntimeContextEntry => Boolean(entry?.value.trim()));
  const resources = parts
    .map((part) => part.resource)
    .filter((resource): resource is PeaRuntimeResource => Boolean(resource))
    .map((resource) => stripUndefined(resource));

  return stripUndefined({
    content,
    context: context.length > 0 ? context : undefined,
    resources: resources.length > 0 ? resources : undefined,
  });
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
