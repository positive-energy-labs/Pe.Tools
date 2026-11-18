/**
 * The LlamaParse key lookup, apart from `llama-parse.ts` so the web build (which imports that module for
 * the web parser route) never reaches the node-only key resolver (host-build-boundary guard).
 */
import { keyRefusalText, resolveKey } from "@pe/host-contracts/shared-keys";
import { stateTree } from "@pe/host-contracts/service-identity";
import { runtimeRoot } from "@pe/runtime/runtime-owner";
import { LLAMA_CLOUD_KEY_VAR } from "./llama-parse.ts";

/**
 * The person's own `LLAMA_CLOUD_API_KEY`, else the firm keys.json `llamaparse.api-key` (ADR 0037
 * rule 9), else a refusal that says where it looked and never quotes a key. The machine state root
 * is read only when no own key is set.
 */
export function requireLlamaCloudKey(env: NodeJS.ProcessEnv = process.env): string {
  const own = env[LLAMA_CLOUD_KEY_VAR];
  if (own?.trim()) return own.trim();
  const key = resolveKey(null, "llamaparse.api-key", stateTree(runtimeRoot()));
  if ("refused" in key)
    throw new Error(
      `${keyRefusalText(key.refused, "llamaparse.api-key")} ${LLAMA_CLOUD_KEY_VAR} is not set in the host environment either.`,
    );
  return key.value;
}
