/*
 * Step 3 frozen contract (ADR 0030 rule 10). TEMPORARY SCAFFOLD: types only, nothing reads them yet.
 * Pointers is a shell list per thread, "Pea is pointing at", kept until dismissed. A Pointer
 * highlights; it never writes the page's selection, its attention fields or the camera.
 */

/** One thing Pea points at: a route place in the route's own attention codec text. */
export interface Pointer {
  /** Stable within its thread; dismiss names it. */
  id: string;
  route: string;
  /** Attention field key to codec text, exactly what `Attention.write` produces for that place. */
  place: Readonly<Record<string, string>>;
  /** The person's words for what is pointed at. */
  label: string;
  at: string;
}

/** The thread's list, newest last. Dismissal removes one entry; nothing expires it. */
export interface Pointers {
  threadId: string;
  pointers: readonly Pointer[];
}
