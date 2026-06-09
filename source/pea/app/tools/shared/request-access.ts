import * as os from "node:os";
import * as path from "node:path";
import type { HarnessRequestContext } from "@mastra/core/harness";
import { createTool } from "@mastra/core/tools";
import { LocalFilesystem } from "@mastra/core/workspace";
import z from "zod";

interface RequestAccessInput {
  path: string;
  reason: string;
}

interface RequestAccessToolContext {
  requestContext?: { get: (key: string) => unknown };
  workspace?: { filesystem?: unknown };
}

interface PeaSandboxState {
  sandboxAllowedPaths?: string[];
  projectPath?: string;
  configDir?: string;
}

const requestAccessInputSchema = z.object({
  path: z.string().min(1).describe("The absolute path to the directory you need access to."),
  reason: z.string().min(1).describe("Brief explanation of why you need access to this directory."),
});

export const requestAccess = createTool({
  id: "request_access",
  description:
    "Request permission to access a directory outside the current Pea workspace. Use this when the user asks you to inspect or edit files outside the sandbox. Approval grants the active workspace access to the directory for this runtime session.",
  inputSchema: requestAccessInputSchema,
  requireApproval: async (input: RequestAccessInput, context: RequestAccessToolContext) =>
    requestAccessRequiresApproval(input, context),
  execute: async ({ path: requestedPath }: RequestAccessInput, context: RequestAccessToolContext) => {
    try {
      const access = resolveRequestAccessContext(requestedPath, context);
      if (isPathAllowed(access.absolutePath, access.projectRoot, access.allowedPaths)) {
        return {
          content: `Access already granted: "${access.absolutePath}" is within the Pea workspace or allowed paths.`,
          isError: false,
        };
      }

      grantWorkspaceAccess({
        harnessCtx: access.harnessCtx,
        localFilesystem: access.localFilesystem,
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
} as any);

export function requestAccessRequiresApproval(
  { path: requestedPath }: RequestAccessInput,
  context: RequestAccessToolContext,
): boolean {
  const access = resolveRequestAccessContext(requestedPath, context);
  return !isPathAllowed(access.absolutePath, access.projectRoot, access.allowedPaths);
}

export function grantWorkspaceAccess(options: {
  harnessCtx?: Pick<HarnessRequestContext<PeaSandboxState>, "getState" | "setState">;
  localFilesystem?: LocalFilesystem;
  absolutePath: string;
}): void {
  const currentAllowed = options.harnessCtx?.getState?.()?.sandboxAllowedPaths ?? [];
  if (!currentAllowed.includes(options.absolutePath)) {
    options.harnessCtx?.setState?.({
      sandboxAllowedPaths: [...currentAllowed, options.absolutePath],
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

function resolveRequestAccessContext(requestedPath: string, toolContext: RequestAccessToolContext) {
  const harnessCtx = toolContext?.requestContext?.get("harness") as
    | HarnessRequestContext<PeaSandboxState>
    | undefined;
  const filesystem = toolContext?.workspace?.filesystem;
  const localFilesystem = filesystem instanceof LocalFilesystem ? filesystem : undefined;
  const absolutePath = resolveRequestedPath(requestedPath, localFilesystem?.basePath);
  const projectRoot = localFilesystem?.basePath ?? process.cwd();
  const allowedPaths = getAllowedPathsFromContext(toolContext, localFilesystem);
  return { harnessCtx, localFilesystem, absolutePath, projectRoot, allowedPaths };
}

function getAllowedPathsFromContext(
  toolContext: RequestAccessToolContext | undefined,
  localFilesystem: LocalFilesystem | undefined,
): string[] {
  const harnessCtx = toolContext?.requestContext?.get("harness") as
    | { state?: PeaSandboxState; getState?: () => PeaSandboxState }
    | undefined;
  const state = harnessCtx?.getState?.() ?? harnessCtx?.state;
  return [...(localFilesystem?.allowedPaths ?? []), ...(state?.sandboxAllowedPaths ?? [])];
}

function expandTilde(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\"))
    return path.join(os.homedir(), value.slice(2));
  return value;
}
