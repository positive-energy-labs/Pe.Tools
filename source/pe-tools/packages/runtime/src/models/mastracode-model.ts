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

type MastraCodeRuntime = Awaited<ReturnType<typeof import("mastracode").createMastraCode>>;

// ponytail: one resolver runtime is enough until per-workspace model settings need isolation.
let runtimeTask: Promise<MastraCodeRuntime> | undefined;

export async function resolveMastraCodeModel(
  modelId: string,
  options?: MastraCodeModelResolveOptions,
): Promise<MastraModelConfig> {
  const runtime = await loadMastraCodeRuntime(options);
  return runtime.resolveModel(modelId, options);
}

async function loadMastraCodeRuntime(
  options?: MastraCodeModelResolveOptions,
): Promise<MastraCodeRuntime> {
  runtimeTask ??= (async () => {
    const { createMastraCode } = await import("mastracode");
    return createMastraCode({
      cwd: resolveMastraCodeRuntimeCwd(options?.requestContext),
      disableHooks: true,
      disableMcp: true,
    });
  })();

  return runtimeTask;
}

function resolveMastraCodeRuntimeCwd(requestContext: RequestContext | undefined): string {
  const harness = readRecord(requestContext?.get("harness"));
  const session = readRecord(harness.session);
  const stateAccess = readRecord(session.state);
  const getState = stateAccess.get;
  const state =
    typeof getState === "function"
      ? readRecord(getState.call(stateAccess))
      : readRecord(harness.state);
  for (const key of ["productHomePath", "projectPath", "workspaceRoot", "cwd"]) {
    const value = state[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return process.cwd();
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
