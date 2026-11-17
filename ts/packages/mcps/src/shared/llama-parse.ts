/**
 * The one path that sends a file's bytes to a service other than the inference provider (ADR 0038
 * guard 3). The web doc lab, the person's Confirm on a held send and `read_document` all come
 * through `parseWithLlamaCloud`, and only a send the person originates leaves this machine.
 */
import { held, type Held } from "@pe/agent-contracts";
import {
  HOST_CONTEXT_HEADER,
  HOST_RUNTIME_SERVICE_HEADER,
  hostProcessIdentity,
} from "@pe/host-contracts/contracts";

export const LLAMA_CLOUD_KEY_VAR = "LLAMA_CLOUD_API_KEY";

/**
 * LlamaParse runs at agentic_plus only (kaitpw, 2026-11-11). On a struck ASI 7 schedule, agentic markdown invented
 * cells on every row and agentic text carried strikes only by accident; our documents are all that hard or harder,
 * so a cheaper tier is not an option. Agent ledger, 2026-11-11 Decided line.
 */
export const LLAMA_TIER = "agentic_plus";

/** Who originates a send: the person (a press in the web app, or their Confirm), or anyone else. */
export type Sender = "person" | "pea";

/**
 * Whether a request to a server that sends for the person (the doc lab's parse route) is the
 * person's own. The host is the one judge of who is asking: the request's identity (the browser's
 * HttpOnly host cookie, or a context the host minted) is replayed to `outward.person`. Anything
 * but ok, including no host to ask, is not the person.
 */
export async function isPersonRequest(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const host = env[hostProcessIdentity.hostBaseUrlVariable];
  if (!host) return false;
  const replay = new Headers();
  for (const name of ["cookie", "origin", "referer", "sec-fetch-site", HOST_CONTEXT_HEADER]) {
    const value = headers.get(name);
    if (value !== null) replay.set(name, value);
  }
  // The server speaks for the one host that started it, whatever owner the request claims.
  const service = env[hostProcessIdentity.serviceNameVariable];
  if (service) replay.set(HOST_RUNTIME_SERVICE_HEADER, service);
  try {
    const answer = await fetch(new URL("/pe/outward/person", host), { method: "POST", headers: replay });
    return answer.ok;
  } catch (error) {
    console.warn("llama-parse: the host did not answer who is asking", error);
    return false;
  }
}

interface LlamaParseWork {
  file: File;
  /** Comma-separated 1-based pages, "1-5" or "2,7-9" (LlamaParse `page_ranges.target_pages`). Omit for every page. */
  targetPages?: string;
  /** Result sections to return; the SDK refuses an empty list. */
  expand: string[];
  /** Extracted images to keep, e.g. ["screenshot", "embedded", "layout"]. */
  imagesToSave?: Array<"screenshot" | "embedded" | "layout">;
}
/** Every caller states its sender. Only the person's send carries the key; any other is held. */
export type LlamaParseRequest = LlamaParseWork &
  ({ sender: "person"; apiKey: string } | { sender: Exclude<Sender, "person"> });

type LlamaCloudClient = InstanceType<(typeof import("@llamaindex/llama-cloud"))["default"]>;
export type LlamaParseResult = Awaited<ReturnType<LlamaCloudClient["parsing"]["parse"]>>;

/**
 * Upload, poll and return the finished job, for the person. Any other sender gets "held" at once:
 * no key is read, no byte is sent and nothing waits. A FAILED or CANCELLED job throws from the SDK;
 * a job that ends any other way than COMPLETED throws here. The key is never logged or put in a message.
 */
export function parseWithLlamaCloud(
  request: Extract<LlamaParseRequest, { sender: "person" }>,
): Promise<LlamaParseResult>;
export function parseWithLlamaCloud(request: LlamaParseRequest): Promise<LlamaParseResult | Held>;
export async function parseWithLlamaCloud(
  request: LlamaParseRequest,
): Promise<LlamaParseResult | Held> {
  if (request.sender !== "person")
    return held(
      "send-outward",
      `'${request.file.name}'`,
      "It would go to LlamaCloud, the hosted document reader; the person confirms the send from its notice, and the result is then kept for the next read of the same file.",
    );
  // Dynamic import keeps the SDK out of the client bundle and out of hosts that never parse.
  const { default: LlamaCloud } = await import("@llamaindex/llama-cloud");
  // ADR 0038: one Confirm, one upload; the person retries via Confirm.
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
