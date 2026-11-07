import { createElement, useMemo } from "react";
import type { AdmittedAddressPort } from "./typed-address";
import type { PlaceInput } from "./typed-place";
import { AdmittedPlaceBoundary, AdmittedPlacePane, type AdmittedPaneProps } from "./admitted-pane";
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

export function AdmittedPane({ address, ...props }: AdmittedPaneProps) {
  return createElement(AdmittedPlaceBoundary, {
    route: props.route,
    address,
    children: (place) => createElement(TestPlacePane, { ...props, place }),
  });
}
function TestPlacePane({
  place,
  ...props
}: Omit<AdmittedPaneProps, "address"> & {
  place: import("./admitted-pane").PanePlace;
}) {
  const input = useMemo(
    () =>
      placeInput(place.address, {
        fixture: place.fixture,
        custody: place,
        memory: place.memory,
      }),
    [place],
  );
  return createElement(AdmittedPlacePane, { ...props, place, input });
}
