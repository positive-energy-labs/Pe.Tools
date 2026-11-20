import { randomUUID } from "node:crypto";
import { Context } from "effect";
import type { Caller } from "@pe/agent-contracts";
import type { HostSessionScope } from "@pe/host-contracts/operation-types";
import type {
  RequestIdentity as IdentityKey,
  RequestIdentityData,
  ValidatedOwner,
} from "./request-contracts.d.ts";

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
