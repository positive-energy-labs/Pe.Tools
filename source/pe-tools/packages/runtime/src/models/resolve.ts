import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { MastraModelConfig } from "@mastra/core/llm";
import type { RequestContext } from "@mastra/core/request-context";

/**
 * Resolve a `provider/model` id through MastraCode's gateway so a logged-in operator's Codex/
 * Anthropic OAuth is honored, with stored/env API keys as the automatic fallback (OAuth main slot →
 * `apikey:` slot → env var). This is what gives Pea BYO-OAuth inference instead of forcing an API
 * key or a (nonexistent) Pea Cloud gateway.
 *
 * MastraCode exposes its resolver only via `createMastraCode().resolveModel` (see
 * MASTRA_UPSTREAM_CANDIDATES.md — a public root `resolveModel`/gateway export would delete this
 * whole boot). `resolveModel` itself only reads the global `auth.json`, but `createMastraCode` also
 * does workspace + thread-lock work keyed on `cwd`. So we boot ONE cached runtime pointed at a
 * throwaway temp dir, purely to borrow the resolver: its session is never used, its locks never
 * touch the Pea product thread, and heartbeats are disabled so it makes no background gateway calls.
 *
 * ponytail: leaks one idle runtime for the process lifetime (MastraCode has no public dispose).
 * Acceptable for a cached singleton; deletes entirely if MastraCode ever roots `resolveModel`.
 */
type MastraCodeModelResolver = (
  modelId: string,
  options?: { requestContext?: RequestContext },
) => MastraModelConfig;

let resolverTask: Promise<MastraCodeModelResolver> | undefined;

function loadMastraCodeModelResolver(): Promise<MastraCodeModelResolver> {
  resolverTask ??= (async () => {
    const { createMastraCode } = await import("mastracode");
    const cwd = mkdtempSync(path.join(tmpdir(), "pea-model-resolver-"));
    const runtime = await createMastraCode({
      cwd,
      disableHooks: true,
      disableMcp: true,
      intervalHandlers: [],
    });
    return runtime.resolveModel as MastraCodeModelResolver;
  })();
  return resolverTask;
}

/** Resolve a single model id (used by a mode agent's explicit `model` fn). */
export async function resolveRuntimeModel(
  modelId: string,
  requestContext?: RequestContext,
): Promise<MastraModelConfig> {
  const resolve = await loadMastraCodeModelResolver();
  return resolve(modelId, requestContext ? { requestContext } : undefined);
}
