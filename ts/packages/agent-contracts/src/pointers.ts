import { findingInputSchema, type FindingInput } from "./slots/findings.ts";

/*
 * Pointers is the shell list per thread (ADR 0030 rule 10), "Pea is pointing at", kept until dismissed.
 * The thread stores it and the route owns its highlight; it has no journal (ADR 0035 rule 9). A
 * Pointer highlights; it never writes the page's selection, its attention fields or the camera.
 * Keeping one (`keepPointer`) turns it into a finding, which `findings.write` lands.
 */

/**
 * Where a pointer points: a SubjectRef code (text off the wire; decoded where it is used), or a
 * route place in the route's own attention codec text.
 */
export type PointerTarget = string | Readonly<Record<string, string>>;

/** One thing Pea points at. */
export interface Pointer {
  /** Stable within its thread; dismiss names it. */
  id: string;
  route: string;
  /** A SubjectRef code, or attention field key to codec text, exactly what `Attention.write` produces for that place. */
  target: PointerTarget;
  /** The person's words for what is pointed at. */
  label: string;
  at: string;
}

/** The thread's list, newest last. Dismissal removes one entry; nothing expires it. */
export interface Pointers {
  threadId: string;
  pointers: readonly Pointer[];
}

/** The keep verb: a pointer on a subject becomes the finding `findings.write` takes. A place names no subject to keep. */
export function keepPointer(
  pointer: Pointer,
  as: Pick<FindingInput, "kind" | "verdict"> & { readonly text?: string },
): FindingInput {
  if (typeof pointer.target !== "string") throw Error("Only a pointer on a subject can be kept as a finding");
  return findingInputSchema.parse({
    id: pointer.id,
    subject: pointer.target,
    kind: as.kind,
    text: as.text ?? pointer.label,
    place: {},
    ...(as.verdict === undefined ? {} : { verdict: as.verdict }),
  });
}
