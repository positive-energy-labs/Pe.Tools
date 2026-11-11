import { findingCommand } from "./findings/index.ts";

/**
 * The commands the kernel adds to every route with Work, keyed by command id (ADR 0035 rule 9: the
 * person's `finding`, which reaches the document's findings Work through that route's Work handle).
 * The mount merges them; `route()`, the Pod surface, never does, because each contract is the catalog.
 */
export const kernelCommands = { finding: findingCommand } as const;
