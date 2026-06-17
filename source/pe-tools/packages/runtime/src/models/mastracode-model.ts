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

let resolverTask: Promise<MastraCodeModelResolver> | undefined;

interface MastraCodeResolverRuntimeConfig {
  cwd?: string;
  disableHooks?: boolean;
  disableMcp?: boolean;
}

type MastraCodeModule = {
  createMastraCode?: (config?: MastraCodeResolverRuntimeConfig) => Promise<{
    resolveModel?: MastraCodeModelResolver;
  }>;
  resolveModel?: MastraCodeModelResolver;
};

export async function resolveMastraCodeModel(
  modelId: string,
  options?: MastraCodeModelResolveOptions,
): Promise<MastraModelConfig> {
  const resolveModel = await loadMastraCodeModelResolver(options);
  return resolveModel(modelId, options);
}

async function loadMastraCodeModelResolver(
  options?: MastraCodeModelResolveOptions,
): Promise<MastraCodeModelResolver> {
  resolverTask ??= (async () => {
    const rootModule = (await import("mastracode")) as MastraCodeModule;
    if (rootModule.resolveModel) return rootModule.resolveModel;

    if (!rootModule.createMastraCode) {
      throw new Error("MastraCode model resolver is unavailable from the public package API.");
    }

    const runtime = await rootModule.createMastraCode({
      cwd: resolveMastraCodeRuntimeCwd(options?.requestContext),
      disableHooks: true,
      disableMcp: true,
    });
    if (!runtime.resolveModel) {
      throw new Error("MastraCode runtime did not expose a model resolver.");
    }
    return runtime.resolveModel;
  })();

  return resolverTask;
}

function resolveMastraCodeRuntimeCwd(requestContext: RequestContext | undefined): string {
  const harness = requestContext?.get("harness") as
    | { getState?: () => Record<string, unknown> }
    | undefined;
  const state = harness?.getState?.();
  for (const key of ["productHomePath", "projectPath", "workspaceRoot", "cwd"]) {
    const value = state?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return process.cwd();
}
