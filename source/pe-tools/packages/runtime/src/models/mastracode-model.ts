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
    const rootModule = readMastraCodeModule(await import("mastracode"));
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
  const harness = readRecord(requestContext?.get("harness"));
  const getState = harness.getState;
  const state = typeof getState === "function" ? readRecord(getState.call(harness)) : {};
  for (const key of ["productHomePath", "projectPath", "workspaceRoot", "cwd"]) {
    const value = state[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return process.cwd();
}

function readMastraCodeModule(value: unknown): MastraCodeModule {
  const record = readRecord(value);
  return {
    createMastraCode: isMastraCodeRuntimeFactory(record.createMastraCode)
      ? record.createMastraCode
      : undefined,
    resolveModel: isMastraCodeModelResolver(record.resolveModel) ? record.resolveModel : undefined,
  };
}

function isMastraCodeRuntimeFactory(
  value: unknown,
): value is NonNullable<MastraCodeModule["createMastraCode"]> {
  return typeof value === "function";
}

function isMastraCodeModelResolver(value: unknown): value is MastraCodeModelResolver {
  return typeof value === "function";
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
