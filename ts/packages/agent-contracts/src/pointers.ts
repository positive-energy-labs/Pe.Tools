/*
 * Pointers is the shell list per thread (ADR 0030 rule 10), "Pea is pointing at", kept until dismissed.
 * The thread stores it and the route owns its highlight; it has no journal (ADR 0035 rule 9). A
 * Pointer highlights; it never writes the page's selection, its attention fields or the camera.
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
