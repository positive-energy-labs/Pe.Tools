import { RouteShell, emptyManifest } from "#/route";
import { createFileRoute, Link } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/lang/theme-toggle";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip } from "#/components/lang/chip";
import { DesignSystemLaws, LAW_POINTERS } from "#/design-system/laws";
import { DesignSystemSpecimens } from "#/design-system/specimens/index";
import { ThesisSpecimen } from "#/design-system/specimens/thesis";

/** Not cut over yet: an empty manifest is a legal manifest and the shell renders one. */
export const manifest = emptyManifest("design-system", "Design System");

function RouteShelledDesignSystem() {
  return (
    <RouteShell manifest={manifest}>
      <DesignSystem />
    </RouteShell>
  );
}

export const Route = createFileRoute("/design-system")({ component: RouteShelledDesignSystem });

function DesignSystem() {
  return (
    <div className="min-h-screen t-prose text-ink">
      <AddressingBar
        name="design system"
        sentence={<span>one language · code owns each rule once</span>}
        facts={
          <FactChip title="Rulings with one surviving authority">
            {LAW_POINTERS.length} laws
          </FactChip>
        }
        seam={<ThemeToggle />}
      />
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
