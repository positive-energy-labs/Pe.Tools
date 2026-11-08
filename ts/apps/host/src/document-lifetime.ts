import { Effect } from "effect";
import type { DocumentRef } from "@pe/agent-contracts";
import type { RevitBridge } from "./bridge.ts";
import { refused } from "./command-executor.ts";
import { readOriginalProcess, type NativeProcess, type SdkReceiptReader } from "./native-receipts.ts";
import { resolveSdkSession, SdkSession } from "./sdk-session.ts";

export async function currentDocument(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  requiredKind: boolean | "project",
  process?: NativeProcess,
) {
  // effect-edge: island, phase 5
  const session = await Effect.runPromise(
    SdkSession.resolve(bridge, { session: target.session }).pipe(
      Effect.mapError((error) => refused(error.message)),
    ),
  );
  const doc = session.state?.openDocuments.find((d) => d.openId === target.openId);
  if (
    !doc ||
    (requiredKind === true && !doc.isFamilyDocument) ||
    (requiredKind === "project" && doc.isFamilyDocument) ||
    (process &&
      (session.processId !== process.pid ||
        session.processStartUtcUnixMs !== Date.parse(process.processStartUtc)))
  )
    throw refused("The exact admitted document lifetime/process is no longer available");
  return session;
}
export async function lifetime(
  bridge: RevitBridge["Service"],
  target: DocumentRef,
  requiredKind: boolean | "project",
  deps: { sdk?: SdkReceiptReader },
) {
  const session = await resolveSdkSession(
    bridge,
    { bridgeSessionId: target.session, openDocumentId: target.openId },
    deps.sdk,
  );
  await currentDocument(bridge, target, requiredKind);
  if (!session.processId || session.processStartUtcUnixMs == null)
    throw refused("Original process identity unavailable");
  const process = await readOriginalProcess(
    session.processId,
    session.processStartUtcUnixMs,
    deps.sdk,
  );
  return { session: await currentDocument(bridge, target, requiredKind, process), process };
}
