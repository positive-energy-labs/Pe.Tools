/**
 * The claims of the subject scene as a list under the drawing, and the one crossing into Revit a
 * place or a leg offers: `revit.context.show-elements` selects and zooms, and mutates nothing.
 * A verdict is the person's answer on one claim; it lands in page state for now.
 * TODO(wave-1 merge): stage the verdict into Work as `Claim` with `verdict` set.
 */
import { useState } from "react";

import { FactChip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import { callHostRpc } from "#/host/client";
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

/**
 * Select and zoom to the element ids in Revit. Only mounted with a connected document: the verb
 * is impossible without one, so it is hidden rather than greyed.
 */
export function ShowInRevit({
  doc,
  elementIds,
  what,
}: {
  doc: { session: string; openId: string };
  elementIds: readonly number[];
  what: string;
}) {
  const [word, setWord] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-1">
      <Press
        type="button"
        frame="line"
        size="caption"
        title={`revit.context.show-elements: select ${elementIds.length} element(s) and zoom the active view to them; changes nothing in the model`}
        data-show-in-revit={what}
        onClick={() => {
          setWord("selecting…");
          callHostRpc(
            "revit.context.show-elements",
            { elementIds: [...elementIds] },
            { bridgeSessionId: doc.session, openDocumentId: doc.openId },
          ).then(
            (answer) =>
              setWord(
                `${answer.shown.length} shown in ${answer.viewName}${answer.missing.length ? `, ${answer.missing.length} missing` : ""}`,
              ),
            (error: unknown) => setWord(error instanceof Error ? error.message : String(error)),
          );
        }}
      >
        select {what} in Revit
      </Press>
      {word ? <FactChip title="what revit.context.show-elements answered">{word}</FactChip> : null}
    </span>
  );
}

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
