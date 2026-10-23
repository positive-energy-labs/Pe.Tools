/**
 * Claim text and verdict patches, with element links that select and section-box the {3D} view.
 * A verdict is the person's answer on one claim; `verdictPatches` stages it into the claim's Work
 * cell, the same path the assumptions editor uses. An element id in a claim's text reads as that
 * element's name (`claimParts`): hovering it lights the element in the drawing, clicking it selects
 * it in Revit. Pea writes ids; the route names them.
 */
import {
  transitionPatches,
  type DuctsRouteDocument,
  type RouteStatePatch,
} from "@pe/agent-contracts";

import { TooltipHint } from "@pe/kit/lang/tooltip";
import { RevitTarget } from "@pe/kit/lang/row";
import { showInRevit } from "#/revit/element-menu";
import type { ShowElementsResult } from "#/revit/element-target";
import { observedElements, useNativeObservation } from "#/revit/observation";
import { tokenRef } from "@pe/kit/lib/token";
import { snapshotById } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Claim, Place } from "./legs";
import type { SubjectDrawn } from "./scene";

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
    if (
      node &&
      (node.kind === "equipment" || node.kind === "terminal" || node.kind === "accessory")
    ) {
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

type ClaimHandlers = {
  onHover: (id: number | null) => void;
  onPick: (id: number) => void;
  onShown: (result: ShowElementsResult) => void;
};

/** One resolved id in a claim's text: a button that lights its element on hover and selects it on click. */
export function ClaimElement({
  part,
  onHover,
  onPick,
  onShown,
}: { part: Exclude<ClaimPart, string> } & ClaimHandlers) {
  const observation = useNativeObservation();
  const target = observedElements(observation, [part.id]);
  const native = observation.scope?.source === "native" && observation.scope.document !== null;
  return (
    <TooltipHint
      content={`${part.name} · element ${part.id}: ${native ? "click to select it in Revit" : "click to select it in the drawing"}`}
    >
      <RevitTarget ids={target.ids} refs={target.refs} scope={observation.scope}>
        <button
          type="button"
          data-claim-element={part.id}
          aria-label={`${part.name} ${part.id}`}
          className="subject-ref"
          onMouseEnter={() => onHover(part.id)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(part.id)}
          onBlur={() => onHover(null)}
          onClick={(e) => {
            e.stopPropagation();
            if (!native) return onPick(part.id);
            void showInRevit(target, true).then(onShown);
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
      </RevitTarget>
    </TooltipHint>
  );
}

/** A claim's prose with every resolved id as a `ClaimElement`. */
export function ClaimText({ parts, ...handlers }: { parts: readonly ClaimPart[] } & ClaimHandlers) {
  return parts.map((part, i) =>
    typeof part === "string" ? (
      <span key={i}>{part}</span>
    ) : (
      <ClaimElement key={i} part={part} {...handlers} />
    ),
  );
}
