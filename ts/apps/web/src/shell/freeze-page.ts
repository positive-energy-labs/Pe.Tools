/** Clone before freezing, so callers retain ownership of their inputs. Page values are data. */
export function freezePage<T>(value: T): T {
  const clone: T = structuredClone(value);
  const freeze = (part: unknown): void => {
    if (part && typeof part === "object" && !Object.isFrozen(part)) {
      for (const child of Object.values(part)) freeze(child);
      Object.freeze(part);
    }
  };
  freeze(clone);
  return clone;
}
