import { TooltipHint } from "@pe/kit/lang/tooltip";
import { ClaimElement, claimParts } from "../../claims";
import type { Claim } from "../../legs";
import type { ShowElementsResult } from "#/revit/element-target";

export function InboxClaim({
  claim,
  nameOf,
  light,
  onSelect,
  onShown,
}: {
  claim: Claim;
  nameOf: (id: number) => string;
  light: (ids: readonly number[] | null) => void;
  onSelect: (id: number | null) => void;
  onShown: (result: ShowElementsResult) => void;
}) {
  return (
    <p>
      {claimParts(claim.text, nameOf).map((p, j) =>
        typeof p === "string" ? (
          <span key={j}>{p}</span>
        ) : p.dot ? (
          <TooltipHint key={j} content={p.name}>
            <span className="text-ink-2">·</span>
          </TooltipHint>
        ) : (
          <ClaimElement
            key={j}
            part={p}
            onHover={(id) => light(id == null ? null : [id])}
            onPick={onSelect}
            onShown={onShown}
          />
        ),
      )}
    </p>
  );
}

export const claimLine = (claim: Claim, nameOf: (id: number) => string) =>
  claimParts(claim.text, nameOf)
    .map((p) => (typeof p === "string" ? p : p.dot ? "" : p.name))
    .join("")
    .replace(/\s+/g, " ")
    .replace(/ ([,.;:?])/g, "$1");
