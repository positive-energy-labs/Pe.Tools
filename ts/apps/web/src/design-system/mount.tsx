import { Link } from "@tanstack/react-router";
import { DesignSystemLaws } from "./laws";
import { DesignSystemSpecimens } from "./specimens/index";
import { ThesisSpecimen } from "./specimens/thesis";
export function DesignSystemBody({ ctx: _ctx }: { ctx: unknown }) {
  return <DesignSystem />;
}

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
