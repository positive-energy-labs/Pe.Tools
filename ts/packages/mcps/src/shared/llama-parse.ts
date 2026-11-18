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
/** What one upload sent: the notice a caller writes names these and nothing else (ADR 0052). */
export interface LlamaSend {
  jobId: string;
  fileName: string;
  pages: string;
}
/**
 * Credentials stay inside the parser call. `sent` runs once the upload is accepted; a node caller
 * passes `noteLlamaSend(machine)` (`llama-key.ts`). The caller names the machine state because the
 * host and a Pea tool process resolve theirs differently, and this module imports nothing node-only.
 */
export type LlamaParseRequest = LlamaParseWork & { apiKey: string; sent: (send: LlamaSend) => void };

type LlamaCloudClient = InstanceType<(typeof import("@llamaindex/llama-cloud"))["default"]>;
export type LlamaParseResult = Awaited<ReturnType<LlamaCloudClient["parsing"]["parse"]>>;

/**
 * Upload and return the finished job. The key is never logged, and a failure that quotes it (a
 * service that echoes the credential it refused) has it cut out before the message leaves here.
 */
export async function parseWithLlamaCloud(request: LlamaParseRequest): Promise<LlamaParseResult> {
  try {
    return await upload(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replaceAll(request.apiKey, "[key]"));
  }
}

async function upload(request: LlamaParseRequest): Promise<LlamaParseResult> {
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
  // The upload succeeded even when polling later fails; the send is noticed at this crossing.
  request.sent({ jobId: job.id, fileName: request.file.name, pages: request.targetPages ?? "all pages" });
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
