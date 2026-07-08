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
 * MastraCode still exposes no public root `resolveModel` export (verified against `mastracode@0.30.0`
 * — see MASTRA_UPSTREAM_CANDIDATES.md; a public resolver/gateway export would delete this whole boot).
 * But 0.30's `createMastraCodeAgentController` builds the providers/gateways/agent and hands back
 * `resolveModel` on an INERT controller: it never calls `init()`, mints no session, and takes no
 * thread lock (unlike `createMastraCode` = `bootLocalAgentController`, which does all three). We build
 * one cached inert controller pointed at a throwaway temp dir, purely to borrow the resolver, with
 * hooks/MCP/intervals disabled so it makes no background gateway calls.
 *
 * ponytail: still leaks one inert controller for the process lifetime (MastraCode has no public
 * dispose), but no session/lock/init overhead. Deletes entirely if MastraCode ever roots `resolveModel`.
 */
type MastraCodeModelResolver = (
  modelId: string,
  options?: { requestContext?: RequestContext },
) => MastraModelConfig;

let resolverTask: Promise<MastraCodeModelResolver> | undefined;

function loadMastraCodeModelResolver(): Promise<MastraCodeModelResolver> {
  resolverTask ??= (async () => {
    const { createMastraCodeAgentController } = await import("mastracode");
    const cwd = mkdtempSync(path.join(tmpdir(), "pea-model-resolver-"));
    const inert = await createMastraCodeAgentController({
      cwd,
      disableHooks: true,
      disableMcp: true,
      intervalHandlers: [],
    });
    return inert.resolveModel as MastraCodeModelResolver;
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
