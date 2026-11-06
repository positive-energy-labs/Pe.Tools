import { randomUUID, createHash } from "node:crypto";
import { Ajv } from "ajv";
import { Context, Effect, Layer, Schema } from "effect";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { InvalidRead } from "./native-reads.ts";
import type {
  RequestIdentity as IdentityKey,
  RequestIdentityData,
  ValidatedOwner,
} from "@pe/host-internal/request-contracts";
import type { Caller } from "@pe/agent-contracts";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";

export class ResourceConnectionOwner extends Context.Service<ResourceConnectionOwner, string | null>()("pe/ResourceConnectionOwner") {}

export const RequestIdentity = Context.Service<IdentityKey, RequestIdentityData>("RequestIdentity");

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Called only after transport admission. Command ownership is established separately by C. */
export function admittedRequestIdentity(
  caller: Caller,
  scope: HostSessionScope,
): RequestIdentityData {
  const requestId = randomUUID();
  return freeze({
    requestId,
    // Freeze the admitted caller in place: page-door authority is keyed by its identity.
    caller,
    scope: structuredClone(scope),
    ownership: {
      owner: requestId as ValidatedOwner,
      causalParent: undefined,
      policy: {
        descendants: "active-admitted",
        committedWrites: "preserve",
        parentSettlement: "await-required-descendant-terminal-evidence",
      },
      terminal: { kind: "unsettled", requiredDescendants: [], evidence: [] },
    },
  });
}

/** One host generation, conservatively advanced by journal and native change observations. */
export class ReadFreshness extends Context.Service<
  ReadFreshness,
  {
    readonly current: () => string;
    readonly advance: () => void;
  }
>()("ReadFreshness") {
  static readonly layer = Layer.sync(ReadFreshness, () => {
    const incarnation = randomUUID();
    let generation = 0n;
    return {
      current: () => `${incarnation}:${generation}`,
      advance: () => {
        generation++;
      },
    };
  });
}

/** The generated C# contract remains authority. Effect Schema owns decoding/encoding;
 * the existing Ajv engine evaluates its draft-04 constraints without a lossy translation. */
export const readSchemas = Effect.fn("ReadAdmission.schemas")(function* (key: string) {
  const operation = hostOpCatalog.find((entry) => entry.key === key);
  if (!operation)
    return yield* new InvalidRead({
      message: "Native read has no generated contract",
      status: 409,
      problem: "read.contract",
    });
  return yield* Effect.try({
    try: () => {
      const schema = (json: string) => {
        const raw = JSON.parse(json);
        delete raw.$schema;
        const ajv = new Ajv({ strict: false, allErrors: false, addUsedSchema: false });
        const validate = ajv.compile(raw);
        return Schema.Json.check(
          Schema.makeFilter(
            (value) => validate(value) || "Value violates the generated native contract",
          ),
        );
      };
      return {
        request: schema(operation.requestSchemaJson),
        response: schema(operation.responseSchemaJson),
        version: createHash("sha256").update(operation.responseSchemaJson).digest("hex"),
      };
    },
    catch: () =>
      new InvalidRead({
        message: "Native read contract could not be compiled",
        status: 409,
        problem: "read.contract",
      }),
  });
});
