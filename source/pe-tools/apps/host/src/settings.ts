import { createHash } from "node:crypto";
import { basename, join, win32 } from "node:path";
import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { Effect, FileSystem, Option } from "effect";
import {
  SettingsDirectiveScope,
  SettingsDocumentDependencyKind,
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
import { LocalOpError } from "./local-error.ts";
import { productSettingsRootPath } from "./product-paths.ts";
import {
  makeDirectory,
  readDirectoryEntriesOrEmpty,
  readFileString,
  statFile,
  writeFileStringAtomic,
} from "./files/index.ts";

type SettingsDirectoryListing = { files: string[]; directories: string[] };
type MutableSettingsDirectoryNode = Omit<SettingsDirectoryNode, "directories" | "files"> & {
  directories: MutableSettingsDirectoryNode[];
  files: SettingsFileNode[];
};

type SettingsRuntimeContext = {
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

type CompositionDependency = {
  readonly documentId: SettingsDocumentId;
  readonly directivePath: string;
  readonly kind: SettingsDocumentDependencyKind;
  readonly scope: SettingsDirectiveScope;
};

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
const schemaCache = new Map<string, { validate?: ValidateFunction; errorMessage?: string }>();

export const discoverSettingsTree = Effect.fnUntraced(function* (
  input: SettingsTreeRequest,
  ctx: SettingsRuntimeContext = {},
) {
  const request = normalizeSettingsTreeRequest(input);
  return yield* discoverSettingsTreeFromDisk(request, ctx);
});

export function openSettingsDocument(
  request: OpenSettingsDocumentRequest,
  ctx: SettingsRuntimeContext = {},
): Effect.Effect<SettingsDocumentSnapshot, LocalOpError | Error, FileSystem.FileSystem> {
  return openSettingsDocumentFromDisk(request, ctx);
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
  return saveSettingsDocumentToDisk(request, ctx);
}

function defaultSettingsBasePath(): string {
  return productSettingsRootPath();
}

function normalizeSettingsTreeRequest(input: SettingsTreeRequest): Required<SettingsTreeRequest> {
  return {
    moduleKey: input.moduleKey || "Global",
    rootKey: input.rootKey || "fragments",
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
        defaultSettingsBasePath(),
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
  const { documentPath, rootDirectory } = yield* resolveDocumentPath(
    request.documentId,
    "settings.document.save",
  );
  const materialized = yield* materializeDocument(
    request.documentId,
    request.rawContent,
    module,
    true,
    ctx,
  );
  const currentVersionToken = yield* createSettingsVersionToken(
    documentPath,
    "settings.document.save",
  );
  const conflictDetected =
    request.expectedVersionToken != null &&
    currentVersionToken != null &&
    request.expectedVersionToken.value !== currentVersionToken.value;

  if (conflictDetected) {
    return {
      metadata: yield* buildSettingsDocumentMetadata(
        request.documentId,
        rootDirectory,
        documentPath,
        "settings.document.save",
      ),
      writeApplied: false,
      conflictDetected,
      conflictMessage: `Settings document '${stableDocumentId(request.documentId)}' changed on disk.`,
      validation: materialized.validation,
    } satisfies SaveSettingsDocumentResult;
  }

  yield* makeDirectory(win32.dirname(documentPath), "settings.document.save");
  const contentToWrite = materialized.schemaJson
    ? injectSchemaReference(request.rawContent, settingsSchemaUrl(request.documentId))
    : request.rawContent;
  yield* writeFileStringAtomic(
    documentPath,
    normalizeJsonTrailingNewline(contentToWrite),
    "settings.document.save",
  );
  return {
    metadata: yield* buildSettingsDocumentMetadata(
      request.documentId,
      rootDirectory,
      documentPath,
      "settings.document.save",
    ),
    writeApplied: true,
    conflictDetected: false,
    conflictMessage: null,
    validation: materialized.validation,
  } satisfies SaveSettingsDocumentResult;
});

const openSettingsDocumentFromDisk = Effect.fnUntraced(function* (
  request: OpenSettingsDocumentRequest,
  ctx: SettingsRuntimeContext,
  resolvedModule?: SettingsModuleDescriptor,
) {
  const module = resolvedModule ?? (yield* discoverModule(request.documentId, ctx));
  const { documentPath, rootDirectory } = yield* resolveDocumentPath(
    request.documentId,
    "settings.document.open",
  );
  const rawContent = yield* readFileString(documentPath, "settings.document.open");
  const materialized = yield* materializeDocument(
    request.documentId,
    rawContent,
    module,
    request.includeComposedContent === true,
    ctx,
  );
  return {
    metadata: yield* buildSettingsDocumentMetadata(
      request.documentId,
      rootDirectory,
      documentPath,
      "settings.document.open",
    ),
    rawContent,
    composedContent: request.includeComposedContent ? materialized.composedContent : null,
    dependencies: materialized.dependencies,
    validation: materialized.validation,
    capabilityHints: {
      backend: "ts-local-disk",
      compositionPolicy: request.includeComposedContent ? "module-scoped" : "not-requested",
      schemaValidation: materialized.schemaValidation,
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
      validation: { isValid: false, issues: [parsed.issue] },
    };

  const composition = yield* composeForRead(
    documentId,
    parsed.value,
    module,
    includeComposedContent,
  );
  const schemaValidation = yield* validateWithProviderSchema(
    documentId,
    composition.value ?? parsed.value,
    ctx,
  );
  const schemaJson =
    "schemaJson" in schemaValidation && typeof schemaValidation.schemaJson === "string"
      ? schemaValidation.schemaJson
      : null;
  const issues = [...composition.issues, ...schemaValidation.issues];
  return {
    composedContent:
      includeComposedContent && composition.value != null
        ? normalizeJsonTrailingNewline(JSON.stringify(composition.value, null, 2))
        : null,
    dependencies: composition.dependencies,
    schemaJson,
    schemaValidation: schemaValidation.status,
    validation: { isValid: !issues.some((issue) => issue.severity === "error"), issues },
  };
});

const composeForRead = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  value: unknown,
  module: SettingsModuleDescriptor,
  includeComposedContent: boolean,
) {
  const options = module.storageOptions ?? {};
  if (!shouldRunComposition(value, options)) {
    return {
      dependencies: [] as SettingsDocumentDependency[],
      issues: [] as SettingsValidationIssue[],
      value: includeComposedContent ? cloneJson(value) : null,
    };
  }

  const { rootDirectory } = yield* resolveDocumentPath(documentId, "settings.document.compose");
  const dependencies: CompositionDependency[] = [];
  const result = yield* Effect.result(
    expandPresets(cloneJson(value), rootDirectory, options, dependencies, documentId).pipe(
      Effect.flatMap((expanded) =>
        expandIncludes(expanded, rootDirectory, options, dependencies, documentId),
      ),
    ),
  );
  if (result._tag === "Success")
    return {
      dependencies: distinctDependencies(dependencies),
      issues: [] as SettingsValidationIssue[],
      value: result.success,
    };

  return {
    dependencies: distinctDependencies(dependencies),
    issues: [
      {
        path: "$",
        code: "CompositionError",
        severity: "error",
        message: errorMessage(result.failure),
        suggestion: "Fix the directive path or allowed root configuration.",
      },
    ] satisfies SettingsValidationIssue[],
    value: includeComposedContent ? cloneJson(value) : null,
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

const discoverModule = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  ctx: SettingsRuntimeContext,
) {
  if (documentId.moduleKey.toLowerCase() === "global")
    return {
      moduleKey: "Global",
      defaultRootKey: "fragments",
      roots: [{ rootKey: "fragments", displayName: "fragments" }],
      storageOptions: { includeRoots: [], presetRoots: [] },
    } satisfies SettingsModuleDescriptor;

  if (!ctx.invokeBridge)
    return {
      moduleKey: documentId.moduleKey,
      defaultRootKey: documentId.rootKey,
      roots: [{ rootKey: documentId.rootKey, displayName: documentId.rootKey }],
      storageOptions: { includeRoots: [], presetRoots: [] },
    } satisfies SettingsModuleDescriptor;

  const catalogResult = yield* Effect.result(
    ctx.invokeBridge("settings.module-catalog", undefined, ctx.bridgeSessionId),
  );
  if (catalogResult._tag === "Failure")
    return yield* Effect.fail(
      new Error(
        `Unable to discover settings module '${documentId.moduleKey}': ${errorMessage(catalogResult.failure)}`,
      ),
    );

  const modules = normalizeModuleCatalog(catalogResult.success);
  const module = modules.find(
    (candidate) => candidate.moduleKey.toLowerCase() === documentId.moduleKey.toLowerCase(),
  );
  if (!module) throw new Error(`Unknown settings module '${documentId.moduleKey}'.`);
  if (!module.roots.some((root) => root.rootKey.toLowerCase() === documentId.rootKey.toLowerCase()))
    throw new Error(`Unknown root '${documentId.rootKey}' for module '${documentId.moduleKey}'.`);
  return module;
});

function normalizeModuleCatalog(value: unknown): SettingsModuleDescriptor[] {
  const modules = (value as Partial<{ modules: unknown[] }>).modules;
  return Array.isArray(modules)
    ? modules.filter((module): module is SettingsModuleDescriptor => isSettingsModule(module))
    : [];
}

function isSettingsModule(value: unknown): value is SettingsModuleDescriptor {
  const candidate = value as Partial<SettingsModuleDescriptor>;
  return (
    value != null &&
    typeof value === "object" &&
    typeof candidate.moduleKey === "string" &&
    typeof candidate.defaultRootKey === "string" &&
    Array.isArray(candidate.roots)
  );
}

// --- URL-native $schema ------------------------------------------------------
// Settings schemas are session state (value-domain samples come from the open
// document), so they are served live from GET /schemas/settings/... — never
// persisted to disk. vscode-json-languageservice (VSCode and Zed) resolves
// http $schema URLs, and localhost URLs are machine-portable: each teammate's
// host answers for their own session.

export function settingsSchemaUrl(documentId: SettingsDocumentId): string {
  const base = hostProcessIdentity.defaultHostBaseUrl;
  const moduleKey = encodeURIComponent(documentId.moduleKey);
  const rootKey = encodeURIComponent(documentId.rootKey);
  return `${base}/schemas/settings/${moduleKey}/${rootKey}.json`;
}

/** Set/repair the document's $schema URL; returns content unchanged when not applicable. */
export function injectSchemaReference(rawContent: string, schemaUrl: string): string {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
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
) {
  return yield* resolveLocalPath(operationKey, () => {
    const rootDirectory = resolveSettingsRootDirectory(
      defaultSettingsBasePath(),
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
    return { ok: true, value: JSON.parse(rawContent) as unknown };
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

function parseJsonValue(rawContent: string) {
  return Effect.try({
    try: () => JSON.parse(rawContent) as unknown,
    catch: (error) => new Error(errorMessage(error)),
  });
}

function shouldRunComposition(
  value: unknown,
  options: NonNullable<SettingsModuleDescriptor["storageOptions"]>,
): boolean {
  return (
    (options.includeRoots?.length ?? 0) > 0 ||
    (options.presetRoots?.length ?? 0) > 0 ||
    containsDirectiveMetadata(value)
  );
}

function containsDirectiveMetadata(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsDirectiveMetadata);
  if (!isRecord(value)) return false;
  if ("$include" in value || "$preset" in value) return true;
  return Object.values(value).some(containsDirectiveMetadata);
}

const expandPresets: (
  value: unknown,
  localRootDirectory: string,
  options: NonNullable<SettingsModuleDescriptor["storageOptions"]>,
  dependencies: CompositionDependency[],
  sourceDocumentId: SettingsDocumentId,
  visited?: Set<string>,
) => Effect.Effect<unknown, LocalOpError | Error, FileSystem.FileSystem> = Effect.fnUntraced(
  function* (
    value: unknown,
    localRootDirectory: string,
    options: NonNullable<SettingsModuleDescriptor["storageOptions"]>,
    dependencies: CompositionDependency[],
    sourceDocumentId: SettingsDocumentId,
    visited: Set<string> = new Set(),
  ) {
    if (Array.isArray(value))
      return yield* Effect.all(
        value.map((item) =>
          expandPresets(item, localRootDirectory, options, dependencies, sourceDocumentId, visited),
        ),
      );
    if (!isRecord(value)) return value;
    if ("$preset" in value) {
      const keys = Object.keys(value);
      if (keys.some((key) => key !== "$preset"))
        throw new Error(
          "Invalid '$preset' usage. Preset composition does not support inline overrides.",
        );
      const directive = resolveDirective(
        value.$preset,
        localRootDirectory,
        options.presetRoots ?? [],
        false,
      );
      const path = yield* resolveDirectiveFilePath(directive);
      if (visited.has(path.toLowerCase()))
        throw new Error(`Circular preset reference detected: ${path}`);
      visited.add(path.toLowerCase());
      const content = yield* readFileString(path, "settings.document.compose");
      const parsed = yield* parseJsonValue(content);
      if (!isRecord(parsed))
        throw new Error(`Preset '${basename(path)}' has invalid format. Expected a JSON object.`);
      dependencies.push(
        createDependency(sourceDocumentId, directive, path, SettingsDocumentDependencyKind.Preset),
      );
      const expanded = yield* expandPresets(
        cloneJson(parsed),
        localRootDirectory,
        options,
        dependencies,
        sourceDocumentId,
        visited,
      );
      visited.delete(path.toLowerCase());
      if (isRecord(expanded)) delete expanded.$schema;
      return expanded;
    }
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value))
      next[key] = yield* expandPresets(
        child,
        localRootDirectory,
        options,
        dependencies,
        sourceDocumentId,
        visited,
      );
    return next;
  },
);

const expandIncludes: (
  value: unknown,
  localRootDirectory: string,
  options: NonNullable<SettingsModuleDescriptor["storageOptions"]>,
  dependencies: CompositionDependency[],
  sourceDocumentId: SettingsDocumentId,
) => Effect.Effect<unknown, LocalOpError | Error, FileSystem.FileSystem> = Effect.fnUntraced(
  function* (
    value: unknown,
    localRootDirectory: string,
    options: NonNullable<SettingsModuleDescriptor["storageOptions"]>,
    dependencies: CompositionDependency[],
    sourceDocumentId: SettingsDocumentId,
  ) {
    const expand: (
      candidate: unknown,
      visited: Set<string>,
    ) => Effect.Effect<unknown, LocalOpError | Error, FileSystem.FileSystem> = Effect.fnUntraced(
      function* (candidate: unknown, visited: Set<string>) {
        if (Array.isArray(candidate)) {
          const next: unknown[] = [];
          for (const item of candidate) {
            if (isRecord(item) && "$include" in item) {
              const directive = resolveDirective(
                item.$include,
                localRootDirectory,
                options.includeRoots ?? [],
                true,
              );
              const path = yield* resolveDirectiveFilePath(directive);
              if (visited.has(path.toLowerCase()))
                throw new Error(`Circular fragment include detected: ${path}`);
              visited.add(path.toLowerCase());
              const fragment = yield* loadFragmentItems(path);
              dependencies.push(
                createDependency(
                  sourceDocumentId,
                  directive,
                  path,
                  SettingsDocumentDependencyKind.Include,
                ),
              );
              for (const fragmentItem of fragment) next.push(yield* expand(fragmentItem, visited));
              visited.delete(path.toLowerCase());
              continue;
            }
            next.push(yield* expand(item, visited));
          }
          return next;
        }
        if (!isRecord(candidate)) return candidate;
        const next: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(candidate))
          next[key] = yield* expand(child, visited);
        return next;
      },
    );
    return yield* expand(value, new Set());
  },
);

type ResolvedDirective = {
  readonly originalPath: string;
  readonly relativePath: string;
  readonly rootDirectory: string;
  readonly rootSegment: string;
  readonly scope: SettingsDirectiveScope;
};

function resolveDirective(
  directivePath: unknown,
  localRootDirectory: string,
  allowedRoots: readonly string[],
  requireGlobalAllowedRoot: boolean,
): ResolvedDirective {
  if (typeof directivePath !== "string" || !directivePath.trim())
    throw new Error("Directive path must be a non-empty string.");
  const isGlobal = directivePath.toLowerCase().startsWith("@global/");
  const isLocal = directivePath.toLowerCase().startsWith("@local/");
  if (!isGlobal && !isLocal)
    throw new Error("Directive path must start with '@local/' or '@global/'.");
  const rawRelativePath = directivePath.slice(isGlobal ? "@global/".length : "@local/".length);
  const relativePath = normalizeRelativePath(rawRelativePath);
  const rootSegment = relativePath.split("/")[0];
  const roots = normalizeAllowedRoots(allowedRoots);
  if (roots.size !== 0 && !roots.has(rootSegment.toLowerCase()))
    throw new Error(`Directive root '${rootSegment}' is not allowed.`);
  if (isGlobal && roots.size === 0 && requireGlobalAllowedRoot)
    throw new Error("Global directives require an allowed root.");
  const globalRootDirectory = tryResolveGlobalFragmentsDirectory(localRootDirectory);
  return {
    originalPath: directivePath,
    relativePath,
    rootDirectory: isGlobal ? globalRootDirectory : localRootDirectory,
    rootSegment,
    scope: isGlobal ? SettingsDirectiveScope.Global : SettingsDirectiveScope.Local,
  };
}

const resolveDirectiveFilePath = Effect.fnUntraced(function* (directive: ResolvedDirective) {
  const normalizedPath = directive.relativePath.replace(/\//g, "\\");
  const hasJsonExtension = directive.relativePath.toLowerCase().endsWith(".json");
  const jsonPath = safeJoin(
    directive.rootDirectory,
    hasJsonExtension ? normalizedPath : `${normalizedPath}.json`,
  );
  const fs = yield* FileSystem.FileSystem;
  if (yield* fs.exists(jsonPath)) return jsonPath;
  return yield* Effect.fail(new Error(`Settings composition file not found: ${jsonPath}`));
});

const loadFragmentItems = Effect.fnUntraced(function* (path: string) {
  const parsed = yield* parseJsonValue(yield* readFileString(path, "settings.document.compose"));
  if (Array.isArray(parsed)) return parsed;
  if (isRecord(parsed) && Array.isArray(parsed.Items)) return parsed.Items;
  return yield* Effect.fail(
    new Error(
      `Fragment '${basename(path)}' has invalid format. Expected array or object with Items array.`,
    ),
  );
});

function createDependency(
  sourceDocumentId: SettingsDocumentId,
  directive: ResolvedDirective,
  sourceFilePath: string,
  kind: SettingsDocumentDependencyKind,
): CompositionDependency {
  const rootDirectory =
    directive.scope === SettingsDirectiveScope.Global
      ? tryResolveGlobalFragmentsDirectory(
          resolveSettingsRootDirectory(
            defaultSettingsBasePath(),
            sourceDocumentId.moduleKey,
            sourceDocumentId.rootKey,
          ),
        )
      : directive.rootDirectory;
  return {
    directivePath: directive.originalPath,
    documentId: {
      moduleKey:
        directive.scope === SettingsDirectiveScope.Global ? "Global" : sourceDocumentId.moduleKey,
      rootKey:
        directive.scope === SettingsDirectiveScope.Global ? "fragments" : sourceDocumentId.rootKey,
      relativePath: stripJsonExtension(toRelativePath(rootDirectory, sourceFilePath)),
    },
    kind,
    scope: directive.scope,
  };
}

function distinctDependencies(dependencies: CompositionDependency[]): SettingsDocumentDependency[] {
  const seen = new Set<string>();
  return dependencies.filter((dependency) => {
    const key = `${dependency.kind}:${dependency.scope}:${dependency.directivePath}:${stableDocumentId(dependency.documentId)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function statMtime(info: FileSystem.File.Info): Date {
  return Option.getOrElse(info.mtime, () => new Date(0));
}

const listSettingsDirectory: (
  directory: string,
  rootDirectory: string,
  recursive: boolean,
  operationKey: string,
) => Effect.Effect<SettingsDirectoryListing, LocalOpError, FileSystem.FileSystem> =
  Effect.fnUntraced(function* (
    directory: string,
    rootDirectory: string,
    recursive: boolean,
    operationKey: string,
  ) {
    const entries = yield* readDirectoryEntriesOrEmpty(directory, operationKey);
    const files: string[] = [];
    const directories: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.info.type === "Directory") {
        directories.push(toRelativePath(rootDirectory, path));
        if (recursive) {
          const nested = yield* listSettingsDirectory(path, rootDirectory, true, operationKey);
          files.push(...nested.files);
          directories.push(...nested.directories);
        }
        continue;
      }
      if (entry.info.type === "File" && entry.name.toLowerCase().endsWith(".json"))
        files.push(path);
    }
    return { files, directories } satisfies SettingsDirectoryListing;
  });

const createSettingsFileEntry = Effect.fnUntraced(function* (
  filePath: string,
  rootDirectory: string,
  operationKey: string,
) {
  const file = yield* statFile(filePath, operationKey);
  const relativePath = toRelativePath(rootDirectory, filePath);
  const relativePathWithoutExtension = stripJsonExtension(relativePath);
  const directory = dirnameRelative(relativePath);
  const name = basename(relativePath);
  const isSchema =
    name.toLowerCase().endsWith(".schema.json") || name.toLowerCase() === "schema.json";
  const isFragment = relativePath.split("/").some((segment) => segment.startsWith("_"));
  return {
    path: filePath,
    relativePath,
    relativePathWithoutExtension,
    name,
    baseName: stripJsonExtension(name),
    directory,
    modifiedUtc: statMtime(file).toISOString(),
    kind: isSchema
      ? SettingsFileKind.Schema
      : isFragment
        ? SettingsFileKind.Fragment
        : SettingsFileKind.Profile,
    isFragment,
    isSchema,
  };
});

function buildSettingsDirectoryTree(
  rootName: string,
  rootRelativePath: string,
  files: SettingsFileEntry[],
  directories: string[],
): SettingsDirectoryNode {
  const root: MutableSettingsDirectoryNode = {
    name: rootName,
    relativePath: rootRelativePath,
    directories: [],
    files: [],
  };
  for (const directory of [...new Set(directories)].filter(Boolean)) {
    ensureDirectoryNode(
      root,
      rootRelativePath,
      localRelativePath(directory, rootRelativePath).split("/").filter(Boolean),
    );
  }
  for (const file of files) {
    const segments = localRelativePath(file.relativePath, rootRelativePath)
      .split("/")
      .filter(Boolean);
    const name = segments.pop();
    if (!name) continue;
    const current = ensureDirectoryNode(root, rootRelativePath, segments);
    current.files.push({
      name,
      relativePath: file.relativePath,
      relativePathWithoutExtension: file.relativePathWithoutExtension,
      id: file.relativePathWithoutExtension,
      modifiedUtc: file.modifiedUtc,
      kind: file.kind,
      isFragment: file.isFragment,
      isSchema: file.isSchema,
    } satisfies SettingsFileNode);
  }
  sortSettingsTree(root);
  return root;
}

function ensureDirectoryNode(
  root: MutableSettingsDirectoryNode,
  rootRelativePath: string,
  segments: string[],
): MutableSettingsDirectoryNode {
  let current = root;
  let currentRelativePath = rootRelativePath;
  for (const segment of segments) {
    currentRelativePath = currentRelativePath ? `${currentRelativePath}/${segment}` : segment;
    let next = current.directories.find(
      (directory) => directory.name.toLowerCase() === segment.toLowerCase(),
    );
    if (!next) {
      next = { name: segment, relativePath: currentRelativePath, directories: [], files: [] };
      current.directories.push(next);
    }
    current = next;
  }
  return current;
}

function sortSettingsTree(node: MutableSettingsDirectoryNode): void {
  node.directories.sort((left, right) => left.name.localeCompare(right.name));
  node.files.sort((left, right) => left.name.localeCompare(right.name));
  for (const directory of node.directories) sortSettingsTree(directory);
}

const buildSettingsDocumentMetadata = Effect.fnUntraced(function* (
  documentId: SettingsDocumentId,
  rootDirectory: string,
  documentPath: string,
  operationKey: string,
) {
  const entryResult = yield* Effect.result(
    createSettingsFileEntry(documentPath, rootDirectory, operationKey),
  );
  const entry = entryResult._tag === "Success" ? entryResult.success : null;
  return {
    documentId,
    kind: entry?.kind ?? SettingsFileKind.Profile,
    modifiedUtc: entry?.modifiedUtc ?? null,
    versionToken: yield* createSettingsVersionToken(documentPath, operationKey),
  };
});

const createSettingsVersionToken = Effect.fnUntraced(function* (
  documentPath: string,
  operationKey: string,
) {
  const content = yield* Effect.result(readFileString(documentPath, operationKey));
  return content._tag === "Success" ? { value: sha256(content.success) } : null;
});

const resolveLocalPath = Effect.fnUntraced(function* <A>(operationKey: string, resolve: () => A) {
  return yield* Effect.try({
    try: resolve,
    catch: (error) => newLocalOpError(operationKey, errorMessage(error), 400),
  });
});

function resolveSettingsRootDirectory(
  basePath: string,
  moduleKey: string,
  rootKey: string,
): string {
  return safeJoin(
    safeJoin(basePath, normalizeRelativePath(moduleKey)),
    normalizeRelativePath(rootKey),
  );
}

function resolveSettingsDocumentPath(rootDirectory: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new Error("Settings document path is required.");
  return safeJoin(
    rootDirectory,
    normalized.toLowerCase().endsWith(".json") ? normalized : `${normalized}.json`,
  );
}

function safeJoin(rootPath: string, relativePath: string): string {
  const root = win32.resolve(rootPath);
  const combined = win32.resolve(root, relativePath.replace(/\//g, "\\"));
  if (combined !== root && !combined.toLowerCase().startsWith(`${root.toLowerCase()}\\`))
    throw new Error("Path escapes the configured settings root.");
  return combined;
}

function normalizeRelativePath(input: string | null | undefined): string {
  if (!input) return "";
  if (win32.isAbsolute(input)) throw new Error("Rooted settings paths are not allowed.");
  const segments = input
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".."))
    throw new Error("Invalid settings path segment.");
  return segments.join("/");
}

function normalizeAllowedRoots(allowedRoots: readonly string[]): Set<string> {
  return new Set(
    allowedRoots
      .map((root) =>
        root
          .replace(/\\/g, "/")
          .replace(/^\/|\/$/g, "")
          .trim(),
      )
      .filter(Boolean)
      .map((root) => root.toLowerCase()),
  );
}

function tryResolveGlobalFragmentsDirectory(settingsRootPath: string): string {
  const parts = win32.resolve(settingsRootPath).split(/[\\/]/);
  const settingsIndex = parts.findIndex((part) => part.toLowerCase() === "settings");
  if (settingsIndex >= 0)
    return win32.join(...parts.slice(0, settingsIndex + 1), "Global", "fragments");
  return win32.resolve(settingsRootPath, "..", "..", "Global", "fragments");
}

function toRelativePath(rootDirectory: string, filePath: string): string {
  return win32.relative(rootDirectory, filePath).replace(/\\/g, "/");
}

function localRelativePath(relativePath: string, rootRelativePath: string): string {
  if (!rootRelativePath) return relativePath;
  const prefix = `${rootRelativePath.replace(/\/$/, "")}/`;
  if (relativePath.toLowerCase().startsWith(prefix.toLowerCase()))
    return relativePath.slice(prefix.length);
  return relativePath.toLowerCase() === rootRelativePath.toLowerCase()
    ? basename(relativePath)
    : relativePath;
}

function dirnameRelative(relativePath: string): string | null {
  const index = relativePath.lastIndexOf("/");
  return index <= 0 ? null : relativePath.slice(0, index);
}

function stripJsonExtension(path: string): string {
  return path.toLowerCase().endsWith(".json") ? path.slice(0, -5) : path;
}

function normalizeJsonTrailingNewline(rawContent: string): string {
  return `${rawContent.replace(/\s*$/, "")}\n`;
}

function stableDocumentId(documentId: SettingsDocumentId): string {
  return (
    documentId.stableId ??
    `${documentId.moduleKey}:${documentId.rootKey}:${documentId.relativePath}`
  ).toLowerCase();
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function newLocalOpError(key: string, note: string, statusCode?: number): LocalOpError {
  return new LocalOpError(key, note, statusCode);
}
