import { bindWork, type Address, type DocumentRef } from "@pe/agent-contracts";
import {
  ductsSnapshotReadingSchema,
  ductsTablesReadingSchema,
  ductsReadingEnvelopeSchema,
  type DuctsReadingRequest,
} from "@pe/ducts-contract/reading";
import { product } from "@pe/ducts-contract/product";
import { z } from "zod";
import { catalogsFor, DuctFiles } from "./ducts-files.ts";
import { createDuctsBodyBasis, ductBodySubject } from "./ducts-body-basis.ts";
import { DuctsReadings, ductsReadings, isRetainedReadFailure } from "./ducts-readings.ts";

const resource = z.union([ductsSnapshotReadingSchema, ductsTablesReadingSchema]);
function nativeInput(reading: DuctsReadingRequest) {
  if (reading.kind === "ducts-tables") {
    const { kind: _, session, ...input } = reading;
    return { key: "ducts.tables", input, scope: { bridgeSessionId: session } };
  }
  const { kind: _, target, ...input } = reading;
  return {
    key: input.selector.kind === "roster" ? "ducts.snapshot.roster" : "ducts.snapshot.walk",
    input,
    scope: { bridgeSessionId: target.session, openDocumentId: target.openId },
  };
}

export const gateway = {
  files: DuctFiles,
  catalogsFor,
  retainedOwner: DuctsReadings,
  retainedReadings: ductsReadings,
  retainedFailure: isRetainedReadFailure,
  retainedBasis: createDuctsBodyBasis,
  retainedSubject: ductBodySubject,
  retainedFrame: "ducts.retained",
  retainedHeader: "x-pe-ducts-reused",
  retainedResource: resource,
  retainedEnvelope: ductsReadingEnvelopeSchema,
  retainedNative: nativeInput,
  retainedTarget: (input: DuctsReadingRequest) =>
    input.kind === "ducts-snapshot" ? input.target : { session: input.session, openId: undefined },
  canonicalRetained: (input: DuctsReadingRequest, session: string): DuctsReadingRequest =>
    input.kind === "ducts-snapshot"
      ? { ...input, target: { ...input.target, session } }
      : { ...input, session },
  retainedPolicy: (key: string) => product.callPolicies[key]?.reading,
  bindNetworkWork: (address: Address | null, ref: DocumentRef) =>
    bindWork("duct-systems", address, undefined, ref),
};
