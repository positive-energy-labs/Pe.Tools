/**
 * PROTOTYPE — the design-language round, base 2. Throwaway; delete at the close of the round
 * that rules on it. Not linked from anywhere: reach it at `/design-lang?variant=a`.
 *
 * The round's one question: WHICH WHOLE LANGUAGE LETS A NEWCOMER READ STATE, VERBS, AND
 * PEA'S VOICE IN SECONDS — judged on real product moments, not a specimen sheet.
 *
 * Base 1 (token scopes over byte-identical specimen markup) isolated the variable so well it
 * stopped being a product: verdicts on abstract rows did not survive contact with real
 * density. Base 2 inverts the trade: variants are complete rival languages — color strategy,
 * type, marks, density, markup all free — over one shared fixture of four real moments
 * (`design-lang/proto/world.ts`): pea's inline chat proposal card, a table slice, the verb
 * lane with the arming strip, and the addressing sentence.
 *
 * `/design-system` imports NOTHING from here — that wall is what keeps the exhibit from
 * becoming a prototype's only consumer.
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ThemeToggle } from "#/components/ThemeToggle";
import { ProtoSwitcher } from "#/family/proto/switcher";
import { Base } from "#/design-lang/proto/base";
import "#/design-lang/proto/palettes/p3.css";

export const Route = createFileRoute("/design-lang")({
  validateSearch: (search: Record<string, unknown>): { variant?: string } => ({
    variant:
      typeof search.variant === "string" && search.variant.trim()
        ? search.variant.trim()
        : undefined,
  }),
  component: DesignLangRound,
});

/** Round 2 ruled 2026-08-16: p3 (wholistic bands) won by a lot; all other palettes and the
 *  e reference retired (snapshot: `proto/design-lang-base2-round2`). p0 survives only as the
 *  default block inside tokens.css. Round 3 rivals take the freed slots — verdicts and the
 *  open frontier live in docs/features/design-lang/CLEANROOM.md. */
const VARIANTS = [
  {
    key: "p3",
    name: "wholistic bands (round-2 winner)",
    thesis:
      "Every role on shared OKLCH lightness/chroma bands inside PE warmth; the alarm alone sits off-band. The palette reads as one system.",
    component: () => <Base palette="p3" />,
  },
] as const;

/** Comparison zooms: "fit" shrinks a whole variant toward one viewport so flipping ←/→
 *  compares languages, not scroll positions. CSS `zoom` is fine here — in-app Chromium. */
const ZOOMS = [
  { label: "fit", value: 0.62 },
  { label: "mid", value: 0.75 },
  { label: "1:1", value: 1 },
] as const;

function DesignLangRound() {
  const { variant } = Route.useSearch();
  const current = variant ?? "p3";
  const active = VARIANTS.find((v) => v.key === current) ?? VARIANTS[0];
  const Body = active.component;
  const [zoom, setZoom] = useState<number>(0.62);

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex items-center justify-between px-6 py-2">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="shrink-0 font-pe-display text-sm font-semibold tracking-tight">
              Design language — base 2
            </span>
            <span className="truncate text-[12px] text-muted-foreground">
              {active.key} · {active.name} — {active.thesis}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* deliberately alien chrome, like the switcher — not part of the design under review */}
            <div className="flex overflow-hidden rounded-full bg-zinc-900 font-mono text-[11px] text-zinc-100">
              {ZOOMS.map((z) => (
                <button
                  key={z.label}
                  type="button"
                  onClick={() => setZoom(z.value)}
                  className={`px-2.5 py-1 ${zoom === z.value ? "bg-zinc-600" : "hover:bg-zinc-700"}`}
                >
                  {z.label}
                </button>
              ))}
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Comparison mode (zoom < 1): the page-wrap cap is dropped and the variant root's
          demo blocks flow into two balanced CSS columns, so a whole language lands in one
          viewport frame and ←/→ compares languages instead of scroll positions. The column
          override targets the root's direct children generically — variant files untouched. */}
      {zoom < 1 && (
        <style>{`
          .dl-compare > * { display: block !important; columns: 2; column-gap: 2.5rem; }
          .dl-compare > * > * { break-inside: avoid; margin-bottom: 2rem; }
        `}</style>
      )}
      <main
        className={zoom < 1 ? "dl-compare px-8 pt-4" : "page-wrap pt-6"}
        style={zoom < 1 ? { zoom, maxWidth: 2100, marginInline: "auto" } : undefined}
      >
        <Body />
      </main>

      <ProtoSwitcher
        variants={VARIANTS.map((v) => ({ key: v.key, name: v.name }))}
        current={active.key}
        to="/design-lang"
        param="variant"
      />
    </div>
  );
}
