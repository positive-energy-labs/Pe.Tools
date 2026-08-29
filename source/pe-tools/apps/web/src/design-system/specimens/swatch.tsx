import { Link } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/ThemeToggle";
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
            <FactChip dashed title="Every specimen uses fixture data.">
              fixture
            </FactChip>
          </div>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-col gap-8 pt-6 pb-24">
        <LangWorkflowSpecimens />
        <LangCellSpecimens />
        <LangStatusSpecimens />
        <LangVerbSpecimens />
        <UiInputSpecimens />
        <UiSurfaceSpecimens />
        <UiLayoutSpecimens />
      </main>
    </div>
  );
}
