import { resolve, basename, dirname, join } from "node:path";
import { hostState } from "./host-ownership.ts";
import { createHash } from "node:crypto";
import { readSettingTiers } from "./tiered-settings.ts";
import { targetHomes } from "./call-route.ts";
import { captureDirectory } from "./packages.ts";
import { directorySnapshot } from "./command-reads.ts";
import {
  writeZip,
  installArchive,
  promotedArchive,
  readZip,
  readArchive,
  retireScratchPage,
  preparePodExport,
  writePodExport,
  archiveExportKind,
} from "./pod-transfer.ts";
import { z } from "zod";
import { CommandRejected, StepFailure, io, nativeStep, refused, type CommandContext, type CommandExecutor } from "./command-executor.ts";
import { scratchPageDirectory } from "./page-libraries.ts";
import { resolveSdkSession, SdkSession } from "./sdk-session.ts";
import { freezeScript, requireScriptSuccess, runPodScript, scriptMemberFacts } from "./operation-script.ts";
import { validateNativeInput } from "./native-input.ts";
import { projectNativeOutput } from "./native-output.ts";
import { isViewImage } from "@pe/agent-contracts/native-output-read";
import { Effect, Schema } from "effect";
import {
  actionStepSchema,
  type Consumed,
  type Command,
  nativeProcessSchema,
  type Footprint,
  canonicalRouteInput,
} from "@pe/agent-contracts";
import { commands } from "@pe/mcps/product-actions";
import { admitScript, consentedRead } from "./control.ts";
import { guards } from "./guards.ts";
import {
  isTsOnlyOperationKey,
  tsOnlyOperationSchemas,
  type HostSessionScope,
} from "@pe/host-contracts/operation-types";
import { checkFailure, type ActionExecution, type AttemptHost } from "./action-journal.ts";
import type { RevitBridge } from "./bridge.ts";
import { gatewayTarget, operationDefinition, requireEligibleCaller } from "./gateway-catalog.ts";
import {
  readNativeReceipt,
  readOriginalProcess,
  type SdkReceiptReader,
  type NativeProcess,
} from "./native-receipts.ts";

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
    settingPath: z.string().optional(),
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

/** The gateway observes availability before invoking a public native action. */
export const gatewayNativeLeaves = (key: string): readonly string[] =>
  isTsOnlyOperationKey(key) ? [] : ["host.ops.catalog", ...(key === "scripting.execute" ? ["revit.detail.elements"] : []), key];

/** A host-leaf operation, run on the journal-owned attempt fiber with the journal's services. */
export type GatewayLocalContext = { receiptId: string; settingPath?: string; caller: import("@pe/agent-contracts").Caller };
export type GatewayLocal = (key: string, input: unknown, scope?: HostSessionScope, context?: GatewayLocalContext) => Effect.Effect<unknown, unknown, AttemptHost>;

/** Generated native metadata is the fallback contract; public semantic implementations are hidden. */
export function gatewayExecutor(
  key: string,
  bridge: RevitBridge["Service"],
  local: GatewayLocal,
  pictures: import("./captures-route.ts").PictureCaptures,
  sdk?: SdkReceiptReader,
): CommandExecutor {
  const observe = async ({ admission }: CommandContext) => {
    if (
      Object.values(commands).some(
        (command) => "native" in command && command.native?.includes(key as never),
      )
    )
      throw refused("This native implementation is owned by its public command");
    if (admission.target.kind === "sdk-session")
      throw refused("Native operations require an exact attachment");
    const session =
      admission.target.kind === "host" || isTsOnlyOperationKey(key)
        ? undefined
        : await resolveSdkSession(
            bridge,
            {
              bridgeSessionId:
                admission.target.kind === "document"
                  ? admission.target.ref.session
                  : admission.target.session,
            },
            sdk,
          );
    return { session, metadata: await operationDefinition(key, bridge, session) };
  };
  const validateInput = (
    input: unknown,
    metadata: Awaited<ReturnType<typeof operationDefinition>>,
  ) => {
    if (isTsOnlyOperationKey(key)) {
      const contract = tsOnlyOperationSchemas[key];
      if (!("request" in contract)) throw refused("Operation has no request contract");
      Schema.decodeUnknownSync(contract.request, { onExcessProperty: "error" })(input);
    } else {
      if (!("requestSchemaJson" in metadata) || !metadata.requestSchemaJson)
        throw refused("Native request schema unavailable");
      validateNativeInput(key, input, metadata.requestSchemaJson);
    }
  };
  return {
    definition: async (ctx): Promise<Command> => {
      const { metadata } = await observe(ctx);
      return {
        native: gatewayNativeLeaves(key),
        says: metadata.description ?? key,
        needs:
          key === "settings.tiers.write" && ctx.admission.target.kind === "document" ? "document" :
          !isTsOnlyOperationKey(key) && metadata.needs === "nothing" ? "session" : metadata.needs,
        principal: metadata.principal,
        effect: "command",
        dirties: [],
        input: z.record(z.string(), z.unknown()),
      };
    },
    prepared: preparedGatewaySchema,
    bind: async (ctx) => {
      const { admission, caller } = ctx;
      const target = admission.target.kind === "document" ? admission.target.ref : undefined;
      const readTarget = consentedRead(caller, key, admission.input, target) ? target : undefined;
      const { session, metadata } = await observe(ctx);
      const consumes: Consumed[] = [];
      const effects: Footprint = [];
      let payload: z.infer<typeof preparedGatewaySchema> = { kind: "host-leaf" };
      let process: NativeProcess | undefined;
      let script: Awaited<ReturnType<typeof freezeScript>>;
      requireEligibleCaller(metadata, caller, "/actions");
      if ((metadata.effect === "Read" || metadata.effect === "TransactRead") && key !== "scripting.execute")
        throw refused("Only catalogued commands enter action admission");
      const expected = key === "settings.tiers.write" && target
        ? { kind: "document" as const, ref: target }
        : gatewayTarget(key, metadata.needs, session, target?.openId);
      if (canonicalRouteInput(expected) !== canonicalRouteInput(admission.target))
        throw refused("Target does not match operation needs");
      validateInput(admission.input, metadata);
      if (session) {
        process = await readOriginalProcess(
          session.processId,
          session.processStartUtcUnixMs ?? NaN,
          sdk,
        );
        consumes.push({
          kind: "incarnation",
          probe: { target: admission.target, process },
          expected: true,
        });
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
            consumes.push(...scriptMemberFacts(pod.id, script.sourceBundle.files, admission.input.sourcePath));
          }
          if (!target) throw refused("Scripts require an exact document target");
          // The run is fenced natively to its target, so its footprint is that document alone.
          effects.push(...admitScript(caller, target, "/actions", !!readTarget));
        } else
          effects.push(
            target
              ? { kind: "document", ref: target }
              : { kind: "session", session: session.sessionId },
          );
      } else {
        const authored = admission.input;
        switch (key) {
          case "settings.tiers.write": {
            // Host-owned settings use the document pointer, without dispatching a native operation.
            const { pointer } = await Effect.runPromise(targetHomes(bridge, { openDocumentId: target?.openId }));
            const tier = readSettingTiers(String(authored.owner), pointer).find(tier => tier.tier === authored.tier);
            if (!tier?.path) throw refused(tier?.notFound ?? "The setting home was not found");
            payload = { kind: "host-leaf", settingPath: tier.path };
            effects.push({ kind: "file", path: tier.path });
            break;
          }
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
                probe: { pod: String(authored.pod), path: String(authored.path) },
                expected: String(authored.expectedSha256),
              });
            break;
          case "pod.export": {
            const captured = await preparePodExport({
              pod: String(authored.pod),
              archivePath: String(authored.archivePath),
            }, { captures: pictures });
            consumes.push({ kind: "catalog", probe: {}, expected: captured.versions });
            payload = {
              kind: "host-leaf",
              export: { bytesBase64: captured.bytesBase64, result: captured.result },
            };
            effects.push({ kind: "file", path: resolve(String(authored.archivePath)) });
            break;
          }
          case "pod.import": {
            const { bytes, entries, id, archivePath: path } = await readArchive(String(authored.archivePath));
            consumes.push({
              kind: "file",
              probe: { path },
              expected: createHash("sha256").update(bytes).digest("hex"),
            });
            effects.push(
              ...[...entries.keys()].map((path) => ({
                kind: "member" as const,
                pod: id,
                path,
              })),
            );
            payload = {
              kind: "host-leaf",
              archive: {
                // Commit installs the admitted bytes; a changed or missing source is refused as stale.
                bytesBase64: bytes.toString("base64"),
                locator: path,
                ...(typeof authored.folder === "string" ? { folder: authored.folder } : {}),
              },
            };
            break;
          }
          case "pod.promote": {
            const source = (await scratchPageDirectory(String(authored.page)))?.dir;
            if (!source) throw refused("Not a scratch Page slug");
            const captured = await captureDirectory(source);
            if (captured.diagnostics.some((issue) => issue.severity === "error"))
              throw refused("Page source cannot be captured safely");
            consumes.push({
              kind: "directory",
              probe: { path: source },
              expected: directorySnapshot(captured),
            });
            const files = promotedArchive(
              {
                page: String(authored.page),
                id: String(authored.id),
                name: authored.name === undefined ? undefined : String(authored.name),
              },
              captured.members,
            );
            // The promote also removes these scratch files once the Pod holds them.
            effects.push(
              ...captured.members.map((member) => ({
                kind: "file" as const,
                path: join(source, member.path),
              })),
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
          // Thread metadata and composition results are host-owned, with no external write.
          case "pointers.point":
          case "pointers.dismiss":
          case "pod.member.compose":
          case "aps.auth.login":
          case "aps.auth.logout":
            break;
          case "rhvac.launch":
          case "rhvac.sync":
            effects.push({ kind: "file", path: resolve(String(authored.path)) });
            break;
          default:
            throw refused(`'${key}' has no declared external effect adapter`);
        }
      }
      return {
        consumes,
        effects,
        prepare: async () => {
          if (!process) return payload;
          if (script)
            validateInput({ ...admission.input, sourceBundle: script.sourceBundle }, metadata);
          return {
            kind: "native-leaf",
            process,
            sdkSession: session?.sdkSessionId,
            ...(script ? { script } : {}),
          };
        },
      };
    },
    run: ({ admission, caller }: CommandContext, execution: ActionExecution) => Effect.suspend(() => {
      const prepared = execution.prepared as z.infer<typeof preparedGatewaySchema>;
      const capturedScript = prepared.kind === "native-leaf" ? prepared.script : undefined;
      if (
        key === "scripting.execute" &&
        admission.input.sourcePath != null &&
        !capturedScript?.sourceBundle
      )
        throw refused("Original script has no sealed source bundle");
      const capturedInput = capturedScript
        ? { ...admission.input, sourceBundle: capturedScript.sourceBundle }
        : admission.input;
      const input = key === "scripting.execute"
        ? { ...capturedInput, caller: guards(caller) ? "Agent" : "Person" }
        : capturedInput;
      return execution.step(
        prepared.kind === "native-leaf" ? "native" : "file",
        key,
        input,
        (requestId): Effect.Effect<unknown, unknown, AttemptHost> => {
          if (prepared.kind === "host-leaf") {
            const { archive, export: exported } = prepared;
            if (archive)
              return io(async () => {
                const bytes = Buffer.from(archive.bytesBase64, "base64");
                const installed = await installArchive(bytes, archive.locator, archive.folder, {
                  captures: pictures,
                });
                if (!prepared.promotedPage) return installed;
                // A promote moves: the locator is the scratch folder the archive was captured from.
                await retireScratchPage(archive.locator, prepared.promotedPage, readZip(bytes));
                return { ...installed, key: `page:@${installed.id}/pages/${prepared.promotedPage}` };
              });
            if (exported)
              return io(() => {
                const captured = exported as Awaited<ReturnType<typeof preparePodExport>>;
                return writePodExport(captured, archiveExportKind.in(
                  hostState().home({ root: dirname(captured.result.archivePath), tier: "user" }), basename(captured.result.archivePath),
                ));
              });
            return local(key, input, admission.target.kind === "document"
              ? { bridgeSessionId: admission.target.ref.session, openDocumentId: admission.target.ref.openId }
              : undefined, { receiptId: admission.id, settingPath: prepared.settingPath, caller });
          }
          const target = admission.target;
          if (target.kind !== "document" && target.kind !== "session")
            return Effect.fail(refused("Native target required"));
          const step = key === "scripting.execute" ? runPodScript(bridge,
            target.kind === "document" ? target.ref : { session: target.session }, input, requestId,
          ) : nativeStep(
            bridge,
            target.kind === "document" ? target.ref : { session: target.session },
            key,
            input,
            requestId,
          );
          // A capture command (the focused view image) keeps its picture as the read door does, so
          // its result names the capture and never a path on the host's disk.
          return isViewImage(key)
            ? step.pipe(
                Effect.flatMap((value) =>
                  projectNativeOutput(pictures, key, value, input,
                    { openDocumentId: target.kind === "document" ? target.ref.openId : null }, caller),
                ),
                Effect.mapError((error) =>
                  error instanceof StepFailure ? error : new StepFailure(error.message, error.status, "failed"),
                ),
              )
            : step;
        },
        {
          process: prepared.kind === "native-leaf" ? prepared.process : undefined,
          check: stepCheck(key),
        },
      ).pipe(Effect.mapError((error) => {
        if (key !== "settings.tiers.write" || !(error instanceof StepFailure) ||
            (error.status !== 409 && error.status !== 422))
          return error;
        // Classify after the step records its undispatched refusal, keeping its status and words.
        const refusal = new CommandRejected(
          error.status === 409 ? { kind: "stale", consumed: [] } : { kind: "invalid" },
          error.status,
        );
        refusal.message = error.message;
        return refusal;
      }));
    }),
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
      if (read.step.state !== "succeeded") return read;
      // The live step's own check decides a read-back success too: an op that answered ok with a
      // failed script is a failed step, exactly as it would have been had its reply arrived.
      try {
        stepCheck(step.key)(read.step.result);
        return read;
      } catch (error) {
        const { result, state: _state, ...intent } = read.step;
        return { ...read, step: actionStepSchema.parse({ ...intent, ...checkFailure(error, result) }) };
      }
    },
  };
}

/** Whether a native step's answer is a success; the live step and its recovery read share it. */
const stepCheck = (key: string) => (value: unknown) => {
  if (key === "scripting.execute") requireScriptSuccess(value);
  if (isTemporary(key) && !temporarySucceeded(value))
    throw refused("Temporary lifecycle requires reconciliation");
};
const isTemporary = (key: string) =>
  key === "family.temporary.acquire" || key === "document.temporary.release";
function temporarySucceeded(value: unknown): boolean {
  const status = value && typeof value === "object" && "status" in value ? value.status : undefined;
  return status === "acquired" || status === "borrowed" || status === "released";
}
/** The bridge session now serving the original's SDK session, whatever process it runs in. */
async function successorOf(bridge: RevitBridge["Service"] | undefined, sdkSession: unknown) {
  if (!bridge || typeof sdkSession !== "string") return undefined;
  // effect-edge: island, phase 5
  const view = await Effect.runPromise(
    SdkSession.resolve(bridge, { sdkSession }).pipe(Effect.orElseSucceed(() => undefined)),
  );
  return view?.processId !== undefined
    ? {
        sdkSessionId: sdkSession,
        pid: view.processId!,
        processStartUtcUnixMs: view.processStartUtcUnixMs ?? null,
      }
    : undefined;
}
