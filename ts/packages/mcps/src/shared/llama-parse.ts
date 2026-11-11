/** LlamaParse (LlamaCloud) is called from exactly one place: the web doc lab and `read_document` both come through here. */

export const LLAMA_CLOUD_KEY_VAR = "LLAMA_CLOUD_API_KEY";

/**
 * LlamaParse runs at agentic_plus only (kaitpw, 2026-11-11). On a struck ASI 7 schedule, agentic markdown invented
 * cells on every row and agentic text carried strikes only by accident; our documents are all that hard or harder,
 * so a cheaper tier is not an option. Agent ledger, 2026-11-11 Decided line.
 */
export const LLAMA_TIER = "agentic_plus";

export function requireLlamaCloudKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env[LLAMA_CLOUD_KEY_VAR];
  if (!key) throw new Error(`${LLAMA_CLOUD_KEY_VAR} is not set in the host environment.`);
  return key;
}

export interface LlamaParseRequest {
  file: File;
  apiKey: string;
  /** Comma-separated 1-based pages, "1-5" or "2,7-9" (LlamaParse `page_ranges.target_pages`). Omit for every page. */
  targetPages?: string;
  /** Result sections to return; the SDK refuses an empty list. */
  expand: string[];
  /** Extracted images to keep, e.g. ["screenshot", "embedded", "layout"]. */
  imagesToSave?: Array<"screenshot" | "embedded" | "layout">;
}

/**
 * Upload, poll and return the finished job. A FAILED or CANCELLED job throws from the SDK;
 * a job that ends any other way than COMPLETED throws here. The key is never logged or put in a message.
 */
export async function parseWithLlamaCloud(request: LlamaParseRequest) {
  // Dynamic import keeps the SDK out of the client bundle and out of hosts that never parse.
  const { default: LlamaCloud } = await import("@llamaindex/llama-cloud");
  const client = new LlamaCloud({ apiKey: request.apiKey });
  const result = await client.parsing.parse(
    {
      tier: LLAMA_TIER,
      version: "latest",
      upload_file: request.file,
      expand: request.expand,
      ...(request.targetPages ? { page_ranges: { target_pages: request.targetPages } } : {}),
      ...(request.imagesToSave ? { output_options: { images_to_save: request.imagesToSave } } : {}),
    },
    { timeout: 10 * 60_000 },
  );
  if (result.job.status !== "COMPLETED") {
    throw new Error(result.job.error_message ?? `Parse job ${result.job.status}`);
  }
  return result;
}
