import { Ajv, type ValidateFunction } from "ajv";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { refused } from "./command-executor.ts";
import { z } from "zod";
import type { HostOperationKey, OpRequestOf } from "@pe/host-contracts/operation-types";

const validator = new Ajv({ strict: false, allErrors: true });
const compiled = new Map<string, ValidateFunction>();
const contracts = new Map<string, string | null | undefined>(
  hostOpCatalog.map((operation) => [operation.key, operation.requestSchemaJson]),
);

/** C# request metadata validates captured execution again after persistence or recovery. */
function nativeInputProblem(key: string, input: unknown, json = contracts.get(key)): string | null {
  if (!json) return null;
  let check = compiled.get(json);
  if (!check) {
    const schema = JSON.parse(json);
    delete schema.$schema;
    check = validator.compile(schema);
    compiled.set(json, check);
  }
  return check(input)
    ? null
    : `Invalid native input for '${key}': ${validator.errorsText(check.errors)}`;
}

export function validateNativeInput(key: string, input: unknown, json = contracts.get(key)): void {
  const problem = nativeInputProblem(key, input, json);
  if (problem) throw refused(problem, "native.input");
}

/** Prepared payloads use the same generated DTO authority as the native dispatch boundary. */
export const nativeInputSchema = <K extends HostOperationKey>(key: K): z.ZodType<OpRequestOf<K>> =>
  z.custom<OpRequestOf<K>>().superRefine((input, context) => {
    const problem = nativeInputProblem(key, input);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });
