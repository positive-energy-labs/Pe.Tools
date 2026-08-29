import { Link } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/lang/theme-toggle";
import { FactChip } from "#/components/lang/chip";

import { LangCellSpecimens } from "./lang-cells";
import { LangStatusSpecimens } from "./lang-status";
import { LangVerbSpecimens } from "./lang-verbs";
import { LangWorkflowSpecimens } from "./lang-workflow";
import { UiInputSpecimens } from "./ui-inputs";
import { UiLayoutSpecimens } from "./ui-layout";
import { UiSurfaceSpecimens } from "./ui-surfaces";

export function SwatchSpecimens() {
  return (
    <div className="min-h-screen">
      <header className="sticky z-sticky">
        <div className="flex items-center justify-between py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <Link to="/design-system">← design system</Link>
            <span>swatch</span>
            <span>every component · every variant · every state · the import path</span>
            <FactChip dashed title="Every specimen uses fixture data.">
              fixture
            </FactChip>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-col gap-8 pt-6 pb-24">
        <div className="flex flex-col gap-2">
          <p>The swatch.</p>
          <p>
            A lookup table, not a spec. Each recipe grid reads the shipping variant vocabulary, and
            each frame names the import path and its current static-import census.
          </p>
          <p>lang · the design language primitives</p>
        </div>
        <LangWorkflowSpecimens />
        <LangCellSpecimens />
        <LangStatusSpecimens />
        <LangVerbSpecimens />
        <p>ui · the surviving application component layer</p>
        <UiInputSpecimens />
        <UiSurfaceSpecimens />
        <UiLayoutSpecimens />
      </main>
    </div>
  );
}
