import { freezeScript } from "./operation-script.ts";
import { Ajv, type ValidateFunction } from "ajv";
import { Effect, Schema } from "effect";
import {
  actionAdmissionSchema,
  nativeProcessSchema,
  type ExecutionTarget,
} from "@pe/agent-contracts";
import { hostOperationDefinitionSchema } from "@pe/host-contracts/contracts";
import {
  isTsOnlyOperationKey,
  tsOnlyOperationCatalog,
  tsOnlyOperationSchemas,
} from "@pe/host-contracts/operation-types";
import { type ActionJournal } from "./action-journal.ts";
import { BridgeError, resolveSessionTarget, type RevitBridge } from "./bridge.ts";
import {
  readNativeReceipt,
  readOriginalProcess,
  type SdkReceiptReader,
  type NativeProcess,
} from "./native-receipts.ts";

const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });
/** One rule for /call and /actions: a declared human- or agent-only op refuses the other actor. */
export function requireEligibleActor(
  definition: { key: string; actor?: "human" | "agent" | "any" },
  actor: string,
) {
  if (definition.actor !== undefined && definition.actor !== "any" && definition.actor !== actor)
    throw refused(`'${definition.key}' is ${definition.actor}-only; ${actor} calls are refused`);
}
export async function operationDefinition(
  key: string,
  bridge: RevitBridge["Service"],
  selector?: string,
) {
  const local = tsOnlyOperationCatalog.find((row) => row.key === key);
  if (local) return local;
  const target = await resolveGatewaySession(bridge, selector);
  const result = await Effect.runPromise(
    Effect.result(bridge.invoke("host.ops.catalog", {}, target.sessionId, null)),
  );
  if (result._tag === "Failure") throw result.failure;
  const rows = (result.success.value as { operations?: unknown[] })?.operations;
  const raw = rows?.find(
    (row) => row && typeof row === "object" && "key" in row && row.key === key,
  );
  if (!raw) throw refused(`Catalog metadata unavailable for '${key}'`);
  const definition = Schema.decodeUnknownSync(hostOperationDefinitionSchema)(raw);
  if (definition.intent !== "Read" && definition.intent !== "Mutate")
    throw refused(`Unknown operation intent for '${key}'`);
  return {
    ...definition,
    actor: (raw as { actor?: "human" | "agent" | "any" }).actor,
    requestSchemaJson: (raw as { requestSchemaJson?: string }).requestSchemaJson,
  };
}
async function resolveGatewaySession(bridge: RevitBridge["Service"], selector?: string) {
  const sessions = (await Effect.runPromise(bridge.list))
    .filter((s) => s.sessionId)
    .map((s) => ({
      ...s,
      sessionId: s.sessionId!,
      processId: s.processId ?? 0,
      processStartUtcUnixMs: s.processStartUtcUnixMs ?? null,
      sdkSessionId: s.sdkSessionId ?? null,
      lane: s.lane ?? null,
      documents: s.state?.openDocuments.flatMap((doc) => (doc.address ? [doc.address] : [])) ?? [],
    }));
  const target = resolveSessionTarget(sessions, selector);
  if (target._tag !== "found")
    throw refused(target._tag === "error" ? target.message : "No exact session available");
  return target.session;
}
export async function gatewayTarget(
  key: string,
  needs: string,
  bridge: RevitBridge["Service"],
  selector?: string,
  openId?: string,
): Promise<ExecutionTarget> {
  if (isTsOnlyOperationKey(key)) return { kind: "host" };
  const session = await resolveGatewaySession(bridge, selector);
  if (needs === "nothing") return { kind: "session", session: session.sessionId };
  const document = session.state?.openDocuments.find((doc) => doc.openId === openId);
  if (
    !document ||
    (needs === "family-document" && !document.isFamilyDocument) ||
    (needs === "project-document" && document.isFamilyDocument)
  )
    throw refused(
      "A matching exact open document lifetime is required; no active-document fallback",
    );
  return { kind: "document", ref: { session: session.sessionId, openId: document.openId } };
}
export async function admitGatewayAction(
  raw: unknown,
  owner: ActionJournal,
  bridge: RevitBridge["Service"],
  local: (key: string, input: unknown) => Promise<unknown>,
  sdk?: SdkReceiptReader,
  resume = false,
) {
  const admission = actionAdmissionSchema.parse(raw);
  if (admission.kind !== "operation") throw refused("Operation admission kind required");
  if (Object.keys(admission.bases).length)
    throw refused("Independent operations do not consume Work bases");
  const validate = async (process?: NativeProcess) => {
    const destination = admission.destination;
    if (destination.kind === "host") {
      if (!isTsOnlyOperationKey(admission.key))
        throw refused("Native action needs an exact session");
      return;
    }
    if (isTsOnlyOperationKey(admission.key)) throw refused("Host action needs no Revit binding");
    const sessionId =
      destination.kind === "session" ? destination.session : destination.ref.session;
    const session = await resolveGatewaySession(bridge, sessionId);
    if (
      session.sessionId !== sessionId ||
      (process &&
        (session.processId !== process.pid ||
          session.processStartUtcUnixMs !== Date.parse(process.processStartUtc)))
    )
      throw refused("Original process incarnation is no longer available");
    if (
      destination.kind === "document" &&
      !session.state?.openDocuments.some((doc) => doc.openId === destination.ref.openId)
    )
      throw refused("Original document lifetime is no longer open");
    return session;
  };
  return owner.admit(
    admission,
    async () => {
      const session = await validate();
      const definition = await operationDefinition(admission.key, bridge, session?.sessionId);
      requireEligibleActor(definition, admission.actor);
      const actor = "actor" in definition ? definition.actor : undefined;
      if (definition.intent !== "Mutate")
        throw refused("Only catalogued mutations enter external admission");
      let nativeCheck: ValidateFunction | undefined;
      if (isTsOnlyOperationKey(admission.key)) {
        const contract = tsOnlyOperationSchemas[admission.key];
        if (!("request" in contract)) throw refused("Operation has no request contract");
        Schema.decodeUnknownSync(contract.request, {
          onExcessProperty: "error",
        })(admission.input);
      } else {
        if (!("requestSchemaJson" in definition) || !definition.requestSchemaJson)
          throw refused("Native request schema unavailable");
        const ajv = new Ajv({ strict: false, allErrors: true });
        const schema = JSON.parse(definition.requestSchemaJson);
        delete schema.$schema;
        const check = ajv.compile(schema);
        nativeCheck = check;
        if (!check(admission.input))
          throw refused(`Invalid native input: ${ajv.errorsText(check.errors)}`);
      }
      const expected = await gatewayTarget(
        admission.key,
        definition.needs,
        bridge,
        session?.sessionId,
        admission.destination.kind === "document" ? admission.destination.ref.openId : undefined,
      );
      if (JSON.stringify(expected) !== JSON.stringify(admission.destination))
        throw refused("Destination does not match operation needs");
      if (!session) return { kind: "host-leaf", actor };
      const process = await readOriginalProcess(
        session.processId,
        session.processStartUtcUnixMs ?? NaN,
        sdk,
      );
      await validate(process);
      const script =
        admission.key === "scripting.execute" ? await freezeScript(admission.input) : undefined;
      if (script && !nativeCheck?.({ ...admission.input, sourceBundle: script.sourceBundle }))
        throw refused(
          `Native contract does not accept the captured Pod bundle: ${JSON.stringify(nativeCheck?.errors)}`,
        );
      return {
        kind: "native-leaf",
        process,
        // The SDK session outlives its process; recovery reads a re-registration under it as a successor.
        sdkSession: session.sdkSessionId,
        actor,
        script,
      };
    },
    async (execution) => {
      const prepared = execution.prepared as
        | { kind: "host-leaf" }
        | {
            kind: "native-leaf";
            process: NativeProcess;
            script?: Awaited<ReturnType<typeof freezeScript>>;
          };
      const script = prepared.kind === "native-leaf" ? prepared.script : undefined;
      if (
        admission.key === "scripting.execute" &&
        admission.input.sourcePath != null &&
        !script?.sourceBundle
      )
        throw refused(
          "Original script preparation predates source bundles; original attempt cannot be redispatched",
        );
      const input = script
        ? { ...admission.input, sourceBundle: script.sourceBundle }
        : admission.input;
      const result = await execution.step(
        prepared.kind === "native-leaf" ? "native" : "file",
        admission.key,
        input,
        async (requestId) => {
          await validate(
            prepared.kind === "native-leaf"
              ? nativeProcessSchema.parse(prepared.process)
              : undefined,
          );
          if (admission.destination.kind === "host") return local(admission.key, input);
          const target = admission.destination;
          const answer = await Effect.runPromise(
            Effect.result(
              bridge.invoke(
                admission.key,
                input,
                target.kind === "session" ? target.session : target.ref.session,
                target.kind === "document" ? target.ref.openId : null,
                requestId,
              ),
            ),
          );
          if (answer._tag === "Failure") throw answer.failure;
          const value = answer.success.value;
          // The generated DTO exposes status as string. Only proven terminal successes proceed.
          // Refusal/recovery evidence is not a successful effect and never permits automatic resume.
          if (isTemporary(admission.key) && !temporarySucceeded(value))
            throw new BridgeError(`Temporary lifecycle requires reconciliation`, 409, {
              result: value,
            });
          return value;
        },
      );
      return result;
    },
    resume,
  );
}
const isTemporary = (key: string) =>
  key === "family.temporary.acquire" || key === "document.temporary.release";
function temporarySucceeded(value: unknown): boolean {
  const status = value && typeof value === "object" && "status" in value ? value.status : undefined;
  return status === "acquired" || status === "borrowed" || status === "released";
}
/** The bridge session now serving the original's SDK session, whatever process it runs in. */
async function successorOf(bridge: RevitBridge["Service"] | undefined, sdkSession: unknown) {
  if (!bridge || typeof sdkSession !== "string") return undefined;
  const view = (await Effect.runPromise(bridge.list)).find(
    (s) => s.connected && s.sdkSessionId === sdkSession && s.processId !== undefined,
  );
  return view
    ? {
        sdkSessionId: sdkSession,
        pid: view.processId!,
        processStartUtcUnixMs: view.processStartUtcUnixMs ?? null,
      }
    : undefined;
}
export const recoverGatewayAction = (
  id: string,
  owner: ActionJournal,
  sdk?: SdkReceiptReader,
  bridge?: RevitBridge["Service"],
) =>
  owner.recover(id, async (step, prepared) => {
    const value = prepared as { kind?: string; process?: unknown; sdkSession?: unknown };
    if (value.kind !== "native-leaf") throw Error("This action has no native receipt recovery");
    const read = await readNativeReceipt(
      step,
      nativeProcessSchema.parse(value.process),
      sdk,
      await successorOf(bridge, value.sdkSession),
    );
    return isTemporary(step.key) &&
      read.step.state === "succeeded" &&
      !temporarySucceeded(read.step.result)
      ? { step, evidence: read.evidence }
      : read;
  });
