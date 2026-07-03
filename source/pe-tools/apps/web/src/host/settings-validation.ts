import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import type {
  SettingsValidationIssue,
  SettingsValidationResult,
} from "@pe/host-contracts/operation-types";

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
type CompileResult = {
  validate?: ValidateFunction;
  errorMessage?: string;
};

const cache = new Map<string, CompileResult>();

function compile(schemaJson: string): CompileResult {
  const cached = cache.get(schemaJson);
  if (cached) return cached;

  try {
    const schema = JSON.parse(schemaJson) as Record<string, unknown>;
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
  return {
    path: error.instancePath.replace(/^\//, "").replace(/\//g, "."),
    code: error.keyword,
    severity: "error",
    message: error.message ?? "Invalid value",
  };
}

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
