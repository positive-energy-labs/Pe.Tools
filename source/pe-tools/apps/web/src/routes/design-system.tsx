import { createFileRoute, Link } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/lang/theme-toggle";
import { AddressingBar } from "#/components/lang/addressing-bar";
import { FactChip } from "#/components/lang/chip";
import { Provenance, Section } from "#/components/lang/section";
import { DesignSystemLaws, LAW_POINTERS } from "#/design-system/laws";
import { DesignSystemSpecimens } from "#/design-system/specimens/index";

export const Route = createFileRoute("/design-system")({ component: DesignSystem });

function DesignSystem() {
  return (
    <div className="min-h-screen">
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
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-6 py-8">
        <Section label="index">
          <p>Pea proposes; you decide; the model may disagree.</p>
          <Provenance>
            The <Link to="/design-system/swatch">swatch</Link> owns rendered variants. This route
            names each law&apos;s code owner and mounts integration specimens only.
          </Provenance>
        </Section>
        <DesignSystemLaws />
        <DesignSystemSpecimens />
      </main>
    </div>
  );
}
