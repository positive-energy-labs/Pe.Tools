/**
 * The claims of the subject scene as a list under the drawing, and the one crossing into Revit a
 * place or a leg offers: `revit.context.show-elements` selects and zooms, and mutates nothing.
 * A verdict is the person's answer on one claim; `verdictPatches` stages it into the claim's Work
 * cell, the same path the assumptions editor uses. An element id in a claim's text reads as that
 * element's name (`claimParts`): hovering it lights the element in the drawing, clicking it selects
 * it in Revit. Pea writes ids; the route names them.
 */
import { useState } from "react";
import {
  transitionPatches,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import { FactChip } from "@pe/kit/lang/chip";
import { Button } from "@pe/kit/lang/button";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { callHostRpc } from "#/host/client";
import { tokenRef } from "@pe/kit/lib/token";
import { snapshotById } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { claimInk } from "./encoding";
import type { Claim, Leg, Place } from "./legs";
import type { SubjectDrawn } from "./scene";

type RevitDoc = { session: string; openId: string };

export type Verdict = NonNullable<Claim["verdict"]>;
export const VERDICTS: readonly { value: Verdict; word: string; says: string }[] = [
  { value: "yes", word: "yes", says: "the claim holds" },
  { value: "no", word: "no", says: "the claim is wrong" },
  { value: "not-this", word: "not this", says: "the claim is about the wrong place" },
];

/**
 * The patches one verdict press makes: the claim's cell staged with the verdict, who gave it and
 * when. The web has no user identity yet, so the judge is "person" (the manifest's word for the human).
 */
export const verdictPatches = (
  doc: DuctsRouteDocument | null,
  claim: Claim,
  verdict: Verdict,
  now: Date = new Date(),
): RouteStatePatch[] =>
  transitionPatches(["claims"], claim.id, doc?.claims[claim.id] ?? {}, {
    kind: "stage",
    rung: {
      value: {
        text: claim.text,
        ids: claim.at,
        state: claim.state,
        verdict,
        verdictBy: "person",
        verdictAt: now.toISOString(),
      },
    },
  });

/** A human name for a subject element: its place, else the leg it lies on, else its id. */
export const nameOf = (subject: SubjectDrawn, id: number) =>
  subject.placeOf.get(id)?.name ?? subject.legOf.get(id)?.name ?? `element ${id}`;

const KIND_WORD: Record<DuctSnapshot["nodes"][number]["kind"], string> = {
  equipment: "equipment",
  terminal: "terminal",
  fitting: "fitting",
  accessory: "accessory",
  cap: "end cap",
};
/** A unit or grille with no label or mark reads by what it is: its family and type ('Price LBP15A Supply 16 X 8'). */
export const typeName = (node: { family?: string | null; type?: string | null }) => {
  // A Revit-internal family name (`Damper_Volume_Round`) is not a person's word; its type is.
  const family = node.family?.includes("_") && node.type?.trim() ? null : node.family;
  return [...new Set([family, node.type].map((v) => v?.trim()).filter(Boolean))].join(" ");
};
const ELEMENT_PLACES = new Set<Place["kind"]>(["equipment", "accessory", "terminal", "cap"]);

/**
 * A person's name for any snapshot element, null when the id is not in the snapshot: the node's
 * label, else its place name in the cut (never a `kind id` fallback), else a short kind (`end cap`,
 * `10″ duct`).
 */
export function elementNamer(snapshot: DuctSnapshot, subject: SubjectDrawn | null) {
  const { nodes, segments } = snapshotById(snapshot);
  return (id: number): string | null => {
    const node = nodes.get(id);
    if (node?.label) return node.label;
    // A unit is named by its Mark (FC-17), never by its kind.
    const mark = node?.facts.find((f) => f.key === "mark")?.text;
    if (mark) return mark;
    const place = subject?.placeOf.get(id);
    if (place && ELEMENT_PLACES.has(place.kind) && !place.name.endsWith(String(id)))
      return place.name;
    if (node && (node.kind === "equipment" || node.kind === "terminal" || node.kind === "accessory")) {
      const typed = typeName(node);
      if (typed) return typed;
    }
    if (node) return KIND_WORD[node.kind];
    const segment = segments.get(id);
    if (!segment) return null;
    const size = segment.size.replaceAll('"', "″").replaceAll("ø", "").trim();
    return `${size ? `${size} ` : ""}${segment.kind}`;
  };
}

/** An element id resolved in a claim's text; `dot` when the prose just before already names it. */
export type ClaimPart = string | { id: number; name: string; dot: boolean };

/** How far back (chars) the prose is searched for the name's last word before a dot stands in. */
const NAMED_BEFORE = 30;

/**
 * A claim's text cut into prose and resolved ids: every 7–9 digit number `nameOf` knows becomes its
 * name, or a dot when the 30 chars before it already hold the name's last word ("end cap 14107111").
 * A number `nameOf` does not know stays prose.
 */
export function claimParts(text: string, nameOf: (id: number) => string | null): ClaimPart[] {
  const parts: ClaimPart[] = [];
  let at = 0;
  for (const match of text.matchAll(/\b\d{7,9}\b/g)) {
    const id = Number(match[0]);
    const name = nameOf(id);
    if (!name) continue;
    if (match.index > at) parts.push(text.slice(at, match.index));
    const word = name.trim().split(/\s+/).at(-1)!.toLowerCase();
    const before = text.slice(Math.max(0, match.index - NAMED_BEFORE), match.index).toLowerCase();
    parts.push({ id, name, dot: before.includes(word) });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/** `revit.context.show-elements`: select and zoom to the ids; resolves to what Revit answered. */
export const showElements = (doc: RevitDoc, elementIds: readonly number[]) =>
  callHostRpc(
    "revit.context.show-elements",
    { elementIds: [...elementIds] },
    { bridgeSessionId: doc.session, openDocumentId: doc.openId },
  ).then(
    (answer) => answer.note,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

type ClaimHandlers = {
  doc: RevitDoc | null;
  onHover: (id: number | null) => void;
  onPick: (id: number) => void;
  onShown: (word: string) => void;
};

/** One resolved id in a claim's text: a button that lights its element on hover and selects it on click. */
export function ClaimElement({
  part,
  doc,
  onHover,
  onPick,
  onShown,
}: { part: Exclude<ClaimPart, string> } & ClaimHandlers) {
  return (
    <TooltipHint
      content={`${part.name} · element ${part.id}: ${doc ? "click to select it in Revit" : "click to select it in the drawing"}`}
    >
      <button
        type="button"
        data-claim-element={part.id}
        aria-label={`${part.name} ${part.id}`}
        className="cursor-pointer underline decoration-dotted underline-offset-2"
        onMouseEnter={() => onHover(part.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(part.id)}
        onBlur={() => onHover(null)}
        onClick={() => {
          if (!doc) return onPick(part.id);
          onShown("selecting…");
          void showElements(doc, [part.id]).then(onShown);
        }}
      >
        {part.dot ? (
          <span
            aria-hidden
            className="inline-block size-1.5 rounded-full align-middle"
            style={{ backgroundColor: tokenRef("ink-2") }}
          />
        ) : (
          part.name
        )}
      </button>
    </TooltipHint>
  );
}

/** A claim's prose with every resolved id as a `ClaimElement`. */
export function ClaimText({
  parts,
  ...handlers
}: { parts: readonly ClaimPart[] } & ClaimHandlers) {
  return parts.map((part, i) =>
    typeof part === "string" ? (
      <span key={i}>{part}</span>
    ) : (
      <ClaimElement key={i} part={part} {...handlers} />
    ),
  );
}

export function ClaimsList({
  subject,
  selected,
  nameOfId,
  doc = null,
  onSelect,
  onVerdict,
  onHover,
  onPick,
}: {
  subject: SubjectDrawn;
  /** The selected claim id; "" = none. */
  selected: string;
  /** `elementNamer` over the read snapshot. */
  nameOfId: (id: number) => string | null;
  /** The connected document; null keeps an id's click in the drawing. */
  doc?: RevitDoc | null;
  onSelect: (claim: Claim) => void;
  onVerdict: (claim: Claim, verdict: Verdict) => void;
  /** The drawing's hover: an id named in a claim lights its element. */
  onHover: (id: number | null) => void;
  /** Select an element in the drawing (no document to send it to). */
  onPick: (id: number) => void;
}) {
  const [said, setSaid] = useState<string | null>(null);
  if (!subject.claims.length)
    return (
      <p className="text-ink-2 px-1 py-1" data-claims="none">
        no claims on this subject
      </p>
    );
  return (
    <ol
      className="flex flex-col gap-1 px-1 py-1"
      aria-label="claims"
      data-claims={subject.claims.length}
    >
      {subject.claims.map((claim, i) => {
        const on = claim.id === selected;
        const verdict = claim.verdict;
        const names = [...new Set(claim.at.map((id) => nameOf(subject, id)))];
        return (
          <li
            key={claim.id}
            data-claim-row={claim.id}
            data-selected={on ? "" : undefined}
            className="flex items-start gap-2"
            style={{
              outline: on ? `2px solid ${tokenRef("select")}` : undefined,
              outlineOffset: 2,
            }}
          >
            <TooltipHint
              content={`select claim ${i + 1}: its places and legs light up in the drawing`}
            >
              <button
                type="button"
                aria-label={`select claim ${i + 1}`}
                className="face-mono mt-0.5 inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-[10px]"
                style={{ backgroundColor: claimInk(claim), color: tokenRef("page") }}
                onClick={() => onSelect(claim)}
              >
                {i + 1}
              </button>
            </TooltipHint>
            <span className="min-w-0 flex-1">
              <ClaimText
                parts={claimParts(claim.text, nameOfId)}
                doc={doc}
                onHover={onHover}
                onPick={onPick}
                onShown={setSaid}
              />{" "}
              <TooltipHint
                content={`select claim ${i + 1}: its places and legs light up in the drawing`}
              >
                <button
                  type="button"
                  className="text-ink-2 face-mono t-small cursor-pointer text-left"
                  onClick={() => onSelect(claim)}
                >
                  {claim.state} · at {names.join(", ")}
                  {verdict ? ` · ${VERDICTS.find((v) => v.value === verdict)?.word}` : ""}
                </button>
              </TooltipHint>
            </span>
            <span
              className="flex shrink-0 items-center gap-1"
              role="group"
              aria-label={`verdict on claim ${i + 1}`}
            >
              {VERDICTS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  kind="framed"
                  label={option.word}
                  reason={option.says}
                  pressed={verdict === option.value}
                  data-verdict={option.value}
                  onClick={() => onVerdict(claim, option.value)}
                >
                  {option.word}
                </Button>
              ))}
            </span>
          </li>
        );
      })}
      {said ? (
        <li>
          <FactChip title="what revit.context.show-elements answered">{said}</FactChip>
        </li>
      ) : null}
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
  doc: RevitDoc;
  elementIds: readonly number[];
  what: string;
}) {
  const [word, setWord] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-1">
      <Button
        type="button"
        kind="framed"
        label={`select ${what} in Revit`}
        reason={`revit.context.show-elements: select ${elementIds.length} element(s) and zoom the active view to them; changes nothing in the model`}
        data-show-in-revit={what}
        onClick={() => {
          setWord("selecting…");
          void showElements(doc, elementIds).then(setWord);
        }}
      >
        select {what} in Revit
      </Button>
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
      <dd className="face-mono">{leg.lengthFt.toFixed(1)} ft</dd>
      <dt className="text-ink-2">fittings</dt>
      <dd className="face-mono">{leg.fittings}</dd>
      <dt className="text-ink-2">size</dt>
      <dd className="face-mono">{leg.size ?? "—"}</dd>
      <dt className="text-ink-2">elements</dt>
      <dd className="face-mono">{leg.ids.length}</dd>
    </dl>
  );
}
