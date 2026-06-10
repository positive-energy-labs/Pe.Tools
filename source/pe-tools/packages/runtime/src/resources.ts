import { fileURLToPath } from "node:url";
import path from "node:path";
import type { RuntimeContextEntry } from "./context.ts";
import { sanitizeJson, type RuntimeJsonObject, type RuntimeJsonValue } from "./events.ts";
import type { RuntimeProtocol } from "./events.ts";

export type RuntimeResourceKind = "link" | "embedded" | "input" | "context";

export interface RuntimeResource {
  id: string;
  kind: RuntimeResourceKind;
  protocol?: RuntimeProtocol;
  uri?: string;
  name?: string;
  title?: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  data?: string;
  source?: RuntimeJsonValue;
  metadata?: RuntimeJsonValue;
}

export interface RuntimeResourceScope {
  cwd: string;
  additionalDirectories: string[];
  roots: string[];
}

export interface RuntimeScopedResource extends RuntimeResource {
  path?: string;
  inScope?: boolean;
}

export function createRuntimeResourceScope(options: {
  cwd: string;
  additionalDirectories?: string[];
}): RuntimeResourceScope {
  const cwd = normalizePath(options.cwd);
  const additionalDirectories = Array.from(
    new Set((options.additionalDirectories ?? []).map(normalizePath)),
  );
  return {
    cwd,
    additionalDirectories,
    roots: Array.from(new Set([cwd, ...additionalDirectories])),
  };
}

export function scopeRuntimeResource(
  resource: RuntimeResource,
  scope: RuntimeResourceScope,
): RuntimeScopedResource {
  const filePath = resource.uri ? filePathFromUri(resource.uri) : undefined;
  const scoped: RuntimeScopedResource = {
    ...resource,
    path: filePath,
    inScope: filePath ? isPathInScope(filePath, scope.roots) : undefined,
  };
  return stripUndefined(scoped);
}

export function createRuntimeResourceContextEntries(options: {
  scope: RuntimeResourceScope;
  resources?: RuntimeResource[];
}): RuntimeContextEntry[] {
  const resources = options.resources ?? [];
  if (resources.length === 0 && options.scope.additionalDirectories.length === 0) return [];

  return [
    {
      description: "Runtime resource scope",
      value: JSON.stringify(
        {
          cwd: options.scope.cwd,
          additionalDirectories: options.scope.additionalDirectories,
        },
        null,
        2,
      ),
    },
    ...resources.map((resource) => {
      const scoped = scopeRuntimeResource(resource, options.scope);
      return {
        description: `Runtime resource: ${resourceLabel(scoped)}`,
        value: JSON.stringify(sanitizeResource(scoped), null, 2),
      };
    }),
  ];
}

export function resourceLabel(resource: RuntimeResource): string {
  return resource.title || resource.name || resource.uri || resource.id;
}

function sanitizeResource(resource: RuntimeScopedResource): RuntimeJsonObject {
  const sanitized = sanitizeJson(stripUndefined(resource));
  return typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)
    ? sanitized
    : {};
}

function filePathFromUri(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try {
    return normalizePath(fileURLToPath(uri));
  } catch {
    return undefined;
  }
}

function isPathInScope(filePath: string, roots: string[]): boolean {
  const resolvedFilePath = normalizePath(filePath);
  return roots.some((root) => {
    const relative = path.relative(root, resolvedFilePath);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

function normalizePath(value: string): string {
  return path.resolve(value);
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
