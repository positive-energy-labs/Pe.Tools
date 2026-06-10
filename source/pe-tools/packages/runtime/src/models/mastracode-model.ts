import { access, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";

export interface MastraCodeModelResolveOptions {
  thinkingLevel?: "off" | "low" | "medium" | "high" | "xhigh";
  remapForCodexOAuth?: boolean;
  requestContext?: RequestContext;
}

export type MastraCodeModelResolver = (
  modelId: string,
  options?: MastraCodeModelResolveOptions,
) => MastraModelConfig | Promise<MastraModelConfig>;

const require = createRequire(import.meta.url);
let resolverTask: Promise<MastraCodeModelResolver> | undefined;

export async function resolveMastraCodeModel(
  modelId: string,
  options?: MastraCodeModelResolveOptions,
): Promise<MastraModelConfig> {
  const resolveModel = await loadMastraCodeModelResolver();
  return resolveModel(modelId, options);
}

async function loadMastraCodeModelResolver(): Promise<MastraCodeModelResolver> {
  resolverTask ??= (async () => {
    const rootModule = (await import("mastracode")) as {
      resolveModel?: MastraCodeModelResolver;
    };
    if (rootModule.resolveModel) return rootModule.resolveModel;

    const packageRoot = dirname(require.resolve("mastracode/package.json"));
    const moduleUrl = await findMastraCodeResolveModelModuleUrl(packageRoot);
    if (!moduleUrl) {
      throw new Error("MastraCode model resolver is unavailable in the installed package.");
    }

    const modelModule = (await import(moduleUrl)) as {
      resolveModel?: MastraCodeModelResolver;
    };
    if (!modelModule.resolveModel) {
      throw new Error(`MastraCode model resolver is unavailable from ${moduleUrl}.`);
    }
    return modelModule.resolveModel;
  })();

  return resolverTask;
}

export async function findMastraCodeResolveModelModuleUrl(
  packageRoot: string,
): Promise<string | undefined> {
  const legacyModulePath = join(packageRoot, "dist", "agents", "model.js");
  if (await fileExists(legacyModulePath)) return pathToFileURL(legacyModulePath).href;

  const distPath = join(packageRoot, "dist");
  const entries = await readdir(distPath, { withFileTypes: true });
  const bundleFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => join(distPath, entry.name))
    .sort();

  for (const bundleFile of bundleFiles) {
    const source = await readFile(bundleFile, "utf-8");
    if (/export\s*\{[\s\S]*\bresolveModel\b[\s\S]*\}/.test(source)) {
      return pathToFileURL(bundleFile).href;
    }
  }

  return undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
