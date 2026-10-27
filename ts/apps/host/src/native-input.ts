import { Ajv, type ValidateFunction } from "ajv";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { BridgeError } from "./bridge.ts";

const validator = new Ajv({ strict: false, allErrors: true });
const compiled = new Map<string, ValidateFunction>();
const contracts = new Map<string, string | null | undefined>(
  hostOpCatalog.map((operation) => [operation.key, operation.requestSchemaJson]),
);

/** C# request metadata validates captured execution again after persistence or recovery. */
export function validateNativeInput(key: string, input: unknown): void {
  const json = contracts.get(key);
  if (!json) return;
  let check = compiled.get(key);
  if (!check) {
    const schema = JSON.parse(json);
    delete schema.$schema;
    check = validator.compile(schema);
    compiled.set(key, check);
  }
  if (!check(input))
    throw new BridgeError(
      `Invalid native input for '${key}': ${validator.errorsText(check.errors)}`,
      409,
      { notDispatched: true },
    );
}
