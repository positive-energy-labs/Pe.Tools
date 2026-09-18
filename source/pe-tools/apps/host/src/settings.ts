import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { join, win32 } from "node:path";
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
import { LocalOpError } from "./local-error.ts";
import { productPodsRootPath } from "./product-paths.ts";
import {
  localOpFileError,
  makeDirectory,
  readDirectoryEntriesOrEmpty,
  writeFileStringAtomic,
} from "./files/index.ts";

/**
 * Pod members are host-native file I/O under `Documents/Pe.Tools/Pods/<folder>/`; a pod is found by
 * its manifest `id`, never its folder name. Structural (JSON schema) validation runs here, offline.
 * Composition and semantic validation belong to the Revit session and arrive through the bridge.
 */
export type PodContext = {
  readonly podsRoot?: string;
  readonly invokeBridge?: (key: string, payload: unknown) => Effect.Effect<unknown, unknown>;
};

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
// ponytail: one host-wide write lane; per-member locks only if unrelated writes contend.
const writeLock = Semaphore.makeUnsafe(1);
const schemaCache = new Map<string, ValidateFunction | string>();

export const listPods = Effect.fnUntraced(function* (ctx: PodContext = {}) {
  const root = ctx.podsRoot ?? productPodsRootPath();
  const found = yield* readManifests(root);
  const pods: PodList["pods"][number][] = [];
  for (const pod of found.pods) {
    const twins = found.pods.filter((other) => other.id === pod.id);
    const members = yield* listMembers(join(root, pod.folder), "");
    pods.push({
      ...pod,
      members,
      diagnostics:
        twins.length > 1
          ? [
              issue(
                "DuplicatePodId",
                `Pod id '${pod.id}' is claimed by folders ${twins.map((t) => t.folder).join(", ")}.`,
              ),
            ]
          : [],
    });
  }
  return { pods, unreadable: found.unreadable } satisfies PodList;
});

/**
 * Runs of one pod, newest first. `pod.list` returns members; a run is not a member, so the reader
 * that lists runs says so by name (w4-revit defect 11).
 */
export const listRuns = Effect.fnUntraced(function* (
  request: PodRunsRequest,
  ctx: PodContext = {},
) {
  const folder = yield* podFolder(request.pod, ctx);
  const entries = yield* readDirectoryEntriesOrEmpty(join(folder, "output"), "pod.runs");
  const runs: PodRuns["runs"][number][] = [];
  for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
    if (entry.info.type !== "Directory") continue;
    const receiptPath = `output/${entry.name}/receipt.json`;
    const read = yield* readText(join(folder, receiptPath), "pod.runs");
    const receipt = read === null ? null : parseReceipt(read.content);
    const input = yield* readText(join(folder, "output", entry.name, "input.json"), "pod.runs");
    const source = input === null ? undefined : parseRunSource(input.content);
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
      ? runs.filter((run) => (run.source?.path ?? run.receipt?.memberPath) === request.path)
      : runs,
  } satisfies PodRuns;
});

const text = (value: unknown) => (typeof value === "string" ? value : "");

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
  } catch {
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
    return {
      podId: text(value.podId),
      memberPath: typeof value.memberPath === "string" ? value.memberPath : null,
      // Only saved bytes carry a member hash; a draft or operation run claims none.
      memberSha256:
        origin !== "SuppliedDraft" &&
        origin !== "Operation" &&
        typeof value.memberSha256 === "string"
          ? value.memberSha256
          : null,
      origin,
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

export const readMember = Effect.fnUntraced(function* (member: PodMember, ctx: PodContext = {}) {
  const path = yield* memberFile(member, ctx, "pod.member.read");
  const read = yield* readText(path, "pod.member.read");
  if (!read)
    return yield* Effect.fail(
      new LocalOpError(
        "pod.member.read",
        `No member '${member.path}' in pod '${member.pod}'.`,
        404,
      ),
    );
  // Text members round-trip exactly; a replacement character would silently change the bytes.
  if (!read.utf8)
    return yield* Effect.fail(
      new LocalOpError("pod.member.read", "The member is not valid UTF-8 text.", 400),
    );
  return { content: read.content, sha256: read.sha256, bytesBase64: read.bytesBase64 };
});

/**
 * A run folder in the pod (dogma law 10). Runs are not members — `writeMember` refuses `output/` —
 * so the writer that files a run says so by name. Overwrites, so a resumed action files one run.
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
      const folder = join(yield* podFolder(pod, ctx), "output", runId);
      yield* makeDirectory(folder, key);
      for (const [name, content] of Object.entries(files))
        yield* writeFileStringAtomic(join(folder, name), content, key);
      return `output/${runId}`;
    }),
  );

/** Create a new member; refuses an existing path. */
export const writeMember = (request: PodMemberWriteRequest, ctx: PodContext = {}) =>
  writeLock.withPermit(
    Effect.gen(function* () {
      const key = "pod.member.write";
      const path = yield* writablePath(request, ctx, key);
      const fs = yield* FileSystem.FileSystem;
      yield* makeDirectory(win32.dirname(path), key);
      const created = yield* Effect.result(
        fs.writeFileString(path, request.content, { flag: "wx" }),
      );
      if (created._tag === "Failure")
        return yield* Effect.fail(
          created.failure.reason._tag === "AlreadyExists"
            ? new LocalOpError(key, `Member '${request.path}' already exists.`, 409)
            : localOpFileError(key, created.failure),
        );
      return written(request);
    }),
  );

/** Overwrite a member only when its current bytes are the ones the editor read. */
export const saveMember = (request: PodMemberSaveRequest, ctx: PodContext = {}) =>
  writeLock.withPermit(
    Effect.gen(function* () {
      const key = "pod.member.save";
      const path = yield* writablePath(request, ctx, key);
      // Optimistic against external writers: read/check + rename is not an atomic CAS.
      const current = yield* readText(path, key);
      if (current?.sha256 !== request.expectedSha256)
        return yield* Effect.fail(
          new LocalOpError(key, `Member '${request.path}' changed since it was read.`, 409),
        );
      yield* writeFileStringAtomic(path, request.content, key);
      return written(request);
    }),
  );

const writablePath = Effect.fnUntraced(function* (
  request: PodMember & { content: string },
  ctx: PodContext,
  key: string,
) {
  const path = yield* memberFile(request, ctx, key);
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
  return path;
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
  const saved = request.content == null ? yield* readMember(request, ctx) : null;
  const content = saved?.content ?? request.content!;
  const bytesBase64 = saved?.bytesBase64 ?? Buffer.from(content, "utf8").toString("base64");
  let source =
    capturedSource ??
    ({
      id: request.pod,
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
  const library = schemaUrl && isSettingsSchemaUrl(schemaUrl) ? schemaUrl : null;
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
      source = result.source;
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
  member: PodMember & { sha256: string },
  ctx: PodContext,
) {
  const saved = yield* readMember(member, ctx);
  if (saved.sha256 !== member.sha256)
    return yield* Effect.fail(
      new LocalOpError("pod.member.compose", "The member changed after it was reviewed.", 409),
    );
  const result = yield* composeMember({ ...member, content: saved.content }, ctx, {
    id: member.pod,
    path: member.path,
    sha256: saved.sha256,
    bytesBase64: saved.bytesBase64,
    origin: "SavedMember",
  });
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
  const root = ctx.podsRoot ?? productPodsRootPath();
  const matches = (yield* readManifests(root)).pods.filter((pod) => pod.id === podId);
  if (matches.length === 1) return join(root, matches[0]!.folder);
  return yield* Effect.fail(
    new LocalOpError(
      "pod.resolve",
      matches.length
        ? `Pod id '${podId}' is claimed by folders ${matches.map((m) => m.folder).join(", ")}.`
        : `No installed pod has id '${podId}'.`,
      matches.length ? 409 : 404,
    ),
  );
});

const memberFile = Effect.fnUntraced(function* (
  member: PodMember,
  ctx: PodContext,
  operationKey: string,
) {
  const folder = yield* podFolder(member.pod, ctx);
  return yield* Effect.try({
    try: () => safeJoin(folder, normalizeMemberPath(member.path)),
    catch: (error) => new LocalOpError(operationKey, errorMessage(error), 400),
  });
});

const readManifests = Effect.fnUntraced(function* (root: string) {
  const pods: Omit<PodList["pods"][number], "members" | "diagnostics">[] = [];
  const unreadable: { folder: string; message: string }[] = [];
  for (const entry of yield* readDirectoryEntriesOrEmpty(root, "pod.list")) {
    if (entry.info.type !== "Directory") continue;
    const manifest = yield* readText(join(root, entry.name, "pod.json"), "pod.list");
    if (!manifest) continue;
    try {
      const value = JSON.parse(manifest.content.replace(/^\uFEFF/, "")) as Record<string, unknown>;
      if (typeof value.id !== "string" || !value.id) throw Error("pod.json has no id");
      pods.push({
        id: value.id,
        name: typeof value.name === "string" ? value.name : value.id,
        version: typeof value.version === "string" ? value.version : "",
        folder: entry.name,
        entrypoints: Array.isArray(value.entrypoints)
          ? value.entrypoints.flatMap((e) =>
              isRecord(e) && typeof e.id === "string" && typeof e.sourcePath === "string"
                ? [
                    {
                      id: e.id,
                      sourcePath: e.sourcePath,
                      name: typeof e.name === "string" ? e.name : null,
                      description: typeof e.description === "string" ? e.description : null,
                    },
                  ]
                : [],
            )
          : [],
      });
    } catch (error) {
      unreadable.push({ folder: entry.name, message: errorMessage(error) });
    }
  }
  return { pods, unreadable };
});

const listMembers: (
  folder: string,
  relative: string,
) => Effect.Effect<
  PodList["pods"][number]["members"][number][],
  LocalOpError,
  FileSystem.FileSystem
> = Effect.fnUntraced(function* (folder: string, relative: string) {
  const members: PodList["pods"][number]["members"][number][] = [];
  const entries = yield* readDirectoryEntriesOrEmpty(join(folder, relative), "pod.list");
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    // Members only. `output/` is runs (dogma law 1) and answers to `pod.runs`; `pod.json` is the manifest.
    if (path === "pod.json" || path === "output") continue;
    if (entry.info.type === "Directory") members.push(...(yield* listMembers(folder, path)));
    else if (entry.info.type === "File") {
      const read = yield* readText(join(folder, path), "pod.list");
      if (read) members.push({ path, sha256: read.sha256, schema: declaredSchema(path, read) });
    }
  }
  return members;
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

function declaredSchema(path: string, read: { content: string }): string | null {
  if (!path.toLowerCase().endsWith(".json")) return null;
  try {
    const value: unknown = JSON.parse(read.content.replace(/^\uFEFF/, ""));
    return isRecord(value) && typeof value.$schema === "string" ? value.$schema : null;
  } catch {
    return null;
  }
}

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

/**
 * A `$schema` URL a C# settings library serves: `/schemas/settings/<library>/<root>.json`. The URL is the
 * member's only identity claim and the bridge resolves it as-is.
 */
export function isSettingsSchemaUrl(schemaUrl: string): boolean {
  try {
    return /\/schemas\/settings\/[^/]+\/[^/]+\.json$/.test(new URL(schemaUrl).pathname);
  } catch {
    return false;
  }
}

function hasDirectives(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasDirectives);
  if (!isRecord(value)) return false;
  return "$include" in value || "$preset" in value || Object.values(value).some(hasDirectives);
}

function normalizeMemberPath(input: string): string {
  if (win32.isAbsolute(input)) throw new Error("Member paths are pod-relative.");
  const segments = input.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!segments.length || segments.some((s) => s === "." || s === ".."))
    throw new Error(`Invalid member path '${input}'.`);
  return segments.join("/");
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
