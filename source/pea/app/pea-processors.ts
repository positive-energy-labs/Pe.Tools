import type { ErrorProcessor, InputProcessor } from "@mastra/core/processors";

const removeValue = Symbol("removeValue");

type TransformResult =
  | { changed: false; value: unknown }
  | { changed: true; value: unknown | typeof removeValue };

export function createOpenAIResponsesHistoryCompatProcessor(): InputProcessor & ErrorProcessor {
  return {
    id: "pea-openai-responses-history-compat",
    name: "Pea OpenAI Responses History Compatibility",
    description: "Prevents stale OpenAI Responses item references from breaking replay while preserving prompt caching intent.",
    processLLMRequest: ({ prompt }) => {
      const result = stripOpenAIResponsesItemReferences(prompt);
      return result.changed ? { prompt: result.value as typeof prompt } : undefined;
    },
    processAPIError: ({ error, messages, retryCount }) => {
      if (retryCount > 0 || !isMissingOpenAIResponsesItemError(error))
        return undefined;

      const result = stripOpenAIResponsesItemReferences(messages);
      if (result.changed && Array.isArray(result.value)) {
        messages.splice(0, messages.length, ...result.value as typeof messages);
      }

      return { retry: true };
    },
  };
}

export function stripOpenAIResponsesItemReferences<T>(value: T): { changed: boolean; value: T } {
  const result = stripOpenAIResponsesItemReferencesCore(value);
  return {
    changed: result.changed,
    value: (result.value === removeValue ? value : result.value) as T,
  };
}

export function isMissingOpenAIResponsesItemError(error: unknown): boolean {
  return /Item with id ['"]rs_[^'"]+['"] not found/i.test(errorToText(error));
}

function stripOpenAIResponsesItemReferencesCore(value: unknown): TransformResult {
  if (Array.isArray(value)) {
    let changed = false;
    const next: unknown[] = [];
    for (const item of value) {
      const result = stripOpenAIResponsesItemReferencesCore(item);
      if (result.changed)
        changed = true;
      if (result.value !== removeValue)
        next.push(result.value);
      else
        changed = true;
    }

    return changed ? { changed: true, value: next } : { changed: false, value };
  }

  if (!isRecord(value))
    return { changed: false, value };

  if (isOpenAIResponsesItemReference(value))
    return { changed: true, value: removeValue };

  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const providerOptionsResult = stripOpenAIItemIdFromProviderMap(key, child);
    if (providerOptionsResult.handled) {
      changed ||= providerOptionsResult.changed;
      if (providerOptionsResult.value !== undefined)
        next[key] = providerOptionsResult.value;
      continue;
    }

    const childResult = stripOpenAIResponsesItemReferencesCore(child);
    if (childResult.changed)
      changed = true;
    if (childResult.value !== removeValue)
      next[key] = childResult.value;
    else
      changed = true;
  }

  return changed ? { changed: true, value: next } : { changed: false, value };
}

function stripOpenAIItemIdFromProviderMap(
  key: string,
  value: unknown,
): { handled: false } | { handled: true; changed: boolean; value: unknown | undefined } {
  if (key !== "providerOptions" && key !== "providerMetadata")
    return { handled: false };
  if (!isRecord(value))
    return { handled: true, changed: false, value };

  const openai = value.openai;
  if (!isRecord(openai) || !("itemId" in openai))
    return { handled: true, changed: false, value };

  const nextOpenAI = { ...openai };
  delete nextOpenAI.itemId;

  const nextProviderMap = { ...value };
  if (Object.keys(nextOpenAI).length > 0)
    nextProviderMap.openai = nextOpenAI;
  else
    delete nextProviderMap.openai;

  return {
    handled: true,
    changed: true,
    value: Object.keys(nextProviderMap).length > 0 ? nextProviderMap : undefined,
  };
}

function isOpenAIResponsesItemReference(value: Record<string, unknown>): boolean {
  const type = value.type;
  return (type === "item_reference" || type === "item-reference")
    && typeof value.id === "string"
    && value.id.startsWith("rs_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function errorToText(error: unknown): string {
  if (error instanceof Error) {
    return [
      error.message,
      error.stack,
      errorToText((error as Error & { cause?: unknown }).cause),
    ].filter(Boolean).join("\n");
  }

  if (typeof error === "string")
    return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
