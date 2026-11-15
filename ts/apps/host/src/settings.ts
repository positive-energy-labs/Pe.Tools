import { settingsSchemaPath } from "@pe/host-contracts/settings-schema";
import { lstat, stat } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { basename, dirname, join, win32 } from "node:path";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { Effect, FileSystem, Semaphore } from "effect";
import type {
  MemberIssue,
  PodList,
  PodMember,
  PodMemberComposeRequest,
  PodMemberComposeResponse,
  PodMemberSaveRequest,
  PodMemberWriteRequest,
  PodMemberWritten,
  PodReceipt,
  PodRuns,
  PodRunSource,
  PodRunsRequest,
} from "@pe/host-contracts/operation-types";
import type {
  PodMemberCompose,
  SettingsSchema,
  SettingsValidate,
} from "@pe/host-contracts/generated";
import type { PodDraftSource, PodMemberSource } from "@pe/agent-contracts";
import {
  capturePackage,
  isPackageMember,
  listPackages,
  podHome,
  productPodsRoots,
  projectPodsRoot,
  readPackage,
  resolvePackageIdentity,
  type AdmittedPackage,
} from "./packages.ts";
import { requirePackageEnabled, activePackages, projectPodIds, reconcilePackageChanges } from "./package-lifecycle.ts";
import { shippedPodsSettled } from "./installed-pods.ts";
import { LocalOpError } from "./local-error.ts";
import { PackageDiscoveryExceeded } from "./pod-capture.ts";
import { contentRootsReady, contentHomes, ContentHomeUnavailable } from "./content-roots.ts";
import { hostState } from "./host-ownership.ts";
import { sha256Hex,
  writeHome,
  writeState,
  homeKind,
  type StoredFile,
  type StateRoot,
} from "@pe/host-contracts/kinds";
import { stateDirectory, stateScope, stateTree } from "@pe/host-contracts/service-identity";
export const podMemberKind = homeKind({
  schema: z.unknown(),
  place: (_parts: readonly string[]) => "Pod member",
  segments: (parts: readonly string[]) => parts,
});
import { runFileKind } from "./run-files.ts";
import { z } from "zod";
import {
  localOpFileError,
  makeDirectory,
  readDirectoryEntriesOrEmpty } from "./files/index.ts";

/**
 * Pod members are host-native file I/O under `Pods/<folder>/` in the home that holds the pod; a pod
 * is found by its manifest `id`, never its folder name or its home. Structural (JSON schema)
 * validation runs here, offline. Composition and semantic validation belong to the Revit session
 * and arrive through the bridge.
 */
export type PodContext = {
  readonly machine?: StateRoot;
  readonly podsRoot?: string;
  /**
   * `data.path` of the target document's project-home blob (ADR 0037): undefined when the call
   * targets no document, null when the document names no project home.
   */
  readonly pointer?: string | null;
  readonly invokeBridge?: (key: string, payload: unknown) => Effect.Effect<unknown, unknown>;
};

/**
 * The one write door into a home (ADR 0037 rules 5 and 7), with this machine's safety net: a
 * compare-and-swap on the bytes the writer read (`null`: the file must not exist). The write lands
 * where the file is, in whichever home holds it; before an overwrite the prior bytes rest under
 * `state\Blobs` and the receipt names their hash.
 */

/** Only for undoing a newly created Pod member after failed publication; never delete a later edit.
 * Like writeHome, this has the store's compare-then-I/O concurrency ceiling. */
export function deleteHomeIfSha(file: StoredFile<unknown, "home">, expectSha256: string): boolean {
  const path = file.path;
  let bytes: Buffer;
  try { bytes = readFileSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  if (sha256Hex(bytes) !== expectSha256) return false;
  unlinkSync(path);
  return true;
}

export type HomeMemberUndo = {
  file: StoredFile<unknown, "home">; sha256: string; prior: Uint8Array | null;
};

/** Undo only this publication's writes, newest first; one conflict must not prevent other undos. */
export function rollbackHomeMembers(writes: readonly HomeMemberUndo[]): string[] {
  const kept: string[] = [];
  for (const write of [...writes].reverse()) {
    try {
      const undone = write.prior === null
        ? deleteHomeIfSha(write.file, write.sha256)
        : writeHome(write.file, write.prior, write.sha256).ok;
      if (!undone) kept.push(`${write.file.path} (changed after publication)`);
    } catch (error) {
      kept.push(`${write.file.path} (${String(error)})`);
    }
  }
  return kept;
}

/**
 * One pod's run output, `state\Runs\<pod-id>` (homes freeze shape 7); a run no pod owns goes to
 * `_no-pod`. A custom Pods root changes authored input, never the machine that owns run output.
 * This agrees with C# ProductRuntimeStateLayout.RunPath, independent of the Pods location.
 */
export const runsDirectory = (
  pod: string | null | undefined,
  ctx: Pick<PodContext, "machine" | "podsRoot"> = {},
) => {
  const machine = ctx.machine ?? hostState();
  return pod ? stateDirectory(stateScope(machine, machine.runs), pod) : stateScope(machine, machine.podlessRuns);
};

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
// ponytail: one host-wide write lane; per-member locks only if unrelated writes contend.
const writeLock = Semaphore.makeUnsafe(1);
const schemaCache = new Map<string, ValidateFunction | string>();

/**
 * The host answers healthy before the shipped-pod import ends (shipped examples are optional
 * content, not a prerequisite for the host door), so a listing of the product's own Pods waits
 * for that import: the first `pod.list` on a fresh home names every shipped pod. An owner that
 * supplies its own Pods root has no import to wait for.
 */
/** Provenance on a read (ADR 0037): the home a pod's folder sits in, when it sits in one. */
const withHome = (directory: string, ctx: PodContext) => {
  const home = podHome(directory, ctx.pointer);
  return home ? { home } : {};
};

/** The Pods a call reads: the owner's own folder, else every home's, the target document's project home among them. */
const podsRoots = (ctx: PodContext) => ctx.podsRoot ?? productPodsRoots(ctx.pointer);
/** A listing with no project home says why, so "no project Pods" is never read as "none exist". */
const projectPodsNote = (ctx: PodContext) =>
  ctx.podsRoot !== undefined
    ? {}
    : projectPodsRoot(ctx.pointer)
    ? {
        // Only the user and firm homes are censused at start, so a project Pod's entrypoints and
        // contributions are served by no door. Say so, or Pea calls one and meets a bare not-found.
        projectPods:
          "Project-home Pods list, read, write and compose here. They serve no Pages, skills or entrypoints and do not run, because only the user and firm homes are censused at start.",
      }
    : {
        projectPods:
          ctx.pointer === undefined
            ? "No document is targeted, so only the user and firm homes are listed. A project home's Pods appear when the call targets a document."
            : ctx.pointer === null
              ? "The targeted document names no project home, so only the user and firm homes are listed."
              : `The targeted document names the project home '${ctx.pointer}', which was not found on this computer, so only the user and firm homes are listed.`,
      };

const podContentReady = (ctx: PodContext) =>
  ctx.podsRoot === undefined ? Effect.tryPromise({
    try: async () => {
      await shippedPodsSettled(); await contentRootsReady(ctx.pointer);
      if (!contentHomes().some(home => home.tier === "user")) throw new ContentHomeUnavailable();
    },
    catch: error => new LocalOpError("pod.content", errorMessage(error), 503),
  }) : Effect.void;

export const listPods = Effect.fnUntraced(function* (ctx: PodContext = {}) {
  yield* podContentReady(ctx);
  const root = podsRoots(ctx);
  const found = yield* Effect.tryPromise({
    try: () => listPackages({ podsRoots: root }),
    catch: (error) => new LocalOpError("pod.list", errorMessage(error), 400),
  });
  const project = yield* Effect.promise(() => projectPodIds(ctx.pointer));
  return {
    pods: (yield* Effect.promise(() => activePackages(found.packages, root, project))).map((pod) => ({
      id: pod.id,
      name: pod.name,
      version: pod.version,
      folder: pod.folder,
      ...withHome(pod.directory, ctx),
      entrypoints: pod.entrypoints,
      contributions: pod.contributions,
      members: pod.members.map(({ path, sha256, schema }) => ({ path, sha256, schema })),
      diagnostics: pod.diagnostics,
    })),
    ...projectPodsNote(ctx),
    unreadable: found.unreadable,
  } satisfies PodList;
});

export const resolvePodIdentity = Effect.fnUntraced(function* (
  folder: string,
  ctx: PodContext = {},
) {
  yield* podContentReady(ctx);
  const root = podsRoots(ctx);
  return yield* Effect.tryPromise({
    try: async () => {
      const identity = await resolvePackageIdentity(folder, root);
      await requirePackageEnabled(identity.id, root, await projectPodIds(ctx.pointer));
      return { projection: "identity" as const, identity };
    },
    catch: (error) => new LocalOpError("pod.list", errorMessage(error), 400),
  });
});

/**
 * Runs of one pod, newest first. `pod.list` returns members; a run is not a member, so the reader
 * that lists runs says so by name (w4-revit defect 11).
 */
export const listRuns = Effect.fnUntraced(function* (
  request: PodRunsRequest,
  ctx: PodContext = {},
) {
  // The pod must exist and be enabled; its runs sit under machine state, keyed by its id.
  yield* podFolder(request.pod, ctx);
  const folder = runsDirectory(request.pod, ctx).path;
  const entries = yield* readDirectoryEntriesOrEmpty(folder, "pod.runs");
  const runs: PodRuns["runs"][number][] = [];
  /** The member each run wrote, from its `written-member.json` output (a capture's product). */
  const wrote = new Map<string, string>();
  for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
    if (entry.info.type !== "Directory") continue;
    const receiptPath = join(folder, entry.name, "receipt.json");
    const read = yield* readText(receiptPath, "pod.runs");
    const receipt = read === null ? null : parseReceipt(read.content);
    const input = yield* readText(join(folder, entry.name, "input.json"), "pod.runs");
    const source = input === null ? undefined : parseRunSource(input.content);
    if (typeof receipt !== "string" && receipt?.outputs.includes("written-member.json")) {
      const written = yield* readText(join(folder, entry.name, "written-member.json"), "pod.runs");
      const path = written === null ? undefined : writtenMemberPath(written.content);
      if (path) wrote.set(entry.name, path);
    }
    runs.push({
      runId: entry.name,
      receiptPath,
      receipt: typeof receipt === "string" ? null : receipt,
      ...(source ? { source } : {}),
      error:
        read === null
          ? source
            ? "The run holds its input but no receipt.json; its outcome is unresolved."
            : "The run folder holds no receipt.json."
          : typeof receipt === "string"
            ? receipt
            : null,
    });
  }
  return {
    runs: request.path
      ? // A member's runs are the ones that consumed it or wrote it.
        runs.filter(
          (run) =>
            (run.source?.path ?? run.receipt?.memberPath) === request.path ||
            wrote.get(run.runId) === request.path,
        )
      : runs,
  } satisfies PodRuns;
});

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The member path a run's `written-member.json` names; undefined when it is unreadable. */
function writtenMemberPath(content: string): string | undefined {
  try {
    const value: unknown = JSON.parse(content.replace(/^﻿/, ""));
    return isRecord(value) && typeof value.path === "string" ? value.path : undefined;
  } catch (error) { console.warn("ts/apps/host/src/settings.ts: fallback after failure", error);
    return undefined;
  }
}

/** What `input.json` says the run consumed; undefined when it is unreadable. */
function parseRunSource(content: string): PodRunSource | undefined {
  try {
    const value: unknown = JSON.parse(content.replace(/^﻿/, ""));
    if (!isRecord(value) || !isRecord(value.source) || typeof value.source.kind !== "string")
      return undefined;
    const field = (name: string) => {
      const item = (value.source as Record<string, unknown>)[name];
      return typeof item === "string" ? { [name]: item } : {};
    };
    return {
      kind: value.source.kind,
      ...field("origin"),
      ...field("pod"),
      ...field("path"),
      ...field("sha256"),
      ...field("name"),
    };
  } catch (error) { console.warn("ts/apps/host/src/settings.ts: fallback after failure", error);
    return undefined;
  }
}

const outcomes: readonly PodReceipt["outcome"][] = ["Succeeded", "Failed", "Cancelled"];
const origins: readonly NonNullable<PodReceipt["origin"]>[] = [
  "SavedMember",
  "SuppliedDraft",
  "Operation",
];

/** The receipt, or the reason it could not be read. A crashed apply leaves that state on disk. */
function parseReceipt(content: string): PodReceipt | string {
  try {
    const value: unknown = JSON.parse(content.replace(/^﻿/, ""));
    if (
      !isRecord(value) ||
      typeof value.operation !== "string" ||
      typeof value.outcome !== "string"
    )
      return "receipt.json is not a run receipt.";
    if (!outcomes.includes(value.outcome as PodReceipt["outcome"]))
      return `receipt.json outcome '${value.outcome}' is not ${outcomes.join(", ")}.`;
    const origin = origins.includes(value.origin as never)
      ? (value.origin as PodReceipt["origin"])
      : null;
    // An operation run consumed no member, so it names none: one that does is a writer defect,
    // refused rather than normalized so it surfaces. Only saved bytes carry a member hash.
    if (origin === "Operation" && (value.memberPath != null || value.memberSha256 != null))
      return "receipt.json is an Operation run that names a member; an operation consumed no member, so its memberPath and memberSha256 must be null.";
    const member =
      origin === "Operation"
        ? { origin, memberPath: null, memberSha256: null }
        : {
            origin,
            memberPath: typeof value.memberPath === "string" ? value.memberPath : null,
            memberSha256:
              origin !== "SuppliedDraft" && typeof value.memberSha256 === "string"
                ? value.memberSha256
                : null,
          };
    return {
      podId: typeof value.podId === "string" ? value.podId : null,
      ...member,
      operation: value.operation,
      planHash: typeof value.planHash === "string" ? value.planHash : null,
      outcome: value.outcome as PodReceipt["outcome"],
      outputs: Array.isArray(value.outputs) ? value.outputs.map(text) : [],
      reason: typeof value.reason === "string" ? value.reason : null,
    };
  } catch (error) {
    return errorMessage(error);
  }
}

/**
 * The Pod half of a member read: policy, then one discovery of every Pod in the home. A caller that
 * reads several members of one Pod as one reading passes the result to each `readMember`.
 *
 * `indexed` reads only this Pod's folder, found by the last discovery, as capture does: the bytes are
 * as fresh, and an id claimed twice since that discovery waits for the next one. The index is a
 * shortcut and never the answer: any miss (no discovery yet, a folder that moved or changed its id,
 * a member that no longer admits) asks discovery, which answers as it always did.
 */
export const readMemberPod = Effect.fnUntraced(function* (
  pod: string,
  ctx: PodContext = {},
  indexed = false,
) {
  // A fresh home activates shipped pods only when the background import lands; reading before
  // it would answer "inactive" for a pod that is about to be active (bounded, installed-pods.ts).
  yield* podContentReady(ctx);
  yield* Effect.tryPromise({
    try: async () => requirePackageEnabled(pod, ctx.podsRoot, await projectPodIds(ctx.pointer)),
    catch: (error) => new LocalOpError("pod.member.read", errorMessage(error), 403),
  });
  return yield* Effect.tryPromise({
    try: (): Promise<AdmittedPackage> =>
      indexed
        ? // ponytail: no freshness floor on this fallback. The edits a gate exists to catch cause
          // these misses, and discovery already refuses to reuse or join a read whose disk signature
          // differs from one taken after the ask arrives (`choose` in `discoverPackages`,
          // pod-capture.ts). Both paths share podsDiskSignature's recent-member byte witness;
          // only older files deliberately rewritten with identical metadata escape it.
          capturePackage(pod, ctx.podsRoot).catch(() => readPackage(pod, { podsRoots: podsRoots(ctx) }))
        : readPackage(pod, { podsRoots: podsRoots(ctx) }),
    catch: (error) =>
      new LocalOpError(
        "pod.member.read",
        errorMessage(error),
        // A discovery that ran out of its wait read nothing: it is not a Pod that is gone.
        error instanceof PackageDiscoveryExceeded || error instanceof ContentHomeUnavailable
          ? 503
          : errorMessage(error).includes("claimed")
            ? 409
            : 404,
      ),
  });
});

export const readMember = Effect.fnUntraced(function* (
  member: PodMember,
  ctx: PodContext = {},
  pod?: AdmittedPackage,
) {
  const admitted = pod ?? (yield* readMemberPod(member.pod, ctx));
  const captured = admitted.members.find((item) => item.path === member.path);
  if (!captured)
    return yield* Effect.fail(
      new LocalOpError(
        "pod.member.read",
        `No admitted member '${member.path}' in pod '${member.pod}'.`,
        404,
      ),
    );
  if (!isUtf8(captured.bytes))
    return yield* Effect.fail(
      new LocalOpError("pod.member.read", "The member is not valid UTF-8 text.", 400),
    );
  const written = yield* Effect.promise(() =>
    stat(join(admitted.directory, member.path)).then(
      (facts) => facts.mtime.toISOString(),
      () => undefined,
    ),
  );
  return {
    content: new TextDecoder("utf-8", { ignoreBOM: true }).decode(captured.bytes),
    sha256: captured.sha256,
    bytesBase64: Buffer.from(captured.bytes).toString("base64"),
    ...withHome(admitted.directory, ctx),
    ...(written ? { modifiedAt: written } : {}),
  };
});

/**
 * One run's folder, `state\Runs\<pod-id>\<run-id>` (dogma law 10); returns its full path. Runs are
 * not members and never sit in a home, so the writer that files a run says so by name. Overwrites,
 * so a resumed action files one run.
 */
export const writeRun = (
  pod: string,
  runId: string,
  files: Readonly<Record<string, string>>,
  ctx: PodContext = {},
) =>
  writeLock.withPermit(
    Effect.gen(function* () {
      const key = "pod.run.write";
      yield* podFolder(pod, ctx);
      const folder = join(runsDirectory(pod, ctx).path, runId);
      yield* makeDirectory(folder, key);
      for (const [name, content] of Object.entries(files))
        // Run output is kept machine evidence, so replacement preserves the prior bytes.
        yield* Effect.try({
          try: () =>
            writeState(
              runFileKind.in(runsDirectory(pod, ctx), runId, name.split(/[\\\\/]/)),
              content,
            ),
          catch: (error) => localOpFileError(key, error),
        });
      return folder;
    }),
  );

/** Create a new member; refuses an existing path. */
export const writeMember = (request: PodMemberWriteRequest, ctx: PodContext = {}) =>
  writeLock.withPermit(
    Effect.gen(function* () {
      const key = "pod.member.write";
      const path = yield* writablePath(request, ctx, key);
      const content = storedSchemaPaths(request.content);
      const wrote = yield* throughDoor(key, path, content, null);
      if (!wrote.ok)
        return yield* Effect.fail(
          new LocalOpError(key, `Member '${request.path}' already exists.`, 409),
        );
      return written({ ...request, content });
    }),
  );

/**
 * Overwrite a member only when its current bytes are the ones the editor read. The bytes it
 * replaces rest under `state\Blobs\sha256\<expectedSha256>`: the caller already holds that hash.
 */
export const saveMember = (request: PodMemberSaveRequest, ctx: PodContext = {}) =>
  writeLock.withPermit(
    Effect.gen(function* () {
      const key = "pod.member.save";
      const path = yield* writablePath(request, ctx, key);
      const content = storedSchemaPaths(request.content);
      const wrote = yield* throughDoor(key, path, content, request.expectedSha256);
      if (!wrote.ok)
        return yield* Effect.fail(
          new LocalOpError(key, `Member '${request.path}' changed since it was read.`, 409),
        );
      return written({ ...request, content });
    }),
  );

/** A member write lands in the pod's own home, in place, through the one door. */
const throughDoor = (
  key: string,
  path: StoredFile<unknown, "home">,
  content: string,
  expectSha256: string | null,
) =>
  Effect.tryPromise({
    try: async () => {
      const wrote = writeHome(path, content, expectSha256);
      if (wrote.ok) await reconcilePackageChanges();
      return wrote;
    },
    catch: (error) => new LocalOpError(key, errorMessage(error), 500),
  });

const writablePath = Effect.fnUntraced(function* (
  request: PodMember & { content: string },
  ctx: PodContext,
  key: string,
) {
  yield* memberFile(request, ctx, key);
  if (/^(output\/|pod\.json$)/i.test(normalizeMemberPath(request.path)))
    return yield* Effect.fail(
      new LocalOpError(key, "Runs and the manifest are not writable members.", 400),
    );
  if (new TextDecoder().decode(new TextEncoder().encode(request.content)) !== request.content)
    return yield* Effect.fail(
      new LocalOpError(
        key,
        "Content must round-trip as UTF-8; unpaired surrogates cannot be written.",
        400,
      ),
    );
  const directory = yield* podFolder(request.pod, ctx);
  const home = podHome(directory, ctx.pointer);
  return podMemberKind.in(
    stateTree(dirname((ctx.machine ?? hostState()).state)).home({
      root: dirname(dirname(directory)),
      tier: home?.tier ?? "user",
    }),
    [
      basename(dirname(directory)),
      basename(directory),
      ...normalizeMemberPath(request.path).split("/"),
    ],
  );
});

const written = (request: PodMember & { content: string }): PodMemberWritten => ({
  pod: request.pod,
  path: normalizeMemberPath(request.path),
  sha256: sha256(request.content),
});

export const composeMember = Effect.fnUntraced(function* (
  request: PodMemberComposeRequest,
  ctx: PodContext = {},
  capturedSource?: PodMemberComposeResponse["source"],
) {
  const saved =
    request.content == null
      ? request.pod
        ? yield* readMember({ pod: request.pod, path: request.path }, ctx)
        : yield* Effect.fail(
            new LocalOpError("pod.member.compose", "A saved member requires its pod id.", 400),
          )
      : null;
  const content = saved?.content ?? request.content!;
  const bytesBase64 = saved?.bytesBase64 ?? Buffer.from(content, "utf8").toString("base64");
  let source =
    capturedSource ??
    ({
      id: request.pod ?? null,
      path: request.path,
      sha256: saved?.sha256 ?? sha256(content),
      bytesBase64,
      origin: saved ? "SavedMember" : "SuppliedDraft",
    } satisfies PodMemberComposeResponse["source"]);
  const base = {
    sha256: source.sha256,
    schemaUrl: null,
    schemaJson: request.schemaJson ?? null,
    composed: null,
    source,
    dependencies: [],
  };
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch (error) {
    return {
      ...base,
      diagnostics: [issue("JsonParseError", errorMessage(error), "error")],
      schemaValidation: "not-run",
      semanticValidation: "not-run",
    } satisfies PodMemberComposeResponse;
  }
  const schemaUrl = isRecord(value) && typeof value.$schema === "string" ? value.$schema : null;
  const library = schemaUrl && settingsSchemaPath(schemaUrl);
  const diagnostics: MemberIssue[] = [];
  let composed: unknown = value;
  let dependencies: PodMemberComposeResponse["dependencies"] = [];
  if (hasDirectives(value)) {
    if (!ctx.invokeBridge) {
      diagnostics.push(
        issue(
          "CompositionNeedsRevit",
          "Composition needs a Revit session; $include and $preset stay unresolved until one is attached.",
          "info",
        ),
      );
      composed = undefined;
    } else {
      const result = (yield* ctx.invokeBridge("pod.member.compose", {
        pod: request.pod,
        path: request.path,
        content,
        source,
      })) as PodMemberCompose.Res.Response;
      diagnostics.push(
        ...result.diagnostics.map((d) =>
          bridgeIssue({ code: d.stage, message: d.message, path: d.source, severity: d.severity }),
        ),
      );
      dependencies = [...result.dependencies];
      if (result.source.origin === "Operation")
        return yield* Effect.fail(
          new LocalOpError(
            "pod.member.compose",
            "A composition requires a saved member or supplied draft.",
          ),
        );
      source = { ...result.source, id: result.source.id ?? null, origin: result.source.origin };
      composed = result.composed == null ? undefined : JSON.parse(result.composed);
    }
  }
  const schemaJson =
    request.schemaJson ??
    (library && ctx.invokeBridge
      ? (
          (yield* ctx.invokeBridge("settings.schema", {
            schemaUrl: library,
          })) as SettingsSchema.Res.Response
        ).schemaJson
      : undefined);
  const schemaValidation: PodMemberComposeResponse["schemaValidation"] = !schemaUrl
    ? "no-schema"
    : composed === undefined
      ? "not-run"
      : !schemaJson
        ? "unavailable"
        : validateStructure(schemaJson, composed, diagnostics);
  let semanticValidation: PodMemberComposeResponse["semanticValidation"] = "not-run";
  if (schemaValidation === "passed" && library && ctx.invokeBridge) {
    const semantic = (yield* ctx.invokeBridge("settings.validate", {
      schemaUrl: library,
      rawContent: content,
      composedContent: `${JSON.stringify(composed, null, 2)}\n`,
    })) as SettingsValidate.Res.Response;
    diagnostics.push(
      ...semantic.issues.map((i) => bridgeIssue({ ...i, path: i.instancePath || "$" })),
    );
    semanticValidation = !semantic.isConfigured
      ? "unavailable"
      : semantic.issues.some((i) => i.severity.toLowerCase() === "error")
        ? "failed"
        : "passed";
  } else if (schemaValidation === "passed") semanticValidation = "unavailable";
  return {
    ...base,
    source,
    schemaUrl,
    schemaJson: schemaJson ?? null,
    composed: composed === undefined ? null : `${JSON.stringify(composed, null, 2)}\n`,
    dependencies,
    diagnostics,
    schemaValidation,
    semanticValidation,
  } satisfies PodMemberComposeResponse;
});

/** The composed spec an engine consumes; refuses anything that did not compose cleanly. */
export const composedSpec = Effect.fnUntraced(function* (
  member: PodMemberSource | PodDraftSource,
  ctx: PodContext,
) {
  let result: PodMemberComposeResponse;
  if ("content" in member) {
    // A supplied draft may carry real pod context for @local; otherwise its run is operation-owned.
    if (member.pod) yield* podFolder(member.pod, ctx);
    result = yield* composeMember(member, ctx);
  } else {
    const saved = yield* readMember(member, ctx);
    if (saved.sha256 !== member.sha256)
      return yield* Effect.fail(
        new LocalOpError("pod.member.compose", "The member changed after it was reviewed.", 409),
      );
    result = yield* composeMember({ ...member, content: saved.content }, ctx, {
      id: member.pod,
      path: member.path,
      sha256: saved.sha256,
      bytesBase64: saved.bytesBase64,
      origin: "SavedMember",
    });
  }
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length || result.composed == null)
    return yield* Effect.fail(
      new LocalOpError(
        "pod.member.compose",
        errors.map((d) => `${d.path}: ${d.message}`).join("\n") || "The member did not compose.",
        409,
      ),
    );
  return {
    spec: result.composed,
    schemaUrl: result.schemaUrl,
    source: result.source,
    dependencies: result.dependencies,
  };
});

export const podFolder = Effect.fnUntraced(function* (podId: string, ctx: PodContext = {}) {
  // A fresh home activates shipped pods only when the background import lands; reading before
  // it would answer "inactive" for a pod that is about to be active (bounded, installed-pods.ts).
  yield* podContentReady(ctx);
  const root = podsRoots(ctx);
  yield* Effect.tryPromise({
    try: async () => requirePackageEnabled(podId, root, await projectPodIds(ctx.pointer)),
    catch: (error) => new LocalOpError("pod.resolve", errorMessage(error), 403),
  });
  const pod = yield* Effect.tryPromise({
    try: () => readPackage(podId, { podsRoots: root }),
    catch: (error) =>
      new LocalOpError(
        "pod.resolve",
        errorMessage(error),
        errorMessage(error).includes("claimed") ? 409 : 404,
      ),
  });
  return pod.directory;
});

const memberFile = Effect.fnUntraced(function* (
  member: PodMember,
  ctx: PodContext,
  operationKey: string,
) {
  const folder = yield* podFolder(member.pod, ctx);
  return yield* Effect.tryPromise({
    try: async () => {
      const normalized = normalizeMemberPath(member.path);
      let path = folder;
      for (const segment of normalized.split("/")) {
        path = join(path, segment);
        try {
          if ((await lstat(path)).isSymbolicLink()) throw Error("Pod members cannot follow links.");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      return safeJoin(folder, normalized);
    },
    catch: (error) => new LocalOpError(operationKey, errorMessage(error), 400),
  });
});

/** Reads bytes once; a member that is not UTF-8 still lists, it just declares no schema. */
const readText = Effect.fnUntraced(function* (path: string, operationKey: string) {
  const fs = yield* FileSystem.FileSystem;
  const result = yield* Effect.result(fs.readFile(path));
  if (result._tag === "Failure") {
    const error = localOpFileError(operationKey, result.failure);
    if (error.statusCode === 404) return null;
    return yield* Effect.fail(error);
  }
  const content = new TextDecoder("utf-8", { ignoreBOM: true }).decode(result.success);
  return {
    content,
    utf8: isUtf8(result.success),
    sha256: createHash("sha256").update(result.success).digest("hex"),
    bytesBase64: Buffer.from(result.success).toString("base64"),
  };
});

function validateStructure(schemaJson: string, value: unknown, into: MemberIssue[]) {
  let validate = schemaCache.get(schemaJson);
  if (validate === undefined) {
    try {
      const schema = JSON.parse(schemaJson) as Record<string, unknown>;
      delete schema.$schema;
      validate = ajv.compile(schema);
    } catch (error) {
      validate = errorMessage(error);
    }
    schemaCache.set(schemaJson, validate);
  }
  if (typeof validate === "string") {
    into.push(issue("SchemaCompileError", validate, "warning"));
    return "unavailable" as const;
  }
  if (validate(value)) return "passed" as const;
  into.push(...(validate.errors ?? []).map(ajvIssue));
  return "failed" as const;
}

function ajvIssue(error: ErrorObject): MemberIssue {
  return {
    path: error.instancePath ? error.instancePath.replace(/^\//, "").replace(/\//g, ".") : "$",
    code: error.keyword,
    severity: "error",
    message: error.message ?? "Invalid value",
    suggestion: null,
  };
}

function bridgeIssue(raw: {
  code?: string;
  message: string;
  path?: string | null;
  severity?: string;
}): MemberIssue {
  const severity = raw.severity?.toLowerCase();
  return {
    code: raw.code ?? "Semantic",
    message: raw.message,
    path: raw.path ?? "$",
    severity: severity === "warning" || severity === "info" ? severity : "error",
  };
}

function issue(code: string, message: string, severity: MemberIssue["severity"] = "error") {
  return { code, message, path: "$", severity } satisfies MemberIssue;
}

/** Member text with every library `$schema` stored as its path. Other bytes, and other schemas, are untouched. */
export const storedSchemaPaths = (content: string): string =>
  content.replace(/("\$schema"\s*:\s*)("(?:[^"\\]|\\.)*")/g, (whole, key: string, literal: string) => {
    try {
      const path = settingsSchemaPath(JSON.parse(literal) as string);
      return path ? `${key}${JSON.stringify(path)}` : whole;
    } catch {
      return whole;
    }
  });

function hasDirectives(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasDirectives);
  if (!isRecord(value)) return false;
  return "$include" in value || "$preset" in value || Object.values(value).some(hasDirectives);
}

function normalizeMemberPath(input: string): string {
  if (!isPackageMember(input)) throw Error(`'${input}' is not an authored package member.`);
  return input;
}

function safeJoin(rootPath: string, relativePath: string): string {
  const root = win32.resolve(rootPath);
  const combined = win32.resolve(root, relativePath.replace(/\//g, "\\"));
  if (!combined.toLowerCase().startsWith(`${root.toLowerCase()}\\`))
    throw new Error("Member path escapes its pod.");
  return combined;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
