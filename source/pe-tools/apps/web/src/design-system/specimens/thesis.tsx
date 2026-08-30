import { Provenance } from "#/components/lang/section";

export function ThesisSpecimen() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="max-w-[22ch] t-display face-display text-ink">
        One cell grammar, at three scales.
      </h1>
      <p className="max-w-[74ch] t-prose text-ink-2">
        Pea proposes; you decide; the model may disagree. Every Pe.Tools surface must say those
        three things at a glance. The language uses the same marks for a table value, a proposal
        card, and the write that leaves the page. Colour is spent only where hue changes meaning;
        type carries the rest.
      </p>
      <Provenance>
        This page is the specification and the demonstration. Each ruling names its code owner and
        stands beside the shipping component that obeys it. A visible gap says when the component
        cannot obey yet.
      </Provenance>
    </section>
  );
}
