import { fixtureName } from "./fixture-name";

/** Presence, including empty/unknown names, always selects the refusing fixture implementation.
 * The legacy composition root selects the lane before drawing its bodies. */
export function selectRouteEnvironment<Live, Fixture>(options: {
  readonly search: Record<string, unknown>;
  readonly live: () => Live;
  readonly fixture: (name: string) => Fixture;
}) {
  const name = fixtureName(options.search);
  return name === null ? options.live() : options.fixture(name);
}
