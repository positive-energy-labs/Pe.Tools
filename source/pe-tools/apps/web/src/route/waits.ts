/**
 * How long a read or a verb may stay unanswered before it ends honestly as "no answer after Ns"
 * (a timeout is a diagnostic boundary, never a retry). One home, read by route verbs and host reads.
 */
/** A host read (a catalog, a snapshot): an answer this late means something is stuck. */
export const HOST_READ_WAIT_S = 15;
/** A plan, a capture or a matrix: a native read of a document, bounded but slower. */
export const NATIVE_READ_WAIT_S = 120;
/** A native apply writes a model and may legitimately run for minutes. */
export const NATIVE_APPLY_WAIT_S = 600;
/** Any verb that names no wait of its own. */
export const DEFAULT_WAIT_S = 120;
