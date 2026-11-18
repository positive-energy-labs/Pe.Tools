import { z } from "zod";
import { derivedFor } from "@pe/host-contracts/service-identity";
import {
  refuseDerived,
  readDerivedIn,
  type DerivedDir,
} from "@pe/host-contracts/kinds";
import { runtimeRoot } from "@pe/runtime/runtime-owner";
import { LLAMA_TIER } from "./llama-parse.ts";

export const parsedPagesSchema = z.strictObject({
  /** Pages in the whole document; null when the parser does not say. */
  totalPages: z.number().nullable(),
  pages: z.array(z.strictObject({ pageNum: z.number(), text: z.string() })),
});
export type ParsedPages = z.infer<typeof parsedPagesSchema>;

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

