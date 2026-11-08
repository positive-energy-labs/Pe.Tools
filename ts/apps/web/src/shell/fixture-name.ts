/** Presence isolates every route; an unknown or empty name never falls through to the host. */
export const fixtureName = (search: Record<string, unknown>): string | null =>
  typeof search.fixture === "string" ? search.fixture : null;
export const currentFixture = () =>
  typeof location === "undefined"
    ? null
    : fixtureName(Object.fromEntries(new URLSearchParams(location.search)));
