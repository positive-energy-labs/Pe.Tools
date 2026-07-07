/**
 * Server-process cache of LlamaParse results keyed by jobId, so any tab (and
 * pea's tools, over HTTP) can fetch the full grounded view — bboxes and page
 * screenshots — after a parse ran anywhere. ponytail: in-memory, last 8 parses,
 * dies with the dev server; persist to disk if parses ever need to outlive it.
 */
import type { ParsedDocView } from "#/grounded-doc/types";

const MAX_ENTRIES = 8;
const cache = new Map<string, ParsedDocView>();

export function putParsedDoc(view: ParsedDocView): void {
  cache.delete(view.jobId);
  cache.set(view.jobId, view);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    cache.delete(oldest);
  }
}

export function getParsedDoc(jobId: string): ParsedDocView | undefined {
  return cache.get(jobId);
}
