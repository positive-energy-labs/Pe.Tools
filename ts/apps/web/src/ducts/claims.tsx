/**
 * The claims of the subject scene beside the drawing: names for places and legs, and their facts.
 */
import type { Claim, Leg, Place } from "./legs";
import type { SubjectDrawn } from "./scene";

export type Verdict = NonNullable<Claim["verdict"]>;
export const VERDICTS: readonly { value: Verdict; word: string; says: string }[] = [
  { value: "yes", word: "yes", says: "the claim holds" },
  { value: "no", word: "no", says: "the claim is wrong" },
  { value: "not-this", word: "not this", says: "the claim is about the wrong place" },
];

/** A human name for a subject element: its place, else the leg it lies on, else its id. */
export const nameOf = (subject: SubjectDrawn, id: number) =>
  subject.placeOf.get(id)?.name ?? subject.legOf.get(id)?.name ?? `element ${id}`;

/** The facts of a place or a leg, beside the segment or node facts. */
export function PlaceFacts({ place }: { place: Place }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-place-facts={place.id}>
      <dt className="text-ink-2">place</dt>
      <dd>{place.name}</dd>
      <dt className="text-ink-2">kind</dt>
      <dd>{place.kind}</dd>
      <dt className="text-ink-2">element</dt>
      <dd className="face-mono">{place.id}</dd>
    </dl>
  );
}

export function LegFacts({ leg }: { leg: Leg }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-leg-facts={leg.name}>
      <dt className="text-ink-2">leg</dt>
      <dd>{leg.name}</dd>
      <dt className="text-ink-2">length</dt>
      <dd className="face-mono">{leg.lengthFt} ft</dd>
      <dt className="text-ink-2">fittings</dt>
      <dd className="face-mono">{leg.fittings}</dd>
      <dt className="text-ink-2">size</dt>
      <dd className="face-mono">{leg.size ?? "—"}</dd>
      <dt className="text-ink-2">elements</dt>
      <dd className="face-mono">{leg.ids.length}</dd>
    </dl>
  );
}
