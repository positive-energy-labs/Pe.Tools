/**
 * PROTOTYPE ROUTE — targeting-grammar round 3: the paradigm matrix (2026-08-19).
 *
 * ALL five products on one page (round-2 layout verdict); `?paradigm=` cycles GENUINELY
 * different paradigms via the bottom pill — playing with a product's own paradigm (stage
 * scrubbing, picks, idle dimming) happens in place, never via the switcher.
 *
 * Fixtures + product semantics live in `targeting-proto/model.ts` only; paradigms render,
 * never invent. Round-2 verdicts baked into the baseline: joined sentence wins, idle=dim
 * wins, stage scrubber + manifest-defined steps are candidate canon.
 *
 * Fully fixtured — no host, no writes. Throwaway: the folder dies at round close.
 * Drive: /targeting-proto?paradigm=baseline
 */
import { createFileRoute } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { VariantSwitcher } from "#/param-tables/proto/switcher";
import { BaselineParadigm } from "#/targeting-proto/paradigm-baseline";
import { CircuitParadigm } from "#/targeting-proto/paradigm-circuit";
import { ManifestParadigm } from "#/targeting-proto/paradigm-manifest";
import { PatchbayParadigm } from "#/targeting-proto/paradigm-patchbay";
import { PluginParadigm } from "#/targeting-proto/paradigm-plugin";
import { RailParadigm } from "#/targeting-proto/paradigm-rail";

const PARADIGMS = [
  { key: "baseline", name: "baseline · joined sentence + stage scrub", Component: BaselineParadigm },
  { key: "rail", name: "workflow rail · bindings hang off stages", Component: RailParadigm },
  { key: "circuit", name: "circuit · nouns as a wiring diagram", Component: CircuitParadigm },
  { key: "manifest", name: "manifest · the census table IS the head", Component: ManifestParadigm },
  { key: "patchbay", name: "patchbay · safety by geography", Component: PatchbayParadigm },
  { key: "plugin", name: "plugin · every product as a chat card", Component: PluginParadigm },
];

export const Route = createFileRoute("/targeting-proto")({
  validateSearch: (search: Record<string, unknown>) => ({
    paradigm:
      typeof search.paradigm === "string" && PARADIGMS.some((p) => p.key === search.paradigm)
        ? search.paradigm
        : "baseline",
  }),
  component: TargetingProto,
});

function TargetingProto() {
  const { paradigm } = Route.useSearch();
  const navigate = Route.useNavigate();
  const active = PARADIGMS.find((p) => p.key === paradigm) ?? PARADIGMS[0]!;

  return (
    <div className="relative min-h-screen pb-20" style={{ background: "var(--r-page)" }}>
      <div className="flex items-baseline justify-between px-4 pt-3 pb-4">
        <span className="t-caption t-upper" style={{ color: "var(--r-ink-2)" }}>
          targeting paradigm — {active.name}
        </span>
        <FactChip
          dashed
          title="Everything on this route is fixture data — no host, no writes. The proto exists to judge the targeting paradigm across all five products at once."
        >
          fixture · mock
        </FactChip>
      </div>
      <div className="px-2">
        <active.Component />
      </div>
      <VariantSwitcher
        variants={PARADIGMS.map(({ key, name }) => ({ key, name }))}
        current={active.key}
        onSelect={(key) => void navigate({ search: { paradigm: key } })}
      />
    </div>
  );
}
