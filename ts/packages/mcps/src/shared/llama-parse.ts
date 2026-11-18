/** Direct hosted parsing; ADR 0052 removes the outward hold. */
export const LLAMA_CLOUD_KEY_VAR = "LLAMA_CLOUD_API_KEY";

/**
 * LlamaParse runs at agentic_plus only (kaitpw, 2026-11-11). On a struck ASI 7 schedule, agentic markdown invented
 * cells on every row and agentic text carried strikes only by accident; our documents are all that hard or harder,
 * so a cheaper tier is not an option. Agent ledger, 2026-11-11 Decided line.
 */
export const LLAMA_TIER = "agentic_plus";

interface LlamaParseWork {
  file: File;
  /** Comma-separated 1-based pages, "1-5" or "2,7-9" (LlamaParse `page_ranges.target_pages`). Omit for every page. */
  targetPages?: string;
  /** Result sections to return; the SDK refuses an empty list. */
  expand: string[];
  /** Extracted images to keep, e.g. ["screenshot", "embedded", "layout"]. */
  imagesToSave?: Array<"screenshot" | "embedded" | "layout">;
}
/** Credentials stay inside the parser call. */
export type LlamaParseRequest = LlamaParseWork & { sender: "person" | "pea"; apiKey: string };

type LlamaCloudClient = InstanceType<(typeof import("@llamaindex/llama-cloud"))["default"]>;
export type LlamaParseResult = Awaited<ReturnType<LlamaCloudClient["parsing"]["parse"]>>;

/** Upload and return the finished job. The key is never logged or put in a message. */
export async function parseWithLlamaCloud(request: LlamaParseRequest): Promise<LlamaParseResult> {
  // Dynamic import keeps the SDK out of the client bundle and out of hosts that never parse.
  const { default: LlamaCloud } = await import("@llamaindex/llama-cloud");
  // No automatic upload retry: the bytes may already have arrived.
  const client = new LlamaCloud({ apiKey: request.apiKey });
  const job = await client.parsing.create(
    {
      tier: LLAMA_TIER,
      version: "latest",
      upload_file: request.file,
      ...(request.targetPages ? { page_ranges: { target_pages: request.targetPages } } : {}),
      ...(request.imagesToSave ? { output_options: { images_to_save: request.imagesToSave } } : {}),
    },
    { maxRetries: 0 },
  );
  const { note, sha256Hex } = await import("@pe/host-contracts/kinds");
  const { stateTree } = await import("@pe/host-contracts/service-identity");
  const { runtimeRoot } = await import("@pe/runtime/runtime-owner");
  // The upload succeeded even when polling later fails; notice the send at this crossing.
  note(stateTree(runtimeRoot()), { class: "sent", place: "LlamaCloud", path: request.file.name,
    sha256: sha256Hex(job.id), reason: `Sent ${request.file.name} to LlamaCloud (${request.targetPages ?? "all pages"}).` });
  const result = await client.parsing.waitForCompletion(
    job.id,
    { expand: request.expand },
    { timeout: 10 * 60 }, // seconds: the SDK poll deadline (core/polling.js), not milliseconds
  );
  if (result.job.status !== "COMPLETED") {
    throw new Error(result.job.error_message ?? `Parse job ${result.job.status}`);
  }
  return result;
}
