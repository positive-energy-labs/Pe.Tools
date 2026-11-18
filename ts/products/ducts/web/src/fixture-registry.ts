/** Payloads load only when a fixture is requested; concurrent reads share the import. */
export function lazyFixtures<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => pending ??= load();
}
