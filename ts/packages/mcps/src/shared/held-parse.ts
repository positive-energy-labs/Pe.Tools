/**
 * Where a hosted parse is kept, keyed by the bytes it read (ADR 0038 guard 3). Pea's
 * `read_document` never uploads: it reads a kept parse or holds the send. The person's Confirm
 * (`sendHeldParse`, run by the host) sends exactly the held bytes and keeps the result here, so
 * Pea's next read of the same file and pages finds it.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { productScratchPath } from "@pe/host-contracts/service-identity";
import { runtimeRoot } from "@pe/runtime/runtime-owner";
import { LLAMA_TIER, parseWithLlamaCloud, requireLlamaCloudKey } from "./llama-parse.ts";

export interface KeptParse {
  tier: string;
  pages: Array<{ pageNum: number; text: string }>;
}

export const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const keptPath = (sha256: string, pages: string) =>
  path.join(
    productScratchPath(runtimeRoot()),
    "read-document",
    "llamaparse",
    `${sha256}-${sha256Of(Buffer.from(pages)).slice(0, 8)}.json`,
  );

export async function keptParse(sha256: string, pages: string): Promise<KeptParse | null> {
  const text = await fs.readFile(keptPath(sha256, pages), "utf8").catch(() => null);
  return text === null ? null : (JSON.parse(text) as KeptParse);
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
  const file = keptPath(send.sha256, send.pages);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(kept));
}
