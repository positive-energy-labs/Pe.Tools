import { placeInput } from "./typed-place.test-support";
import { createElement, useMemo } from "react";
import { AdmittedPlaceBoundary, AdmittedPlacePane, type AdmittedPaneProps } from "./admitted-pane";

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
