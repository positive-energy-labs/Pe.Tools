import * as os from "node:os";
import * as path from "node:path";
import { createTool } from "@mastra/core/tools";
import { LocalFilesystem } from "@mastra/core/workspace";
import z from "zod";

interface PeaSandboxState {
  sandboxAllowedPaths?: string[];
  projectPath?: string;
  configDir?: string;
}

interface RuntimeThreadSettingsContext {
  setThreadSetting: (options: { key: string; value: unknown }) => Promise<void> | void;
}

interface RequestAccessControllerContext {
  state?: PeaSandboxState;
  getState?: () => PeaSandboxState;
  setState?: (updates: Partial<PeaSandboxState>) => Promise<void> | void;
  updateState?: <TResult>(
    updater: (state: PeaSandboxState) => {
      updates?: Partial<PeaSandboxState>;
      result: TResult;
    },
  ) => Promise<TResult>;
  workspace?: { filesystem?: unknown };
}

const runtimeThreadSettingsKey = "runtime.threadSettings";

const requestAccessInputSchema = z.object({
  path: z.string().min(1).describe("The absolute path to the directory you need access to."),
  reason: z.string().min(1).describe("Brief explanation of why you need access to this directory."),
});

type RequestAccessInput = z.infer<typeof requestAccessInputSchema>;

export const requestAccess = createTool({
  id: "request_access",
  description:
    "Request permission to access a directory outside the current Pea workspace. Use this when the user asks you to inspect or edit files outside the sandbox. Approval grants the active workspace access to the directory for this runtime session.",
  inputSchema: requestAccessInputSchema,
  requireApproval: async (input, context) => requestAccessRequiresApproval(input, context),
  execute: async ({ path: requestedPath }, context) => {
    try {
      const access = resolveRequestAccessContext(requestedPath, context);
      if (isPathAllowed(access.absolutePath, access.projectRoot, access.allowedPaths)) {
        return {
          content: `Access already granted: "${access.absolutePath}" is within the Pea workspace or allowed paths.`,
          isError: false,
        };
      }

      await grantWorkspaceAccess({
        controllerCtx: access.controllerCtx,
        localFilesystem: access.localFilesystem,
        threadSettings: access.threadSettings,
        absolutePath: access.absolutePath,
      });
      return {
        content: `Access granted: "${access.absolutePath}" has been added to allowed paths. You can now access files in this directory.`,
        isError: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: `Failed to request sandbox access: ${message}`,
        isError: true,
      };
    }
  },
});

export function requestAccessRequiresApproval(
  { path: requestedPath }: RequestAccessInput,
  context: unknown,
): boolean {
  const access = resolveRequestAccessContext(requestedPath, context);
  return !isPathAllowed(access.absolutePath, access.projectRoot, access.allowedPaths);
}

export function grantWorkspaceAccess(options: {
  controllerCtx?: RequestAccessControllerContext;
  localFilesystem?: LocalFilesystem;
  threadSettings?: RuntimeThreadSettingsContext;
  absolutePath: string;
}): Promise<void> {
  return grantWorkspaceAccessAsync(options);
}

async function grantWorkspaceAccessAsync(options: {
  controllerCtx?: RequestAccessControllerContext;
  localFilesystem?: LocalFilesystem;
  threadSettings?: RuntimeThreadSettingsContext;
  absolutePath: string;
}): Promise<void> {
  let allowedPaths: string[] | undefined;

  if (options.controllerCtx?.updateState) {
    allowedPaths = await options.controllerCtx.updateState((state) => {
      const currentAllowed = state.sandboxAllowedPaths ?? [];
      const nextAllowed = currentAllowed.includes(options.absolutePath)
        ? currentAllowed
        : [...currentAllowed, options.absolutePath];
      return {
        updates: nextAllowed === currentAllowed ? undefined : { sandboxAllowedPaths: nextAllowed },
        result: nextAllowed,
      };
    });
  } else {
    const currentAllowed = options.controllerCtx?.getState?.()?.sandboxAllowedPaths ?? [];
    allowedPaths = currentAllowed.includes(options.absolutePath)
      ? currentAllowed
      : [...currentAllowed, options.absolutePath];
    if (allowedPaths !== currentAllowed) {
      await options.controllerCtx?.setState?.({
        sandboxAllowedPaths: allowedPaths,
      });
    }
  }

  if (allowedPaths) {
    await options.threadSettings?.setThreadSetting({
      key: "sandboxAllowedPaths",
      value: allowedPaths,
    });
  }

  options.localFilesystem?.setAllowedPaths((previous) =>
    previous.includes(options.absolutePath) ? [...previous] : [...previous, options.absolutePath],
  );
}

export function resolveRequestedPath(requestedPath: string, basePath = process.cwd()): string {
  const expanded = expandTilde(requestedPath);
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(basePath, expanded));
}

export function isPathAllowed(
  targetPath: string,
  projectRoot: string,
  allowedPaths: readonly string[] = [],
): boolean {
  const resolved = path.resolve(targetPath);
  const roots = [projectRoot, ...allowedPaths].map((entry) => path.resolve(entry));
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

function resolveRequestAccessContext(requestedPath: string, toolContext: unknown) {
  const controllerCtx = readRequestAccessControllerContext(
    readToolRequestContextValue(toolContext, "controller"),
  );
  const filesystem = readToolContextFilesystem(toolContext) ?? controllerCtx?.workspace?.filesystem;
  const localFilesystem = filesystem instanceof LocalFilesystem ? filesystem : undefined;
  const threadSettings = readRuntimeThreadSettingsContext(
    readToolRequestContextValue(toolContext, runtimeThreadSettingsKey),
  );
  const absolutePath = resolveRequestedPath(requestedPath, localFilesystem?.basePath);
  const projectRoot = localFilesystem?.basePath ?? process.cwd();
  const allowedPaths = getAllowedPathsFromContext(toolContext, localFilesystem);
  return {
    controllerCtx,
    localFilesystem,
    threadSettings,
    absolutePath,
    projectRoot,
    allowedPaths,
  };
}

function getAllowedPathsFromContext(
  toolContext: unknown,
  localFilesystem: LocalFilesystem | undefined,
): string[] {
  const controllerCtx = readRequestAccessControllerContext(
    readToolRequestContextValue(toolContext, "controller"),
  );
  const state = controllerCtx?.getState?.() ?? controllerCtx?.state;
  return [...(localFilesystem?.allowedPaths ?? []), ...(state?.sandboxAllowedPaths ?? [])];
}

function readToolRequestContextValue(toolContext: unknown, key: string): unknown {
  const context = readRecord(toolContext);
  const requestContext = context.requestContext;
  if (hasRequestContextGetter(requestContext)) return requestContext.get(key);
  if (isRecord(requestContext)) return requestContext[key];
  return undefined;
}

function hasRequestContextGetter(value: unknown): value is { get: (key: string) => unknown } {
  return isRecord(value) && typeof value.get === "function";
}

function readToolContextFilesystem(toolContext: unknown): unknown {
  const workspace = readRecord(readRecord(toolContext).workspace);
  return workspace.filesystem;
}

function readRequestAccessControllerContext(
  value: unknown,
): RequestAccessControllerContext | undefined {
  if (!isRequestAccessControllerContext(value)) return undefined;
  return value;
}

function isRequestAccessControllerContext(value: unknown): value is RequestAccessControllerContext {
  if (!isRecord(value)) return false;
  return (
    (value.state == null || isPeaSandboxState(value.state)) &&
    (value.getState == null || typeof value.getState === "function") &&
    (value.setState == null || typeof value.setState === "function") &&
    (value.updateState == null || typeof value.updateState === "function") &&
    (value.workspace == null || isRecord(value.workspace))
  );
}

function readRuntimeThreadSettingsContext(
  value: unknown,
): RuntimeThreadSettingsContext | undefined {
  return isRuntimeThreadSettingsContext(value) ? value : undefined;
}

function isRuntimeThreadSettingsContext(value: unknown): value is RuntimeThreadSettingsContext {
  return isRecord(value) && typeof value.setThreadSetting === "function";
}

function isPeaSandboxState(value: unknown): value is PeaSandboxState {
  if (!isRecord(value)) return false;
  return (
    (value.sandboxAllowedPaths == null ||
      (Array.isArray(value.sandboxAllowedPaths) &&
        value.sandboxAllowedPaths.every((entry) => typeof entry === "string"))) &&
    (value.projectPath == null || typeof value.projectPath === "string") &&
    (value.configDir == null || typeof value.configDir === "string")
  );
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandTilde(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\"))
    return path.join(os.homedir(), value.slice(2));
  return value;
}
