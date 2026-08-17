// /runs — dev-only takeoff run browser (find-the-product round 1, three variants).
// Not linked from the index on purpose while in prototype; promote or delete at round close.
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { VariantSwitcher } from "../runs/proto/switcher";

const VARIANTS = ["sheet", "ledger", "light"] as const;
type Variant = (typeof VARIANTS)[number];

const bodies: Record<Variant, ReturnType<typeof lazy>> = {
  sheet: lazy(() => import("../runs/proto/sheet")),
  ledger: lazy(() => import("../runs/proto/ledger")),
  light: lazy(() => import("../runs/proto/light")),
};

export const Route = createFileRoute("/runs")({
  validateSearch: (search: Record<string, unknown>): { variant: Variant } => ({
    variant: VARIANTS.includes(search.variant as Variant) ? (search.variant as Variant) : "sheet",
  }),
  component: RunsPage,
});

function RunsPage() {
  const { variant } = Route.useSearch();
  const navigate = Route.useNavigate();
  if (!import.meta.env.DEV) {
    return <div className="p-8 text-sm text-muted-foreground">/runs is a dev-only surface.</div>;
  }
  const Body = bodies[variant];
  return (
    <>
      <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">loading runs…</div>}>
        <Body />
      </Suspense>
      <VariantSwitcher
        variants={[...VARIANTS]}
        active={variant}
        onSelect={(next) => void navigate({ search: { variant: next as Variant } })}
      />
    </>
  );
}
