import { fileURLToPath } from "node:url";
import path from "node:path";
import type { PeaRuntimeContextEntry } from "./pea-runtime-context.js";
import { sanitizeJson, type PeaJsonObject, type PeaJsonValue } from "./pea-runtime-events.js";
import type { PeaRuntimeProtocol } from "./pea-runtime-events.js";

export type PeaRuntimeResourceKind = "link" | "embedded" | "input" | "context";

export interface PeaRuntimeResource {
  id: string;
  kind: PeaRuntimeResourceKind;
  protocol?: PeaRuntimeProtocol;
  uri?: string;
  name?: string;
  title?: string;
  mimeType?: string;
  text?: string;
  blob?: string;
  data?: string;
  source?: PeaJsonValue;
  metadata?: PeaJsonValue;
}

export interface PeaRuntimeResourceScope {
  cwd: string;
  additionalDirectories: string[];
  roots: string[];
}

export interface PeaRuntimeScopedResource extends PeaRuntimeResource {
  path?: string;
  inScope?: boolean;
}

export function createPeaRuntimeResourceScope(options: {
  cwd: string;
  additionalDirectories?: string[];
}): PeaRuntimeResourceScope {
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

export function scopePeaRuntimeResource(
  resource: PeaRuntimeResource,
  scope: PeaRuntimeResourceScope,
): PeaRuntimeScopedResource {
  const filePath = resource.uri ? filePathFromUri(resource.uri) : undefined;
  const scoped: PeaRuntimeScopedResource = {
    ...resource,
    path: filePath,
    inScope: filePath ? isPathInScope(filePath, scope.roots) : undefined,
  };
  return stripUndefined(scoped);
}

export function createPeaRuntimeResourceContextEntries(options: {
  scope: PeaRuntimeResourceScope;
  resources?: PeaRuntimeResource[];
}): PeaRuntimeContextEntry[] {
  const resources = options.resources ?? [];
  if (resources.length === 0 && options.scope.additionalDirectories.length === 0) return [];

  return [
    {
      description: "Pea runtime resource scope",
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
      const scoped = scopePeaRuntimeResource(resource, options.scope);
      return {
        description: `Pea runtime resource: ${resourceLabel(scoped)}`,
        value: JSON.stringify(sanitizeResource(scoped), null, 2),
      };
    }),
  ];
}

export function resourceLabel(resource: PeaRuntimeResource): string {
  return resource.title || resource.name || resource.uri || resource.id;
}

function sanitizeResource(resource: PeaRuntimeScopedResource): PeaJsonObject {
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
