import { Link } from "@tanstack/react-router";

import { Section } from "#/components/lang/section";

const SATELLITES: readonly { to: string; name: string; purpose: string }[] = [
  {
    to: "/design-system/proposal-flow",
    name: "proposal flow",
    purpose:
      "one shared in-memory world behind pea's chat card AND a StateCell table â€” accept, deny or undo in the card and the same value moves in the table. The proof that one grammar at two scales is a mechanism and not a resemblance. Carries the two-marks crucible and a commit receipt.",
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
      "the position harness. Every popover-bearing component the app actually ships, mounted nine times at the corners, edges and centre of the viewport. It does not fix flip/clamp/overflow inconsistency â€” it makes it one visible fact, which is what queues a single popover foundation.",
  },
  {
    to: "/design-system/swatch",
    name: "swatch",
    purpose:
      "fast lookup â€” every component in lang/ and the surviving ui/, alphabetical, with its import path on the surface, its grep-derived consumer count, and its whole variant Ã— state grid rendered small. The spec lives here; the swatch is where you FIND the component you are about to change.",
  },
];

export function SatelliteSpecimens() {
  return (
    <Section label="05 Â· satellites">
      <p>
        mocked complicated cases â€” sibling routes, not nested; each announces its fixture with a
        dashed seam
      </p>
      <div className="flex flex-col">
        {SATELLITES.map((s) => (
          <div
            key={s.to}
            className="grid grid-cols-1 items-baseline gap-x-6 gap-y-1 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
          >
            <Link to={s.to}>
              {s.name}
              <span className="ml-2">{s.to}</span>
            </Link>
            <p>{s.purpose}</p>
          </div>
        ))}
      </div>
      <p className="max-w-[80ch]">
        Satellites mock their worlds by construction â€” null identities, no host calls â€” and say
        so on the surface. That requirement closes only if a satellite is ever promoted to a real
        route.
      </p>
    </Section>
  );
}
