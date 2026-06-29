/**
 * Client-side settings validation against the runtime JSON Schema.
 *
 * The host validates authored documents server-side with NJsonSchema; this runs
 * the SAME schema (the `schemaJson` string returned by `settings.schema`) through
 * Ajv in the browser, so the editor gets instant, server-parity feedback —
 * including any `minimum`/`maximum`/`pattern`/`required` keywords NJsonSchema
 * emits from C# DataAnnotations. The schema is the single source; both sides just
 * run a JSON Schema validator over it.
 */
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";

import type { SettingsValidationIssue, SettingsValidationResult } from "@pe/host-generated/zod";

// strict:false ignores the host's `x-ui`/`x-options`/`x-data` extension keywords.
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
interface CompileResult {
  validate?: ValidateFunction;
  errorMessage?: string;
}

const cache = new Map<string, CompileResult>();

function compile(schemaJson: string): CompileResult {
  const cached = cache.get(schemaJson);
  if (cached !== undefined) return cached;

  try {
    const schema = JSON.parse(schemaJson) as Record<string, unknown>;
    // Let Ajv use its default dialect; NJsonSchema's $schema may name a draft
    // Ajv's base build doesn't register.
    delete schema.$schema;
    const result = { validate: ajv.compile(schema) };
    cache.set(schemaJson, result);
    return result;
  } catch (error) {
    const result = {
      errorMessage:
        error instanceof Error ? error.message : "Settings schema could not be compiled.",
    };
    cache.set(schemaJson, result);
    return result;
  }
}

function toIssue(error: ErrorObject): SettingsValidationIssue {
  const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
  return {
    path,
    code: error.keyword,
    severity: "error",
    message: error.message ?? "Invalid value",
  };
}

/** Validate a settings document against its runtime JSON Schema, in the browser. */
export function validateSettingsDocument(
  schemaJson: string,
  value: unknown,
): SettingsValidationResult {
  const { validate, errorMessage } = compile(schemaJson);
  if (!validate) {
    return {
      isValid: false,
      issues: [
        {
          path: "$",
          code: "schema_compile",
          severity: "error",
          message: errorMessage ?? "Settings schema could not be compiled.",
        },
      ],
    };
  }

  const ok = validate(value) as boolean;
  return { isValid: ok, issues: ok ? [] : (validate.errors ?? []).map(toIssue) };
}
