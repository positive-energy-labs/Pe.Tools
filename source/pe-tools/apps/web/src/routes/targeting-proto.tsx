/**
 * PROTOTYPE ROUTE — targeting round 4: VIEWS of one manifest (2026-08-20).
 *
 * Round 5 (2026-08-20): card retired into a pea slot; views are sentence · board · flow.
 * Round-3 verdicts (MAP.md): sentence style wins; rail's "capability now" idea survives
 * without its vertical list; circuit donates the arrow as a progress home; plugin's
 * stage-remounts-verbs + popover picker survive. Reframe: bindings are a FOREST OF PATHS.
 *
 * `?view=` cycles genuinely different VIEWS of the same manifests (all six products at once,
 * per the round-2 layout ruling). Playing with a product (stage, picks, running a mock verb)
 * happens in place. The census footer is the repo-wide "what is stubbed" projection.
 *
 * Fully fixtured — no host, no writes. Throwaway: the folder dies at round close.
 * Drive: /targeting-proto?view=sentence
 */
import { createFileRoute } from "@tanstack/react-router";

import { FactChip } from "#/components/lang/chip";
import { VariantSwitcher } from "#/proto/variant-switcher";
import { endpoints, PRODUCTS, seams } from "#/targeting-proto/model";
import { BoardView } from "#/targeting-proto/view-board";
import { FlowView } from "#/targeting-proto/view-flow";
import { SentenceView } from "#/targeting-proto/view-sentence";

const VIEWS = [
  {
    key: "sentence",
    name: "sentence · hoisted + single-input (segmented/columns/search)",
    Component: SentenceView,
  },
  { key: "board", name: "board · capability now, brutalist", Component: BoardView },
  {
    key: "flow",
    name: "flow · grammar as geometry (subject inside, reads left, writes right)",
    Component: FlowView,
  },
];

export const Route = createFileRoute("/targeting-proto")({
  validateSearch: (search: Record<string, unknown>) => ({
    view:
      typeof search.view === "string" && VIEWS.some((v) => v.key === search.view)
        ? search.view
        : "sentence",
  }),
  component: TargetingProto,
});

/** Repo-wide seam census — one row per route, derived from the manifests. */
function Census() {
  return (
    <table className="mt-10 w-full max-w-3xl t-caption" style={{ color: "var(--r-ink-2)" }}>
      <thead>
        <tr className="t-upper text-left">
          <th className="py-1 pr-4">route</th>
          <th className="pr-4">endpoints</th>
          <th className="pr-4">verbs</th>
          <th className="pr-4">seams</th>
          <th>needs</th>
        </tr>
      </thead>
      <tbody>
        {PRODUCTS.map((p) => {
          const s = seams(p);
          const verbs = p.stages.flatMap((st) => st.verbs);
          return (
            <tr key={p.key} style={{ borderTop: "0.5px solid var(--r-line-2)" }}>
              <td className="py-1 pr-4" style={{ color: "var(--r-ink)" }}>
                {p.name}
              </td>
              <td className="pr-4">{endpoints(p).length}</td>
              <td className="pr-4">
                {verbs.length - s.filter((x) => x.kind === "verb").length}/{verbs.length} wired
              </td>
              <td className="pr-4" style={{ color: s.length ? "var(--r-caution)" : undefined }}>
                {s.length}
              </td>
              <td>{s.map((x) => `${x.subject} ← ${x.needs}`).join(" · ") || "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TargetingProto() {
  const { view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0]!;

  return (
    <div className="relative min-h-screen pb-20" style={{ background: "var(--r-page)" }}>
      <div className="flex items-baseline justify-between px-4 pt-3 pb-4">
        <span className="t-caption t-upper" style={{ color: "var(--r-ink-2)" }}>
          targeting view — {active.name}
        </span>
        <FactChip
          dashed
          title="Everything on this route is fixture data — no host, no writes. The proto judges VIEWS of one manifest across six products at once."
        >
          fixture · mock
        </FactChip>
      </div>
      <div className="px-2">
        {PRODUCTS.map((p) => (
          <section key={p.key} className="pb-8">
            <active.Component product={p} />
            <div className="t-caption px-2 pt-1" style={{ color: "var(--r-ink-2)" }}>
              stress: {p.stress}
            </div>
          </section>
        ))}
        <Census />
      </div>
      <VariantSwitcher
        variants={VIEWS.map(({ key, name }) => ({ key, name }))}
        current={active.key}
        onSelect={(key) => void navigate({ search: { view: key } })}
      />
    </div>
  );
}
