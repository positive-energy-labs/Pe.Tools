import { designSystemGraph } from "#/design-system/graph";
export { designSystemGraph } from "#/design-system/graph";
import { mountRoute } from "#/shell/mount";
import { createFileRoute, Link } from "@tanstack/react-router";

import { FactChip } from "@pe/kit/lang/chip";
import { DesignSystemLaws, LAW_POINTERS } from "#/design-system/laws";
import { DesignSystemSpecimens } from "#/design-system/specimens/index";
import { ThesisSpecimen } from "#/design-system/specimens/thesis";

const RouteShelledDesignSystem = mountRoute(designSystemGraph, {
  initialPage: {},
  sources: { catalog: { kind: "derive", derive: () => ({ id: "builtin", laws: LAW_POINTERS }) } },
  bodies: { main: () => <DesignSystem /> },
  furniture: {
    main: () => ({
      meta: (
        <FactChip title="Rulings with one surviving authority">{LAW_POINTERS.length} laws</FactChip>
      ),
    }),
  },
});
export const Route = createFileRoute("/design-system")({ component: RouteShelledDesignSystem });

function DesignSystem() {
  return (
    <div className="min-h-screen t-prose text-ink">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-16 px-6 py-10">
        <ThesisSpecimen />
        <DesignSystemLaws />
        <DesignSystemSpecimens />
        <p className="t-small face-mono text-ink-mute">
          exhaustive component variants live at <Link to="/design-system/swatch">the swatch</Link>
        </p>
      </main>
    </div>
  );
}
