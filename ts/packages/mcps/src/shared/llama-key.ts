/**
 * The node-only half of a hosted parse: the key lookup and the send notice. `llama-parse.ts` holds
 * no node-only import, so nothing that reaches it reaches the key resolver or the notice store
 * (host-build-boundary guard). No web module imports it since the web parse route was deleted.
 */
import { note, sha256Hex } from "@pe/host-contracts/kinds";
import { keyRefusalText, resolveKey } from "@pe/host-contracts/shared-keys";
import { stateTree } from "@pe/host-contracts/service-identity";
import { runtimeRoot } from "@pe/runtime/runtime-owner";
import { LLAMA_CLOUD_KEY_VAR, type LlamaSend } from "./llama-parse.ts";

/**
 * The one notice a hosted send leaves (ADR 0052): the file's name, the service and the pages, in
 * the machine state the caller names. The host names its own `hostState()`, the root its notice
 * feed reads, computed once. A Pea tool process has no such value and names `runtimeMachine()`:
 * the same `productRoot` of the same owner, under the `PE_TOOLS_PRODUCT_HOME` the host hands the
 * process it spawns (`apps/host/src/harness/adapter.ts`).
 */
export const noteLlamaSend =
  (machine: Parameters<typeof note>[0]) =>
  ({ jobId, fileName, pages }: LlamaSend): void =>
    note(machine, {
      class: "sent",
      place: "LlamaCloud",
      path: fileName,
      sha256: sha256Hex(jobId),
      reason: `Sent ${fileName} to LlamaCloud (${pages}).`,
    });
/** This runtime's machine state, for a caller that is not the host. */
export const runtimeMachine = () => stateTree(runtimeRoot());

/**
 * The person's own `LLAMA_CLOUD_API_KEY`, else the firm keys.json `llamaparse.api-key` (ADR 0037
 * rule 9), else a refusal that says where it looked and never quotes a key. The machine state root
 * is read only when no own key is set.
 */
export function requireLlamaCloudKey(env: NodeJS.ProcessEnv = process.env): string {
  const own = env[LLAMA_CLOUD_KEY_VAR];
  if (own?.trim()) return own.trim();
  const key = resolveKey(null, "llamaparse.api-key", runtimeMachine());
  if ("refused" in key)
    throw new Error(
      `${keyRefusalText(key.refused, "llamaparse.api-key")} ${LLAMA_CLOUD_KEY_VAR} is not set in the host environment either.`,
    );
  return key.value;
}
