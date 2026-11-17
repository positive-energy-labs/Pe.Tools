/**
 * Where a document parse is kept (ADR 0037 rule 6; ADR 0038 guard 3): once, write-once, in the
 * derived store of the project the source sits in, keyed by the source bytes and the parser's
 * identity. A second person on the project finds it and parses nothing. Pea's `read_document`
 * never uploads: it reads a kept parse or holds the send, and the person's Confirm
 * (`sendHeldParse`, run by the host) sends exactly the held bytes and keeps the result here.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { derivedFor } from "@pe/host-contracts/service-identity";
import {
  derivedKey,
  refuseDerived,
  readDerivedIn,
  sha256Hex,
  writeDerivedIn,
  type DerivedDir,
} from "@pe/host-contracts/kinds";
import { runtimeRoot } from "@pe/runtime/runtime-owner";
import { LLAMA_TIER, parseWithLlamaCloud } from "./llama-parse.ts";
import { requireLlamaCloudKey } from "./llama-key.ts";

export const parsedPagesSchema = z.strictObject({
  /** Pages in the whole document; null when the parser does not say. */
  totalPages: z.number().nullable(),
  pages: z.array(z.strictObject({ pageNum: z.number(), text: z.string() })),
});
export type ParsedPages = z.infer<typeof parsedPagesSchema>;

export const sha256Of = sha256Hex;

/** The derived store of the project home `file` (or the first of `near`) sits in; else this machine's. */
export const parseStore = (...near: string[]): DerivedDir => derivedFor(runtimeRoot(), ...near);

/**
 * A hosted parse's identity. The tier and the pages are part of what was derived, so they are part
 * of the key. Bump the trailing revision when the kept shape or the request changes.
 */
export const llamaParser = (pages: string) => `llamaparse/${LLAMA_TIER}/markdown/1/${pages}`;

/** A derived JSON file; one that does not decode is discarded with a notice and reads as absent (ADR 0039). */
export function readDerivedJson<T>(store: DerivedDir, key: string, schema: z.ZodType<T>): T | null {
  const found = readDerivedIn(store, key);
  if (!found) return null;
  try {
    return schema.parse(JSON.parse(Buffer.from(found.bytes).toString("utf8")));
  } catch (error) {
    refuseDerived(store, found, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * The person confirmed a held send: upload exactly the bytes Pea asked about and keep the pages.
 * A file that changed since is not sent; the key is read here, in the host, and never returned.
 */
export async function sendHeldParse(
  send: { path: string; sha256: string; pages: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const bytes = await fs.readFile(send.path);
  if (sha256Of(bytes) !== send.sha256)
    throw new Error(
      `${send.path} changed since Pea asked to send it, so nothing was sent. Pea's next read holds the new bytes.`,
    );
  // A parse someone on the project already paid for is not sent again.
  const store = parseStore(send.path);
  const key = derivedKey(bytes, llamaParser(send.pages));
  if (readDerivedJson(store, key, parsedPagesSchema)) return;
  let apiKey: string;
  try {
    apiKey = requireLlamaCloudKey(env);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}, so nothing was sent.`);
  }
  // From the upload on, the bytes may have left; a failure must not let the row say "not sent".
  try {
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
    const kept: ParsedPages = {
      totalPages: null,
      pages: (result.markdown?.pages ?? []).map((page) => ({
        pageNum: page.page_number,
        text: "markdown" in page ? page.markdown : "",
      })),
    };
    writeDerivedIn(store, key, JSON.stringify(kept));
  } catch (error) {
    throw new Error(`The file may have reached LlamaCloud: ${error instanceof Error ? error.message : String(error)}`);
  }
}
