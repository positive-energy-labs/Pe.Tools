import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { capturePackage, captureDirectory, listPackages } from "./packages.ts";
import {
  readZip,
  writeZip,
  installArchive,
  preparePodExport,
  writePodExport,
} from "./pod-transfer.ts";
import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import type { CommandContext, CommandFactory } from "./command-executor.ts";
import { productPagesRootPath } from "./product-paths.ts";
import { resolveSdkSession, type SdkSession } from "./sdk-session.ts";
import { freezeScript, requireScriptSuccess } from "./operation-script.ts";
import { Ajv, type ValidateFunction } from "ajv";
import { Effect, Schema } from "effect";
import {
  commands,
  type Consumed,
  type Command,
  nativeProcessSchema,
  type Caller,
  type ExecutionTarget,
  type Footprint,
  canonicalRouteInput,
} from "@pe/agent-contracts";
import { admitScript, consentedRead, Refused, requireHuman } from "./control.ts";
import { hostOperationDefinitionSchema } from "@pe/host-contracts/contracts";
import {
  isTsOnlyOperationKey,
  tsOnlyOperationCatalog,
  tsOnlyOperationSchemas,
} from "@pe/host-contracts/operation-types";
import type { ActionExecution } from "./action-journal.ts";
import { BridgeError, type RevitBridge } from "./bridge.ts";
import {
  readNativeReceipt,
  readOriginalProcess,
  type SdkReceiptReader,
  type NativeProcess,
} from "./native-receipts.ts";

const refused = (message: string) => new BridgeError(message, 409, { notDispatched: true });
type CatalogEntry = { fingerprint: string; rows: Promise<unknown[]> };
const catalogs = new WeakMap<object, Map<string, CatalogEntry>>();

/** Registry bindings precede bridge registration. Retain metadata, never a native response/receipt. */
async function operationRows(bridge: RevitBridge["Service"], target: SdkSession) {
  const read = async () => {
    const result = await Effect.runPromise(
      Effect.result(bridge.invoke("host.ops.catalog", {}, target.sessionId, null)),
    );
    if (result._tag === "Failure") throw result.failure;
    const rows = (result.success.value as { operations?: unknown[] })?.operations;
    if (!Array.isArray(rows)) throw refused("Operation catalog unavailable");
    return rows;
  };
  // An adapter without lifecycle observations cannot safely retain authorization metadata.
  if (typeof bridge.subscribe !== "function") return read();
  let held = catalogs.get(bridge);
  if (!held) {
    held = new Map();
    catalogs.set(bridge, held);
    const entries = held;
    bridge.subscribe((event) => {
      if (event.kind === "connected" || event.kind === "disconnected")
        entries.delete(event.sessionId);
    });
  }
  const fingerprint = JSON.stringify([
    target.processId,
    target.processStartUtcUnixMs,
    target.buildStamp,
    target.state?.runtimeAssemblies,
  ]);
  const previous = held.get(target.sessionId);
  if (previous?.fingerprint === fingerprint) return previous.rows;
  const entries = held;
  const entry: CatalogEntry = { fingerprint, rows: Promise.resolve([]) };
  entries.set(target.sessionId, entry);
  entry.rows = read().then(
    (rows) => {
      if (entries.get(target.sessionId) !== entry)
        throw refused("Bridge attachment changed while reading operation catalog");
      return rows;
    },
    (error) => {
      if (entries.get(target.sessionId) === entry) entries.delete(target.sessionId);
      throw error;
    },
  );
  return entry.rows;
}
/** One rule for /call and /actions: a declared human-only op refuses every other caller. */
export function requireEligibleCaller(
  definition: { key: string; actor?: "human" | "agent" | "any" },
  caller: Caller,
  door: string,
) {
  if (
    caller.kind !== "human" &&
    caller.kind !== "pea" &&
    definition.actor &&
    definition.actor !== "any"
  )
    throw new Refused({
      code: "human.only",
      door,
      reason: `'${definition.key}' is ${definition.actor}-only; ${caller.kind} calls are refused.`,
    });
}
export async function operationDefinition(
  key: string,
  bridge: RevitBridge["Service"],
  target?: SdkSession,
) {
  const local = tsOnlyOperationCatalog.find((row) => row.key === key);
  if (local) return local;
  if (!target) throw refused("An SDK-resolved attachment is required");
  const rows = await operationRows(bridge, target);
  const raw = rows?.find(
    (row) => row && typeof row === "object" && "key" in row && row.key === key,
  );
  if (!raw) throw refused(`Catalog metadata unavailable for '${key}'`);
  let definition;
  try {
    definition = Schema.decodeUnknownSync(hostOperationDefinitionSchema)(raw);
    if (definition.intent !== "Read" && definition.intent !== "Mutate")
      throw refused(`Unknown operation intent for '${key}'`);
  } catch (error) {
    catalogs.get(bridge)?.delete(target.sessionId);
    throw error;
  }
  return {
    ...definition,
    actor: (raw as { actor?: "human" | "agent" | "any" }).actor,
    requestSchemaJson: (raw as { requestSchemaJson?: string }).requestSchemaJson,
  };
}
export function gatewayTarget(
  key: string,
  needs: string,
  session?: SdkSession,
  openDocumentId?: string,
): Exclude<ExecutionTarget, { kind: "sdk-session" }> {
  if (isTsOnlyOperationKey(key)) return { kind: "host" };
  if (!session) throw refused("An SDK-resolved attachment is required");
  if (needs === "nothing" || needs === "session")
    return { kind: "session", session: session.sessionId };
  const document = session.state?.openDocuments.find((doc) => doc.openId === openDocumentId);
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
const capturedArchiveSchema = z.strictObject({
  bytesBase64: z.string(),
  locator: z.string(),
  folder: z.string().optional(),
});
const preparedGatewaySchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("host-leaf"),
    archive: capturedArchiveSchema.optional(),
    export: z
      .object({
        bytesBase64: z.string(),
        result: z.object({ archivePath: z.string() }).passthrough(),
      })
      .optional(),
    promotedPage: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("native-leaf"),
    process: nativeProcessSchema,
    sdkSession: z.string().nullish(),
    script: z
      .strictObject({
        sourceBundle: z.strictObject({
          files: z.array(z.strictObject({ path: z.string(), bytesBase64: z.string() })),
        }),
      })
      .optional(),
  }),
]);

/** Generated native metadata is the fallback contract; public semantic implementations are hidden. */
export function gatewayExecutor(
  key: string,
  bridge: RevitBridge["Service"],
  local: (key: string, input: unknown) => Promise<unknown>,
  sdk?: SdkReceiptReader,
): CommandFactory {
  return async (ctx: CommandContext) => {
    const { admission, caller } = ctx;
    if (
      Object.values(commands).some(
        (command) => "native" in command && command.native?.includes(key as never),
      )
    )
      throw refused("This native implementation is owned by its public command");
    if (admission.target.kind === "sdk-session")
      throw refused("Native operations require an exact attachment");
    const target = admission.target.kind === "document" ? admission.target.ref : undefined;
    const readTarget = consentedRead(caller, key, admission.input, target) ? target : undefined;
    let session: SdkSession | undefined;
    let metadata: Awaited<ReturnType<typeof operationDefinition>>;
    let nativeCheck: ValidateFunction | undefined;
    const nativeInput = z.record(z.string(), z.unknown()).superRefine((input, ctx) => {
      try {
        if (isTsOnlyOperationKey(key)) {
          const contract = tsOnlyOperationSchemas[key];
          if (!("request" in contract)) throw Error("Operation has no request contract");
          Schema.decodeUnknownSync(contract.request, { onExcessProperty: "error" })(input);
        } else {
          if (!("requestSchemaJson" in metadata) || !metadata.requestSchemaJson)
            throw Error("Native request schema unavailable");
          if (!nativeCheck) {
            const schema = JSON.parse(metadata.requestSchemaJson);
            delete schema.$schema;
            nativeCheck = new Ajv({ strict: false, allErrors: true }).compile(schema);
          }
          if (!nativeCheck(input)) throw Error(JSON.stringify(nativeCheck.errors));
        }
      } catch (error) {
        ctx.addIssue({ code: "custom", message: String(error) });
      }
    });
    const catalogued =
      tsOnlyOperationCatalog.find((row) => row.key === key) ??
      hostOpCatalog.find((row) => row.key === key);
    const definition: Command = {
      says: catalogued?.description ?? key,
      needs:
        (catalogued?.needs as Command["needs"]) ??
        (admission.target.kind === "host"
          ? "nothing"
          : admission.target.kind === "session"
            ? "session"
            : "document"),
      effect: "command",
      dirties: [],
      input: z.record(z.string(), z.unknown()),
    };
    const consumes: Consumed[] = [];
    const effects: Footprint = [];
    let payload: z.infer<typeof preparedGatewaySchema> = { kind: "host-leaf" };
    let process: NativeProcess | undefined;
    let script: Awaited<ReturnType<typeof freezeScript>>;
    return {
      definition,
      prepared: preparedGatewaySchema,
      bind: async () => {
        session =
          admission.target.kind === "host"
            ? undefined
            : await resolveSdkSession(
                bridge,
                {
                  bridgeSessionId:
                    admission.target.kind === "document"
                      ? admission.target.ref.session
                      : admission.target.kind === "session"
                        ? admission.target.session
                        : undefined,
                },
                sdk,
              );
        metadata = await operationDefinition(key, bridge, session);
        requireEligibleCaller(metadata, caller, "/actions");
        if (metadata.intent !== "Mutate" && key !== "scripting.execute")
          throw refused("Only catalogued commands enter action admission");
        const expected = gatewayTarget(key, metadata.needs, session, target?.openId);
        if (canonicalRouteInput(expected) !== canonicalRouteInput(admission.target))
          throw refused("Target does not match operation needs");
        nativeInput.parse(admission.input);
        if (session) {
          process = await readOriginalProcess(
            session.processId,
            session.processStartUtcUnixMs ?? NaN,
            sdk,
          );
          consumes.push({ kind: "incarnation", target: admission.target, process });
          if (key === "scripting.execute") {
            script = await freezeScript(admission.input);
            if (script && admission.input.sourceBundle == null) {
              const manifest = script.sourceBundle.files.find((file) => file.path === "pod.json");
              const pod = manifest
                ? (JSON.parse(
                    Buffer.from(manifest.bytesBase64, "base64")
                      .toString("utf8")
                      .replace(/^\uFEFF/, ""),
                  ) as { id?: string })
                : null;
              if (!pod?.id) throw refused("The captured script has no exact Pod identity");
              consumes.push(
                ...script.sourceBundle.files.map((file) => ({
                  kind: "member" as const,
                  pod: pod.id!,
                  path: file.path,
                  sha256: createHash("sha256")
                    .update(Buffer.from(file.bytesBase64, "base64"))
                    .digest("hex"),
                  bytesBase64: file.bytesBase64,
                })),
              );
            }
            const scriptSession = session;
            const documents = scriptSession.state?.openDocuments;
            if (!documents) throw refused("Scripts require a complete sibling document census");
            consumes.push({
              kind: "census",
              session: session.sessionId,
              openIds: documents.map((doc) => doc.openId).sort(),
            });
            effects.push(
              ...documents
                .filter(
                  (doc) =>
                    !(
                      caller.kind === "page" &&
                      readTarget?.session === scriptSession.sessionId &&
                      readTarget.openId === doc.openId
                    ),
                )
                .map((doc) => ({
                  kind: "document" as const,
                  ref: { session: scriptSession.sessionId, openId: doc.openId },
                })),
            );
            admitScript(
              caller,
              documents.map((doc) => ({ session: scriptSession.sessionId, openId: doc.openId })),
              "/actions",
              readTarget,
            );
          } else
            effects.push(
              target
                ? { kind: "document", ref: target }
                : { kind: "session", session: session.sessionId },
            );
        } else {
          const authored = admission.input;
          switch (key) {
            case "pod.member.write":
            case "pod.member.save":
              effects.push({
                kind: "member",
                pod: String(authored.pod),
                path: String(authored.path),
              });
              if (key === "pod.member.save")
                consumes.push({
                  kind: "member",
                  pod: String(authored.pod),
                  path: String(authored.path),
                  sha256: String(authored.expectedSha256),
                });
              break;
            case "pod.export": {
              const captured = await preparePodExport({
                pod: String(authored.pod),
                archivePath: String(authored.archivePath),
              });
              consumes.push({ kind: "catalog", snapshot: captured.versions });
              payload = {
                kind: "host-leaf",
                export: { bytesBase64: captured.bytesBase64, result: captured.result },
              };
              effects.push({ kind: "file", path: resolve(String(authored.archivePath)) });
              break;
            }
            case "pod.import": {
              const path = resolve(String(authored.archivePath));
              const bytes = await readFile(path);
              const entries = readZip(bytes);
              const manifest = JSON.parse(entries.get("pod.json")?.toString("utf8") ?? "null") as {
                id?: string;
              } | null;
              if (!manifest?.id) throw refused("Pod archive has no exact destination identity");
              consumes.push({
                kind: "file",
                path,
                sha256: createHash("sha256").update(bytes).digest("hex"),
                bytesBase64: bytes.toString("base64"),
              });
              effects.push(
                ...[...entries.keys()].map((path) => ({
                  kind: "member" as const,
                  pod: manifest.id!,
                  path,
                })),
              );
              payload = {
                kind: "host-leaf",
                archive: {
                  bytesBase64: bytes.toString("base64"),
                  locator: path,
                  ...(typeof authored.folder === "string" ? { folder: authored.folder } : {}),
                },
              };
              break;
            }
            case "pod.promote": {
              const source = resolve(productPagesRootPath(), String(authored.page));
              const captured = await captureDirectory(source);
              if (captured.diagnostics.some((issue) => issue.severity === "error"))
                throw refused("Page source cannot be captured safely");
              consumes.push({ kind: "directory", path: source, snapshot: captured });
              const files = new Map<string, Buffer>([
                [
                  "pod.json",
                  Buffer.from(
                    `${JSON.stringify({ schemaVersion: 2, id: authored.id, name: authored.name ?? authored.page, version: "0.1.0", entrypoints: [] }, null, 2)}\n`,
                  ),
                ],
              ]);
              for (const member of captured.members)
                files.set(
                  `pages/${String(authored.page)}/${member.path}`,
                  Buffer.from(member.bytes),
                );
              effects.push(
                ...[...files.keys()].map((path) => ({
                  kind: "member" as const,
                  pod: String(authored.id),
                  path,
                })),
              );
              payload = {
                kind: "host-leaf",
                archive: {
                  bytesBase64: writeZip(files).toString("base64"),
                  locator: source,
                  folder: String(authored.id),
                },
                promotedPage: String(authored.page),
              };
              break;
            }
            case "host.shell.open":
              if (caller.kind !== "human" && caller.kind !== "pea")
                throw refused("Opening a host viewer requires a human or Pea caller");
              break;
            case "aps.auth.login":
            case "aps.auth.logout":
              requireHuman(caller, "/actions", "APS account administration");
              break;
            case "rhvac.launch":
            case "rhvac.sync":
              effects.push({ kind: "file", path: resolve(String(authored.path)) });
              break;
            default:
              throw refused(`'${key}' has no declared external effect adapter`);
          }
        }
        return { consumes, effects };
      },
      prepare: async () => {
        if (!process) return payload;
        if (script && !nativeCheck?.({ ...admission.input, sourceBundle: script.sourceBundle }))
          throw refused("Native contract refuses the captured Pod bundle");
        return {
          kind: "native-leaf",
          process,
          sdkSession: session?.sdkSessionId,
          ...(script ? { script } : {}),
        };
      },
      run: async (_ctx: CommandContext, execution: ActionExecution) => {
        const prepared = execution.prepared as z.infer<typeof preparedGatewaySchema>;
        const capturedScript = prepared.kind === "native-leaf" ? prepared.script : undefined;
        if (
          key === "scripting.execute" &&
          admission.input.sourcePath != null &&
          !capturedScript?.sourceBundle
        )
          throw refused("Original script has no sealed source bundle");
        const input = capturedScript
          ? { ...admission.input, sourceBundle: capturedScript.sourceBundle }
          : admission.input;
        return execution.step(
          prepared.kind === "native-leaf" ? "native" : "file",
          key,
          input,
          async (requestId) => {
            if (prepared.kind === "host-leaf") {
              if (prepared.archive) {
                const installed = await installArchive(
                  Buffer.from(prepared.archive.bytesBase64, "base64"),
                  prepared.archive.locator,
                  prepared.archive.folder,
                );
                return prepared.promotedPage
                  ? { ...installed, key: `page:@${installed.id}/pages/${prepared.promotedPage}` }
                  : installed;
              }
              if (prepared.export)
                return writePodExport(
                  prepared.export as Awaited<ReturnType<typeof preparePodExport>>,
                );
              return local(key, input);
            }
            const target = admission.target;
            if (target.kind !== "document" && target.kind !== "session")
              throw refused("Native target required");
            const answer = await Effect.runPromise(
              Effect.result(
                bridge.invoke(
                  key,
                  input,
                  target.kind === "document" ? target.ref.session : target.session,
                  target.kind === "document" ? target.ref.openId : null,
                  requestId,
                ),
              ),
            );
            if (answer._tag === "Failure") throw answer.failure;
            const value = answer.success.value;
            if (key === "scripting.execute") requireScriptSuccess(value);
            if (isTemporary(key) && !temporarySucceeded(value))
              throw new BridgeError("Temporary lifecycle requires reconciliation", 409, {
                result: value,
              });
            return value;
          },
          prepared.kind === "native-leaf" ? prepared.process : undefined,
        );
      },
      recover: async (step: import("@pe/agent-contracts").ActionStep, raw: unknown) => {
        const prepared = raw as z.infer<typeof preparedGatewaySchema>;
        if (prepared.kind !== "native-leaf")
          throw Error("This command has no native receipt recovery");
        const read = await readNativeReceipt(
          step,
          prepared.process,
          sdk,
          await successorOf(bridge, prepared.sdkSession),
        );
        return isTemporary(step.key) &&
          read.step.state === "succeeded" &&
          !temporarySucceeded(read.step.result)
          ? { step, evidence: read.evidence }
          : read;
      },
    };
  };
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
