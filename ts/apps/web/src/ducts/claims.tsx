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
import { tokenRef } from "#/lib/token";
import { claimInk } from "./encoding";
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

export function ClaimsList({
  subject,
  verdicts,
  selected,
  onSelect,
  onVerdict,
}: {
  subject: SubjectDrawn;
  verdicts: Readonly<Record<string, Verdict>>;
  /** The selected claim id; "" = none. */
  selected: string;
  onSelect: (claim: Claim) => void;
  onVerdict: (claim: Claim, verdict: Verdict) => void;
}) {
  if (!subject.claims.length)
    return (
      <p className="text-ink-2 px-1 py-1" data-claims="none">
        no claims on this subject
      </p>
    );
  return (
    <ol className="flex flex-col gap-1 px-1 py-1" aria-label="claims" data-claims={subject.claims.length}>
      {subject.claims.map((claim, i) => {
        const on = claim.id === selected;
        const verdict = verdicts[claim.id] ?? claim.verdict;
        const names = [...new Set(claim.at.map((id) => nameOf(subject, id)))];
        return (
          <li
            key={claim.id}
            data-claim-row={claim.id}
            data-selected={on ? "" : undefined}
            className="flex items-start gap-2"
            style={{ outline: on ? `2px solid ${tokenRef("select")}` : undefined, outlineOffset: 2 }}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 text-left"
              onClick={() => onSelect(claim)}
              title={`select claim ${i + 1}: its places and legs light up in the drawing`}
            >
              <span
                aria-hidden
                className="face-mono mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px]"
                style={{ backgroundColor: claimInk(claim), color: tokenRef("page") }}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span>{claim.text}</span>{" "}
                <span className="text-ink-2 face-mono t-small">
                  {claim.state} · at {names.join(", ")}
                  {verdict ? ` · ${VERDICTS.find((v) => v.value === verdict)?.word}` : ""}
                </span>
              </span>
            </button>
            <span className="flex shrink-0 items-center gap-1" role="group" aria-label={`verdict on claim ${i + 1}`}>
              {VERDICTS.map((option) => (
                <Press
                  key={option.value}
                  type="button"
                  frame="line"
                  size="caption"
                  state={verdict === option.value ? "selected" : "rest"}
                  aria-pressed={verdict === option.value}
                  title={option.says}
                  data-verdict={option.value}
                  onClick={() => onVerdict(claim, option.value)}
                >
                  {option.word}
                </Press>
              ))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

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
