import { RevitTarget } from "@pe/kit/lang/revit-target";
import { createContext, useContext, type ReactNode } from "react";
import type { RevitElementReference } from "@pe/kit/lang/revit-target";
import { type ElementTarget, type RevitObservationScope } from "./element-target";
import { documentRefSchema, type DocumentRef } from "@pe/agent-contracts";
import { createPeClient } from "@pe/agent-contracts/pe-api";
import { readPeError } from "@pe/host-contracts/pe-api";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  type OpRequestOf,
  type OpResponseOf,
} from "@pe/host-contracts/operation-types";
import { hostFetch } from "#/host/runtime";

export type NativeObservation = {
  scope: RevitObservationScope | null;
  /** When supplied, only references actually present in this displayed read may be targeted. */
  references?: readonly RevitElementReference[];
};

const Observation = createContext<NativeObservation>({ scope: null });
export const useNativeObservation = () => useContext(Observation);

export function NativeObservationScope({
  value,
  children,
}: {
  value: NativeObservation;
  children: ReactNode;
}) {
  return (
    <Observation value={value}>
      <RevitTarget scope={value.scope}>{children}</RevitTarget>
    </Observation>
  );
}

/** A missing captured member refuses; authored numbers cannot invent a native reference. */
const referenceIndexes = new WeakMap<
  readonly RevitElementReference[],
  ReadonlyMap<number, RevitElementReference>
>();

export function observedElements(
  observation: NativeObservation,
  ids: readonly number[],
): ElementTarget {
  const references = observation.references;
  if (!references) return { scope: observation.scope, ids };
  let byId = referenceIndexes.get(references);
  if (!byId) {
    const index = new Map<number, RevitElementReference>();
    // Preserve the first captured reference, as Array.find did. A new capture gets a new index.
    for (const ref of references)
      if (ref.elementId != null && !index.has(ref.elementId)) index.set(ref.elementId, ref);
    referenceIndexes.set(references, (byId = index));
  }
  return {
    scope: observation.scope,
    ids: [],
    refs: ids.map((id) => byId.get(id) ?? { elementId: null }),
  };
}

/** Keep response authority when a native read will feed a later action. */
export async function readFamilyPlacements(
  request: OpRequestOf<"revit.resolve.family-instances">,
  document: DocumentRef,
): Promise<
  | {
      kind: "read";
      data: OpResponseOf<"revit.resolve.family-instances">;
      document: DocumentRef;
      requestId: string;
    }
  | { kind: "refused"; code: string; message: string }
> {
  const key = "revit.resolve.family-instances";
  const response = await createPeClient(undefined, hostFetch).response(
    "operation.call",
    { body: { key, request } },
    {
      headers: {
        [HOST_RPC_BRIDGE_SESSION_HEADER]: document.session,
        [HOST_RPC_DOCUMENT_HEADER]: document.openId,
        [HOST_RPC_ORIGIN_HEADER]: `web:${window.location.pathname}`,
      },
    },
  );
  if (!response.ok) throw new Error(`${key}: ${(await readPeError(response)).message}`);
  const requestId = response.headers.get("x-pe-native-request-id");
  let resolved: DocumentRef | null = null;
  try {
    const openId = response.headers.get("x-pe-resolved-open-id");
    const parsed = documentRefSchema.safeParse({
      session: response.headers.get("x-pe-resolved-session"),
      openId: openId ? decodeURIComponent(openId) : null,
    });
    if (parsed.success) resolved = parsed.data;
  } catch {
    // Malformed provenance cannot authorize a follow-up native action.
  }
  if (
    !requestId?.trim() ||
    resolved?.session !== document.session ||
    resolved.openId !== document.openId
  )
    return {
      kind: "refused",
      code: "NativeReadProvenanceMismatch",
      message:
        "The native response did not confirm the captured document lifetime; nothing was selected or boxed.",
    };
  return { kind: "read", data: await response.json(), document: resolved, requestId };
}
