import { Link } from "@tanstack/react-router";

import { Provenance, Section } from "#/components/lang/section";

const SATELLITES: readonly { to: string; name: string; purpose: string }[] = [
  {
    to: "/design-system/proposal-flow",
    name: "proposal flow",
    purpose:
      "one shared in-memory world behind pea's chat card AND a StateCell table — accept, deny or undo in the card and the same value moves in the table. The proof that one grammar at two scales is a mechanism and not a resemblance. Carries the two-marks crucible and a commit receipt.",
  },
  {
    to: "/design-system/arming",
    name: "arming",
    purpose:
      "the ArmingStrip lifecycle driven live: type a reason to arm it, commit, take a simulated drift refusal, re-plan. All three phases also stand frozen side by side, because a lifecycle you have to perform to see is a lifecycle nobody reviews.",
  },
  {
    to: "/design-system/popovers",
    name: "popovers",
    purpose:
      "the position harness. Every popover-bearing component the app actually ships, mounted nine times at the corners, edges and centre of the viewport. It does not fix flip/clamp/overflow inconsistency — it makes it one visible fact, which is what queues a single popover foundation.",
  },
  {
    to: "/design-system/compact",
    name: "compact",
    purpose:
      'a lineup for the table\'s COMPACT MODE: three hand tables the census ruled accidents, each on its seed rows, rendered through MasterTable today, through `density="compact"`, and once more as one overreach table. The verdict picks the row the sheet-like consumers migrate onto.',
  },
  {
    to: "/design-system/swatch",
    name: "swatch",
    purpose:
      "fast lookup — every component in lang/ and the surviving ui/, alphabetical, with its import path on the surface, its grep-derived consumer count, and its whole variant × state grid rendered small. The spec lives here; the swatch is where you FIND the component you are about to change.",
  },
];

export function SatelliteSpecimens() {
  return (
    <Section label="05 · satellites">
      <h3 className="pt-2 t-head text-ink">Satellites</h3>
      <Provenance>
        complicated fixture worlds live on sibling routes · each announces its fixture with a dashed
        seam
      </Provenance>
      <p className="pt-3 t-prose text-ink-2">
        mocked complicated cases — sibling routes, not nested; each announces its fixture with a
        dashed seam
      </p>
      <div className="flex flex-col">
        {SATELLITES.map((s) => (
          <div
            key={s.to}
            className="grid grid-cols-1 items-baseline gap-x-6 gap-y-1 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
          >
            <Link to={s.to} className="t-small text-ink">
              {s.name}
              <span className="ml-2 t-small face-mono text-ink-mute">{s.to}</span>
            </Link>
            <p className="t-small text-ink-2">{s.purpose}</p>
          </div>
        ))}
      </div>
      <p className="max-w-[80ch] t-small t-upper text-ink-mute">
        Satellites mock their worlds by construction — null identities, no host calls — and say so
        on the surface. That requirement closes only if a satellite is ever promoted to a real
        route.
      </p>
    </Section>
  );
}
