import { createFileRoute } from "@tanstack/react-router";

import { SwatchSpecimens } from "#/design-system/specimens/swatch";

export const Route = createFileRoute("/design-system_/swatch")({ component: Swatch });

function Swatch() {
  return <SwatchSpecimens />;
}
