/**
 * The node-only half of a hosted parse: the key lookup and the send notice. Apart from
 * `llama-parse.ts` so the web build (which imports that module for the web parser route) never
 * reaches the key resolver or the notice store (host-build-boundary guard).
 */
import { note, sha256Hex } from "@pe/host-contracts/kinds";
import { keyRefusalText, resolveKey } from "@pe/host-contracts/shared-keys";
import { stateTree } from "@pe/host-contracts/service-identity";
import { runtimeRoot } from "@pe/runtime/runtime-owner";
import { LLAMA_CLOUD_KEY_VAR, type LlamaSend } from "./llama-parse.ts";

/**
 * The one notice a hosted send leaves (ADR 0052): the file's name, the service and the pages. It is
 * written to this runtime's machine state, which is the root the host reads: `runtimeRoot` and the
 * host's `hostOwnership.rootPath` are both `productRoot` of the same owner, and the host hands its
 * `PE_TOOLS_PRODUCT_HOME` to the Pea tool process it spawns (`harness/adapter.ts`).
 */
export const noteLlamaSend = ({ jobId, fileName, pages }: LlamaSend): void =>
  note(stateTree(runtimeRoot()), {
    class: "sent",
    place: "LlamaCloud",
    path: fileName,
    sha256: sha256Hex(jobId),
    reason: `Sent ${fileName} to LlamaCloud (${pages}).`,
  });

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
