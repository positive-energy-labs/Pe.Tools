/**
 * One blocker as a row: kind glyph, the element as a Subject (named by the snapshot, never a raw
 * id as the only noun; hover lights it, press goes to it), effect on the total ("—" until
 * recomputed), the inline number the closer needs (typed cfm or in-wg; Enter runs the verb), the
 * closer verb as a framed house button naming the action and value, and the refusal reason as
 * row text as well as the button's tooltip. Hovering the row lights the element and its mark on
 * the picture; the picture's pick of the mark focuses the row (`focused`).
 * A `consequence` row (R-B: a blocker that exists only because of its cause row's assumed heal)
 * sits indented and muted under its cause with no input and no verb; its detail stands in.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { SubjectText } from "@pe/kit/lang/subject-text";
import { useElementAttention, useIssueHover } from "#/attention";
import type { Closer } from "./closer";
import type { SheetBlocker } from "./tiers";

const GLYPH: Record<SheetBlocker["kind"], string> = {
  "open-end": "◌",
  "inferred-join": "⟷",
  "unknown-drop": "Δp?",
  "no-flow": "cfm?",
  "flow-mismatch": "≠",
  "shared-leg": "⋔",
  "class-change": "⇄",
  "not-priced": "¤?",
  "implausible-loss": "!",
  "equipment-pairing": "⧉",
};
const effectWord = (value: number | null) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(4)} in-wg`;

export function BlockerRow({
  blocker,
  focused,
  consequence = false,
  closerOf,
  onClose,
  onFocus,
}: {
  blocker: SheetBlocker;
  focused: boolean;
  consequence?: boolean;
  closerOf: (blocker: SheetBlocker, typed: number | null) => Closer;
  onClose: (closer: Closer) => void;
  onFocus: (id: string | null) => void;
}) {
  const attention = useElementAttention();
  const hoverIssue = useIssueHover();
  const [typed, setTyped] = useState<number | null>(null);
  const closer = closerOf(blocker, typed);
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  const crossingVerb = closer.crossing && (
    <>
      <Button
        kind="framed"
        label={`${closer.crossing.verb} for ${blocker.kind}`}
        refusal={closer.crossing.refusal}
        onClick={() =>
          onClose({
            ...closer,
            verb: closer.crossing!.verb,
            refusal: closer.crossing!.refusal,
            action: closer.crossing!.action,
            secondary: null,
            crossing: null,
          })
        }
      >
        {closer.crossing.verb}
      </Button>
      <span className="t-small text-ink-2" data-crossing-distance="">
        {closer.crossing.distanceIn.toFixed(3)} in
      </span>
    </>
  );
  return (
    <div
      ref={row}
      role="row"
      data-blocker={blocker.id}
      data-focused={focused ? "" : undefined}
      data-caused-by={consequence ? blocker.causedBy : undefined}
      className={`grid grid-cols-[2.5rem_minmax(0,1fr)_7rem_auto_auto] items-baseline gap-x-3 py-1${consequence ? " pl-6 text-ink-2" : ""}`}
      onPointerEnter={() => {
        attention.onHover(blocker.elementId);
        hoverIssue(blocker.id);
      }}
      onPointerLeave={() => {
        attention.onHover(null);
        hoverIssue(null);
      }}
      onClick={() => onFocus(focused ? null : blocker.id)}
    >
      <span className="face-mono" aria-label={blocker.kind} title={blocker.kind}>
        {GLYPH[blocker.kind]}
      </span>
      <span className="min-w-0 truncate">
        <SubjectText
          text={[{ id: blocker.elementId, connector: blocker.connector }]}
          revit={[blocker.elementId]}
          owner={blocker.id}
        />
        {blocker.closer.candidate && (
          <>
            {" → "}
            <SubjectText
              text={[
                {
                  id: blocker.closer.candidate.toElementId,
                  connector: blocker.closer.candidate.toConnector ?? undefined,
                },
              ]}
              revit={[blocker.closer.candidate.toElementId]}
              owner={`${blocker.id}:candidate`}
            />
          </>
        )}
      </span>
      <span className="face-mono t-small text-ink-2" data-effect="">
        {effectWord(blocker.effectInWg)}
      </span>
      {consequence ? (
        <>
          <span />
          <span className="t-small truncate" title={blocker.detail}>
            {blocker.detail}
          </span>
        </>
      ) : (
        <>
          {/* The input and verb act on the blocker, not the row's focus toggle. */}
          <span className="flex items-baseline gap-2" onClick={(event) => event.stopPropagation()}>
            {closer.input && (
              <span className="flex w-28 items-baseline gap-1">
                <Input
                  aria-label={`${blocker.kind} ${closer.input.unit}`}
                  type="number"
                  min={0}
                  step="any"
                  face="mono"
                  placeholder={
                    closer.input.placeholder == null ? "" : String(closer.input.placeholder)
                  }
                  onChange={(event) => {
                    const field = event.currentTarget;
                    setTyped(
                      field.value.trim() &&
                        field.validity.valid &&
                        Number.isFinite(field.valueAsNumber)
                        ? field.valueAsNumber
                        : null,
                    );
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onClose(closer);
                  }}
                />
                <span className="t-small text-ink-2">{closer.input.unit}</span>
              </span>
            )}
            {closer.crossing?.first && crossingVerb}
            <Button
              kind="framed"
              label={`${closer.verb} for ${blocker.kind}`}
              refusal={closer.refusal}
              onClick={() => onClose(closer)}
            >
              {closer.verb}
            </Button>
            {closer.crossing && !closer.crossing.first && crossingVerb}
            {closer.secondary && (
              <Button
                kind="quiet"
                label={`${closer.secondary.verb} for ${blocker.kind}`}
                refusal={closer.secondary.refusal}
                onClick={() =>
                  onClose({
                    ...closer,
                    verb: closer.secondary!.verb,
                    refusal: closer.secondary!.refusal,
                    action: closer.secondary!.action,
                    secondary: null,
                  })
                }
              >
                {closer.secondary.verb}
              </Button>
            )}
          </span>
          <span className="t-small text-ink-2" data-refusal={closer.refusal ? "" : undefined}>
            {closer.refusal ?? ""}
          </span>
        </>
      )}
    </div>
  );
}
