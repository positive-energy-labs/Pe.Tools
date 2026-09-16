import { createHash } from "node:crypto";
import { basename, join, win32 } from "node:path";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { Effect, FileSystem, Option, Semaphore } from "effect";
import {
  SettingsFileKind,
  type OpenSettingsDocumentRequest,
  type SaveSettingsDocumentRequest,
  type SaveSettingsDocumentResult,
  type SettingsDirectoryNode,
  type SettingsDiscoveryResult,
  type SettingsDocumentDependency,
  type SettingsDocumentId,
  type SettingsDocumentSnapshot,
  type SettingsFileEntry,
  type SettingsFileNode,
  type SettingsTreeRequest,
  type SettingsValidationIssue,
  type ValidateSettingsDocumentRequest,
} from "@pe/host-contracts/operation-types";
import { hostProcessIdentity } from "@pe/host-contracts/contracts";
import { capturePod } from "./operation-script.ts";
import { LocalOpError } from "./local-error.ts";
import { productPodsRootPath } from "./product-paths.ts";
import {
  localOpFileError,
  makeDirectory,
  readDirectoryEntriesOrEmpty,
  statFile,
  writeFileStringAtomic,
} from "./files/index.ts";

type SettingsDirectoryListing = { files: string[]; directories: string[] };
type MutableSettingsDirectoryNode = Omit<SettingsDirectoryNode, "directories" | "files"> & {
  directories: MutableSettingsDirectoryNode[];
  files: SettingsFileNode[];
};

export type SettingsRuntimeContext = {
  /** Storage authority survives file mode, which clears only native schema services. */
  readonly storageRoot?: string;
  readonly bridgeSessionId?: string;
  readonly schemaJson?: string;
  readonly invokeBridge?: (
    operationKey: string,
    payload?: unknown,
    bridgeSessionId?: string,
  ) => Effect.Effect<unknown, unknown>;
};

type SettingsModuleDescriptor = {
  readonly moduleKey: string;
  readonly defaultRootKey: string;
  readonly roots: readonly { readonly rootKey: string; readonly displayName: string }[];
  readonly storageOptions?: {
    readonly includeRoots?: readonly string[];
    readonly presetRoots?: readonly string[];
  };
};

type ParsedJson =
  | {
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly ok: false;
      readonly issue: SettingsValidationIssue;
    };

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
// ponytail: one host-wide save lane; per-file locks only if unrelated saves contend.
const saveLock = Semaphore.makeUnsafe(1);
const schemaCache = new Map<string, { validate?: ValidateFunction; errorMessage?: string }>();

export const discoverSettingsTree = Effect.fnUntraced(function* (
  input: SettingsTreeRequest,
  ctx: SettingsRuntimeContext = {},
) {
  const request = normalizeSettingsTreeRequest(input);
  return yield* discoverSettingsTreeFromDisk(
    request,
    input.mode === "file" ? { storageRoot: ctx.storageRoot } : ctx,
  );
});

export const settingsDocumentAddress = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  storageRoot?: string,
) {
  const { documentPath } = yield* resolveDocumentPath(
    documentId,
    "settings.document.save",
    storageRoot,
  );
  return { path: documentPath, workspaceId: `settings:${sha256(documentPath.toLowerCase())}` };
});

export function openSettingsDocument(
  request: OpenSettingsDocumentRequest,
  ctx: SettingsRuntimeContext = {},
): Effect.Effect<SettingsDocumentSnapshot, LocalOpError | Error, FileSystem.FileSystem> {
  return openSettingsDocumentFromDisk(
    request,
    request.mode === "file" ? { storageRoot: ctx.storageRoot } : ctx,
  );
}

export function openSettingsDocumentWithModule(
  request: OpenSettingsDocumentRequest,
  module: SettingsModuleDescriptor,
  ctx: SettingsRuntimeContext = {},
): Effect.Effect<SettingsDocumentSnapshot, LocalOpError | Error, FileSystem.FileSystem> {
  return openSettingsDocumentFromDisk(request, ctx, module);
}

export function validateSettingsDocument(
  request: ValidateSettingsDocumentRequest,
  ctx: SettingsRuntimeContext = {},
): Effect.Effect<
  SettingsDocumentSnapshot["validation"],
  LocalOpError | Error,
  FileSystem.FileSystem
> {
  if (request.mode === "file") ctx = { storageRoot: ctx.storageRoot };
  return Effect.gen(function* () {
    const module = yield* discoverModule(request.documentId, ctx);
    const materialized = yield* materializeDocument(
      request.documentId,
      request.rawContent,
      module,
      true,
      ctx,
    );
    return materialized.validation;
  });
}

export function saveSettingsDocument(
  request: SaveSettingsDocumentRequest,
  ctx: SettingsRuntimeContext = {},
): Effect.Effect<SaveSettingsDocumentResult, LocalOpError | Error, FileSystem.FileSystem> {
  return saveLock.withPermit(
    saveSettingsDocumentToDisk(
      request,
      request.mode === "file" ? { storageRoot: ctx.storageRoot } : ctx,
    ),
  );
}

function defaultSettingsBasePath(): string {
  return productPodsRootPath();
}

function normalizeSettingsTreeRequest(input: SettingsTreeRequest): Required<SettingsTreeRequest> {
  return {
    mode: input.mode ?? "module",
    moduleKey: input.moduleKey || "default",
    rootKey: input.rootKey || "settings",
    subDirectory: input.subDirectory ?? null,
    recursive: input.recursive === true,
    includeFragments: input.includeFragments !== false,
    includeSchemas: input.includeSchemas !== false,
  };
}

const discoverSettingsTreeFromDisk = Effect.fnUntraced(function* (
  request: Required<SettingsTreeRequest>,
  ctx: SettingsRuntimeContext,
) {
  const module = yield* discoverModule(
    { moduleKey: request.moduleKey, rootKey: request.rootKey, relativePath: "" },
    ctx,
  );
  const root = module.roots.find(
    (candidate) => candidate.rootKey.toLowerCase() === request.rootKey.toLowerCase(),
  );
  if (!root) throw new Error(`Unknown root '${request.rootKey}' for module '${module.moduleKey}'.`);
  const { discoveryRootPath, rootDirectory, subDirectory } = yield* resolveLocalPath(
    "settings.tree",
    () => {
      const rootDirectory = resolveSettingsRootDirectory(
        ctx.storageRoot ?? defaultSettingsBasePath(),
        module.moduleKey,
        root.rootKey,
      );
      const subDirectory = normalizeRelativePath(request.subDirectory);
      return {
        discoveryRootPath: safeJoin(rootDirectory, subDirectory),
        rootDirectory,
        subDirectory,
      };
    },
  );
  yield* makeDirectory(discoveryRootPath, "settings.tree");

  const discovered = yield* listSettingsDirectory(
    discoveryRootPath,
    rootDirectory,
    request.recursive,
    "settings.tree",
  );
  const discoveredEntries = yield* Effect.all(
    discovered.files.map((path) => createSettingsFileEntry(path, rootDirectory, "settings.tree")),
  );
  const files = discoveredEntries
    .filter((entry) => request.includeFragments || !entry.isFragment)
    .filter((entry) => request.includeSchemas || !entry.isSchema)
    .sort((left, right) => right.modifiedUtc.localeCompare(left.modifiedUtc));
  const rootRelativePath = subDirectory;
  return {
    files,
    root: buildSettingsDirectoryTree(
      rootRelativePath ? basename(rootRelativePath) : request.rootKey,
      rootRelativePath,
      files,
      discovered.directories,
    ),
  } satisfies SettingsDiscoveryResult;
});

const saveSettingsDocumentToDisk = Effect.fnUntraced(function* (
  request: SaveSettingsDocumentRequest,
  ctx: SettingsRuntimeContext,
) {
  const module = yield* discoverModule(request.documentId, ctx);
  const { documentPath } = yield* resolveDocumentPath(
    request.documentId,
    "settings.document.save",
    ctx.storageRoot,
  );
  if (
    request.workspaceId &&
    request.workspaceId !== `settings:${sha256(documentPath.toLowerCase())}`
  )
    return yield* Effect.fail(
      new LocalOpError(
        "settings.document.save",
        "This file belongs to another Work. Select its file workspace.",
        409,
      ),
    );
  if (!request.expected)
    return yield* Effect.fail(
      new LocalOpError(
        "settings.document.save",
        "A present or missing precondition is required.",
        400,
      ),
    );
  const fs = yield* FileSystem.FileSystem;
  const current = yield* readSettingsFile(documentPath, true);
  if (
    request.expected.kind === "missing"
      ? current !== null
      : current === null || current.version !== request.expected.version
  ) {
    return {
      kind: "conflict",
      current:
        current === null
          ? null
          : yield* settingsSnapshot(request.documentId, documentPath, current, module, ctx, true),
    } satisfies SaveSettingsDocumentResult;
  }
  if (
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      new TextEncoder().encode(request.rawContent),
    ) !== request.rawContent
  )
    return yield* Effect.fail(
      new LocalOpError(
        "settings.document.save",
        "Raw content must round-trip as UTF-8; unpaired surrogates cannot be saved exactly.",
        400,
      ),
    );
  // Validation describes authoring; invalid JSON is still valid file content to preserve.
  const written = { rawContent: request.rawContent, version: sha256(request.rawContent) };
  const snapshot = yield* settingsSnapshot(
    request.documentId,
    documentPath,
    written,
    module,
    ctx,
    true,
  );
  yield* makeDirectory(win32.dirname(documentPath), "settings.document.save");
  if (request.expected.kind === "missing") {
    const result = yield* Effect.result(
      fs.writeFileString(documentPath, request.rawContent, { flag: "wx" }),
    );
    if (result._tag === "Failure") {
      if (result.failure.reason._tag === "AlreadyExists") {
        const observed = yield* readSettingsFile(documentPath, true);
        return {
          kind: "conflict",
          current:
            observed === null
              ? null
              : yield* settingsSnapshot(
                  request.documentId,
                  documentPath,
                  observed,
                  module,
                  ctx,
                  true,
                ),
        } satisfies SaveSettingsDocumentResult;
      }
      return yield* Effect.fail(localOpFileError("settings.document.save", result.failure));
    }
  } else {
    // Optimistic against external writers: read/check + rename is not an atomic CAS.
    const checked = yield* readSettingsFile(documentPath, true);
    if (checked === null || checked.version !== request.expected.version)
      return {
        kind: "conflict",
        current:
          checked === null
            ? null
            : yield* settingsSnapshot(request.documentId, documentPath, checked, module, ctx, true),
      } satisfies SaveSettingsDocumentResult;
    yield* writeFileStringAtomic(documentPath, request.rawContent, "settings.document.save");
  }
  // This snapshot names our bytes, never a post-write reread of another writer's content.
  return { kind: "written", snapshot } satisfies SaveSettingsDocumentResult;
});

const openSettingsDocumentFromDisk = Effect.fnUntraced(function* (
  request: OpenSettingsDocumentRequest,
  ctx: SettingsRuntimeContext,
  resolvedModule?: SettingsModuleDescriptor,
) {
  const module = resolvedModule ?? (yield* discoverModule(request.documentId, ctx));
  const { documentPath } = yield* resolveDocumentPath(
    request.documentId,
    "settings.document.open",
    ctx.storageRoot,
  );
  if (
    request.workspaceId &&
    request.workspaceId !== `settings:${sha256(documentPath.toLowerCase())}`
  )
    return yield* Effect.fail(
      new LocalOpError(
        "settings.document.open",
        "This file belongs to another Work. Select its file workspace.",
        409,
      ),
    );
  const content = yield* readSettingsFile(documentPath, false);
  if (!content)
    return yield* Effect.fail(new LocalOpError("settings.document.open", "File not found", 404));
  return yield* settingsSnapshot(
    request.documentId,
    documentPath,
    content,
    module,
    ctx,
    request.includeComposedContent === true,
  );
});

const readSettingsFile = Effect.fnUntraced(function* (path: string, missing: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const result = yield* Effect.result(fs.readFile(path));
  if (result._tag === "Failure") {
    const error = localOpFileError("settings.document.read", result.failure);
    if (missing && error.statusCode === 404) return null;
    return yield* Effect.fail(error);
  }
  const bytes = result.success;
  const rawContent = yield* Effect.try({
    try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
    catch: () => new LocalOpError("settings.document.read", "The file is not valid UTF-8.", 400),
  });
  return { rawContent, version: createHash("sha256").update(bytes).digest("hex") };
});

const settingsSnapshot = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  documentPath: string,
  content: { rawContent: string; version: string },
  module: SettingsModuleDescriptor,
  ctx: SettingsRuntimeContext,
  includeComposedContent: boolean,
) {
  const materialized = yield* materializeDocument(
    documentId,
    content.rawContent,
    module,
    includeComposedContent,
    ctx,
  );
  return {
    metadata: {
      documentId: { ...documentId, stableId: documentPath },
      workspaceId: `settings:${sha256(documentPath.toLowerCase())}`,
      kind: SettingsFileKind.Profile,
      versionToken: { value: content.version },
    },
    rawContent: content.rawContent,
    composedContent: materialized.composedContent,
    dependencies: materialized.dependencies,
    validation: materialized.validation,
    capabilityHints: {
      backend: "ts-local-disk",
      compositionPolicy: includeComposedContent ? "pod-preparation" : "not-requested",
      schemaValidation: materialized.schemaValidation,
      semanticValidation: materialized.semanticValidation,
    },
  } satisfies SettingsDocumentSnapshot;
});

const materializeDocument = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  rawContent: string,
  module: SettingsModuleDescriptor,
  includeComposedContent: boolean,
  ctx: SettingsRuntimeContext,
) {
  const parsed = parseJson(rawContent);
  if (!parsed.ok)
    return {
      composedContent: null,
      dependencies: [],
      schemaJson: null,
      schemaValidation: "not-run",
      semanticValidation: "not-run",
      validation: { isValid: false, issues: [parsed.issue] },
    };

  const composition = yield* composeForRead(documentId, parsed.value, rawContent, ctx);
  const schemaValidation = yield* validateWithProviderSchema(
    documentId,
    composition.value ?? parsed.value,
    ctx,
  );
  const schemaJson =
    "schemaJson" in schemaValidation && typeof schemaValidation.schemaJson === "string"
      ? schemaValidation.schemaJson
      : null;
  const structuralIssues = [...composition.issues, ...schemaValidation.issues];
  const semanticValidation = structuralIssues.some((issue) => issue.severity === "error")
    ? { issues: [] as SettingsValidationIssue[], status: "not-run" }
    : yield* validateWithFeatureSemantics(
        documentId,
        rawContent,
        composition.value ?? parsed.value,
        ctx,
      );
  const issues = [...structuralIssues, ...semanticValidation.issues];
  return {
    composedContent:
      includeComposedContent && composition.value != null
        ? normalizeJsonTrailingNewline(JSON.stringify(composition.value, null, 2))
        : null,
    dependencies: composition.dependencies,
    schemaJson,
    schemaValidation: schemaValidation.status,
    semanticValidation: semanticValidation.status,
    validation: { isValid: !issues.some((issue) => issue.severity === "error"), issues },
  };
});

const composeForRead = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  value: unknown,
  rawContent: string,
  ctx: SettingsRuntimeContext,
) {
  const dependencies: SettingsDocumentDependency[] = [];
  if (!containsDirectiveMetadata(value))
    return { dependencies, issues: [] as SettingsValidationIssue[], value };

  const result = yield* Effect.result(
    Effect.gen(function* () {
      if (!ctx.invokeBridge)
        return yield* Effect.fail(
          new Error(
            "Pod composition requires the native preparation service. Connect the matching Revit session to preview composed JSON.",
          ),
        );
      const relativePath = normalizeRelativePath(documentId.relativePath);
      const member = `settings/${relativePath.toLowerCase().endsWith(".json") ? relativePath : `${relativePath}.json`}`;
      const sourceBundle = yield* Effect.tryPromise(() =>
        capturePod(documentId.moduleKey, ctx.storageRoot, {
          path: member,
          bytesBase64: Buffer.from(rawContent, "utf8").toString("base64"),
        }),
      );
      const prepared = yield* ctx.invokeBridge(
        "scripting.pod.prepare",
        {
          workspaceKey: documentId.moduleKey,
          sourceBundle,
        },
        ctx.bridgeSessionId,
      );
      if (
        !isRecord(prepared) ||
        !Array.isArray(prepared.outcomes) ||
        !isRecord(prepared.composedSettings)
      )
        return yield* Effect.fail(new Error("Pod preparation returned an invalid response."));
      const issues: SettingsValidationIssue[] = [];
      for (const outcome of prepared.outcomes) {
        if (
          !isRecord(outcome) ||
          typeof outcome.code !== "string" ||
          typeof outcome.reason !== "string"
        )
          return yield* Effect.fail(new Error("Pod preparation returned an invalid gate outcome."));
        issues.push({
          path: typeof outcome.location === "string" ? outcome.location : "$",
          code: outcome.code,
          severity: String(outcome.severity).toLowerCase(),
          message: outcome.reason,
          suggestion: typeof outcome.remedy === "string" ? outcome.remedy : null,
        });
      }
      if (issues.some((issue) => issue.severity === "error")) return { value: null, issues };
      const content = prepared.composedSettings[member.replace(/^settings\//, "composed/")];
      if (typeof content !== "string")
        return yield* Effect.fail(new Error(`Pod preparation did not produce '${member}'.`));
      return { value: yield* Effect.try(() => JSON.parse(content) as unknown), issues };
    }),
  );
  if (result._tag === "Success") return { dependencies, ...result.success };
  return {
    dependencies,
    issues: [
      {
        path: "$",
        code: "PodPreparationUnavailable",
        severity: "error",
        message: errorMessage(result.failure),
        suggestion: "Resolve the reported preparation failure and retry.",
      },
    ],
    value: null,
  };
});

const validateWithProviderSchema = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  value: unknown,
  ctx: SettingsRuntimeContext,
) {
  if (ctx.schemaJson)
    return { ...validateWithSchemaJson(ctx.schemaJson, value), schemaJson: ctx.schemaJson };
  if (!ctx.invokeBridge) return { issues: [] as SettingsValidationIssue[], status: "unavailable" };

  const schemaResult = yield* Effect.result(
    ctx.invokeBridge(
      "settings.schema",
      { moduleKey: documentId.moduleKey, rootKey: documentId.rootKey },
      ctx.bridgeSessionId,
    ),
  );
  if (schemaResult._tag === "Failure")
    return {
      issues: [
        {
          path: "$",
          code: "SchemaProviderUnavailable",
          severity: "warning",
          message: errorMessage(schemaResult.failure),
          suggestion: "Connect the matching Revit session and retry.",
        },
      ] satisfies SettingsValidationIssue[],
      status: "provider-error",
    };

  const schemaJson = getSchemaJson(schemaResult.success);
  if (!schemaJson) return { issues: [] as SettingsValidationIssue[], status: "not-configured" };

  return { ...validateWithSchemaJson(schemaJson, value), schemaJson };
});

const validateWithFeatureSemantics = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  rawContent: string,
  composedValue: unknown,
  ctx: SettingsRuntimeContext,
) {
  if (!ctx.invokeBridge) return { issues: [] as SettingsValidationIssue[], status: "unavailable" };

  const result = yield* Effect.result(
    ctx.invokeBridge(
      "settings.document.semantic-validation",
      {
        moduleKey: documentId.moduleKey,
        rootKey: documentId.rootKey,
        relativePath: documentId.relativePath,
        rawContent,
        composedContent: normalizeJsonTrailingNewline(JSON.stringify(composedValue, null, 2)),
      },
      ctx.bridgeSessionId,
    ),
  );
  if (result._tag === "Failure")
    return {
      issues: [
        {
          path: "$",
          code: "SemanticValidatorUnavailable",
          severity: "warning",
          message: errorMessage(result.failure),
          suggestion: "Connect the matching Revit session and retry.",
        },
      ] satisfies SettingsValidationIssue[],
      status: "provider-error",
    };

  const response = normalizeSemanticValidation(result.success);
  return {
    issues: response.issues,
    status: response.isConfigured ? "configured" : "not-configured",
  };
});

function normalizeSemanticValidation(value: unknown): {
  isConfigured: boolean;
  issues: SettingsValidationIssue[];
} {
  if (!isRecord(value)) return { isConfigured: false, issues: [] };

  const issues = Array.isArray(value.issues)
    ? value.issues.flatMap((candidate) => {
        if (!isRecord(candidate) || typeof candidate.message !== "string") return [];
        return [
          {
            path:
              typeof candidate.instancePath === "string"
                ? candidate.instancePath
                : typeof candidate.path === "string"
                  ? candidate.path
                  : "$",
            code: typeof candidate.code === "string" ? candidate.code : "SemanticValidation",
            severity: typeof candidate.severity === "string" ? candidate.severity : "error",
            message: candidate.message,
            suggestion: typeof candidate.suggestion === "string" ? candidate.suggestion : null,
          },
        ];
      })
    : [];
  return { isConfigured: value.isConfigured === true, issues };
}

function validateWithSchemaJson(schemaJson: string, value: unknown) {
  const { validate, errorMessage: compileErrorMessage } = compileSchema(schemaJson);
  if (!validate)
    return {
      issues: [
        {
          path: "$",
          code: "SchemaCompileError",
          severity: "warning",
          message: compileErrorMessage ?? "Settings schema could not be compiled.",
          suggestion: "Check the C# schema provider output.",
        },
      ] satisfies SettingsValidationIssue[],
      status: "compile-error",
    };

  const ok = validate(value) as boolean;
  return {
    issues: ok ? [] : (validate.errors ?? []).map(toValidationIssue),
    status: "configured",
  };
}

function compileSchema(schemaJson: string): { validate?: ValidateFunction; errorMessage?: string } {
  const hash = sha256(schemaJson);
  const cached = schemaCache.get(hash);
  if (cached) return cached;

  try {
    const schema = JSON.parse(schemaJson) as Record<string, unknown>;
    delete schema.$schema;
    const result = { validate: ajv.compile(schema) };
    schemaCache.set(hash, result);
    return result;
  } catch (error) {
    const result = {
      errorMessage: errorMessage(error) || "Settings schema could not be compiled.",
    };
    schemaCache.set(hash, result);
    return result;
  }
}

function toValidationIssue(error: ErrorObject): SettingsValidationIssue {
  return {
    path: error.instancePath ? error.instancePath.replace(/^\//, "").replace(/\//g, ".") : "$",
    code: error.keyword,
    severity: "error",
    message: error.message ?? "Invalid value",
    suggestion: null,
  };
}

function getSchemaJson(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const schemaJson = (value as { schemaJson?: unknown }).schemaJson;
  return typeof schemaJson === "string" && schemaJson.trim() ? schemaJson : null;
}

const discoverModule = (documentId: SettingsDocumentId, _ctx: SettingsRuntimeContext) =>
  Effect.succeed({
    moduleKey: documentId.moduleKey,
    defaultRootKey: documentId.rootKey,
    roots: [{ rootKey: documentId.rootKey, displayName: documentId.rootKey }],
    storageOptions: { includeRoots: [], presetRoots: [] },
  } satisfies SettingsModuleDescriptor);

// --- URL-native $schema ------------------------------------------------------
// Settings schemas are session state (value-domain samples come from the open
// document), so they are served live from GET /schemas/settings/... — never
// persisted to disk. vscode-json-languageservice (VSCode and Zed) resolves
// http $schema URLs, and localhost URLs are machine-portable: each teammate's
// host answers for their own session.

export function settingsSchemaUrl(documentId: SettingsDocumentId): string {
  // ponytail: persisted into documents — a nonstandard base bakes machine-specific
  // URLs into files teammates open. Fine while everyone runs the default port.
  const base =
    process.env[hostProcessIdentity.hostBaseUrlVariable] ?? hostProcessIdentity.defaultHostBaseUrl;
  const moduleKey = encodeURIComponent(documentId.moduleKey);
  const rootKey = encodeURIComponent(documentId.rootKey);
  return `${base}/schemas/settings/${moduleKey}/${rootKey}.json`;
}

/** Set/repair the document's $schema URL; returns content unchanged when not applicable. */
export function injectSchemaReference(rawContent: string, schemaUrl: string): string {
  try {
    const parsed = JSON.parse(rawContent.replace(/^\uFEFF/, "")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return rawContent;
    const record = parsed as Record<string, unknown>;
    if (record.$schema === schemaUrl) return rawContent;
    delete record.$schema;
    return JSON.stringify({ $schema: schemaUrl, ...record }, null, 2);
  } catch {
    return rawContent;
  }
}

const resolveDocumentPath = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  operationKey: string,
  storageRoot?: string,
) {
  return yield* resolveLocalPath(operationKey, () => {
    const rootDirectory = resolveSettingsRootDirectory(
      storageRoot ?? defaultSettingsBasePath(),
      documentId.moduleKey,
      documentId.rootKey,
    );
    return {
      documentPath: resolveSettingsDocumentPath(rootDirectory, documentId.relativePath),
      rootDirectory,
    };
  });
});

function parseJson(rawContent: string): ParsedJson {
  try {
    return { ok: true, value: JSON.parse(rawContent.replace(/^\uFEFF/, "")) as unknown };
  } catch (error) {
    return {
      ok: false,
      issue: {
        path: "$",
        code: "JsonParseError",
        severity: "error",
        message: errorMessage(error),
        suggestion: "Fix the JSON syntax and retry.",
      },
    };
  }
}

function containsDirectiveMetadata(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsDirectiveMetadata);
  if (!isRecord(value)) return false;
  if ("$include" in value || "$preset" in value) return true;
  return Object.values(value).some(containsDirectiveMetadata);
}

