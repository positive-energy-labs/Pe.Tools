/**
 * Where a hosted parse is kept, keyed by the bytes it read (ADR 0038 guard 3). Pea's
 * `read_document` never uploads: it reads a kept parse or holds the send. The person's Confirm
 * (`sendHeldParse`, run by the host) sends exactly the held bytes and keeps the result here, so
 * Pea's next read of the same file and pages finds it.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { stateTree } from "@pe/host-contracts/service-identity";
import { readStored, storedNoticesFile, writeAtomic } from "@pe/host-contracts/store";
import { runtimeRoot } from "@pe/runtime/runtime-owner";
import { LLAMA_TIER, parseWithLlamaCloud, requireLlamaCloudKey } from "./llama-parse.ts";

const keptParseSchema = z.strictObject({
  tier: z.string(),
  pages: z.array(z.strictObject({ pageNum: z.number(), text: z.string() })),
});
export type KeptParse = z.infer<typeof keptParseSchema>;

export const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/**
 * Under `state\Parses`, the tree an MSI upgrade keeps: a purged scratch would lose a send the person
 * paid for. `pages` is free text, so the file name carries its hash.
 */
const keptPath = (sha256: string, pages: string) =>
  path.join(
    stateTree(runtimeRoot()).parses,
    "llamaparse",
    `${sha256}-${sha256Of(Buffer.from(pages)).slice(0, 8)}.json`,
  );

/** A kept parse is derived (ADR 0039): one that does not decode is discarded with a notice and reads as absent. */
export function keptParse(sha256: string, pages: string): KeptParse | null {
  const read = readStored(keptPath(sha256, pages), keptParseSchema, {
    class: "discard",
    place: "Kept hosted parse",
    notices: storedNoticesFile(runtimeRoot()),
    blobRoot: stateTree(runtimeRoot()).blobs,
  });
  return read.kind === "ok" ? read.value : null;
}

/**
 * The person confirmed a held send: upload exactly the bytes Pea asked about and keep the pages.
 * A file that changed since is not sent; the key is read here, in the host, and never returned.
 */
export async function sendHeldParse(
  send: { path: string; sha256: string; pages: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const apiKey = requireLlamaCloudKey(env);
  const bytes = await fs.readFile(send.path);
  if (sha256Of(bytes) !== send.sha256)
    throw new Error(
      `${send.path} changed since Pea asked to send it, so nothing was sent. Pea's next read holds the new bytes.`,
    );
  const result = await parseWithLlamaCloud({
    sender: "person",
    file: new File([new Uint8Array(bytes)], path.basename(send.path), {
      type: path.extname(send.path).toLowerCase() === ".pdf" ? "application/pdf" : "",
    }),
    apiKey,
    targetPages: send.pages,
    // Markdown, not text: agentic_plus marks a struck cell <s> in its HTML tables; its text mode drops the strike.
    expand: ["markdown"],
  });
  const kept: KeptParse = {
    tier: LLAMA_TIER,
    pages: (result.markdown?.pages ?? []).map((page) => ({
      pageNum: page.page_number,
      text: "markdown" in page ? page.markdown : "",
    })),
  };
  writeAtomic(keptPath(send.sha256, send.pages), JSON.stringify(kept));
}
