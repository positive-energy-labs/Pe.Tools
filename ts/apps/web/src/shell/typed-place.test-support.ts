import type { AdmittedAddressPort } from "./typed-address";
import type { PlaceInput } from "./typed-place";
import { fixtureName } from "./fixture-name";
export function placeInput(
  address: AdmittedAddressPort,
  overrides: Partial<PlaceInput> = {},
): PlaceInput {
  const target = overrides.target === undefined ? { kind: "host" as const } : overrides.target;
  return {
    address,
    fixture: fixtureName(Object.fromEntries(address.read())),
    target,
    work: { address: null, open: target?.kind === "document" ? target.ref : null },
    custody: { current: () => true },
    memory: () => ({}),
    ...overrides,
  };
}
