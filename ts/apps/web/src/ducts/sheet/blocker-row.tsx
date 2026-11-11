/**
 * One blocker as a row: kind glyph, the element as a Subject (named by the snapshot, never a raw
 * id as the only noun; hover lights it, press goes to it), effect on the total ("—" until
 * recomputed), the inline number the closer needs (typed cfm or in-wg; the verb is live as it is
 * typed, and Enter or leaving the box runs it, like every authored-value cell), the closer verb as a framed house button naming the action and value,
 * and the refusal reason as row text as well as the button's tooltip. Hovering the row lights the
 * element and its mark on the picture; the picture's pick of the mark focuses the row (`focused`).
 * A `consequence` row (R-B: a blocker that exists only because of its cause row's assumed heal)
 * sits indented and muted under its cause with no input and no verb; its detail stands in.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { SubjectText } from "@pe/kit/lang/subject-text";
import { useMention } from "@pe/kit/lang/attention";
import type { Closer, PriceChoice } from "./closer";
import { SheetCell } from "./sheet-cell";
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
  const mention = useMention();
  const [typed, setTyped] = useState<number | null>(null);
  // The box's uncommitted number: the verb is live while the person types (undefined: no draft).
  const [draft, setDraft] = useState<number | null | undefined>(undefined);
  const closer = closerOf(blocker, draft === undefined ? typed : draft);
  // The action the cell's own commit already ran: leaving the box for the verb commits on blur,
  // and the press that follows must not run it twice.
  const committed = useRef<string | null>(null);
  const run = (next: Closer) => {
    const key = JSON.stringify(next.action);
    if (committed.current === key) return void (committed.current = null);
    onClose(next);
  };
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) row.current?.scrollIntoView({ block: "nearest" });
  }, [focused]);
  // A fix /ducts owns is a link that opens /ducts on the blocker's element (ruling 2026-11-10).
  const fixLink = (link: { says: string; href: string }) => (
    <a href={link.href} className="t-small" data-ducts-fix="" onClick={(event) => event.stopPropagation()}>{link.says}</a>
  );
  const crossingVerb = closer.crossing && (closer.crossing.link ? fixLink(closer.crossing.link) : (
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
  ));
  return (
    <div
      ref={row}
      role="row"
      data-blocker={blocker.id}
      data-focused={focused ? "" : undefined}
      data-caused-by={consequence ? blocker.causedBy : undefined}
      // Glyph, subject, effect on the first line; the input and verbs, then the refusal or the
      // consequence detail, on lines under the subject, so a long verb never runs off the pane.
      className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-1${consequence ? " pl-6 text-ink-2" : ""}`}
      {...mention(`issue:${blocker.id}`)}
      onClick={() => onFocus(focused ? null : blocker.id)}
    >
      <span className="face-mono t-small text-ink-2" aria-label={blocker.kind}>
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
      <span className="face-mono t-small text-right text-ink-2" data-effect="">
        {effectWord(blocker.effectInWg)}
      </span>
      {consequence ? (
        <span className="t-small col-span-2 col-start-2 truncate">{blocker.detail}</span>
      ) : (
        <>
          {/* The input and verb act on the blocker, not the row's focus toggle. */}
          <span
            className="col-span-2 col-start-2 flex min-w-0 flex-wrap items-center gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            {closer.input && (
              // The kit cell commits on Enter or leaving the box (Escape cancels): a committed
              // number runs the closer, so an ask commits exactly as an Inputs cell does.
              <SheetCell
                label={`${blocker.kind} ${closer.input.unit}`}
                value={typed}
                unit={{
                  label: closer.input.unit,
                  short: closer.input.unit === "in-wg" ? "wg" : undefined,
                }}
                digits={closer.input.unit === "cfm" ? 0 : 4}
                source={null}
                refusal={null}
                clearable
                placeholder={
                  closer.input.placeholder == null ? undefined : String(closer.input.placeholder)
                }
                className="block w-24"
                onValue={(value) => {
                  setTyped(value);
                  setDraft(undefined);
                  const next = closerOf(blocker, value);
                  if (value == null || next.refusal || !next.action) return;
                  onClose(next);
                  committed.current = JSON.stringify(next.action);
                }}
                onDraft={setDraft}
              />
            )}
            {closer.crossing?.first && crossingVerb}
            {closer.link ? fixLink(closer.link) : closer.choices?.length ? (
              // "price with…": each table the fitting may read, named with the rule it reads under.
              <ListPopup<PriceChoice>
                key={`${blocker.id}:${closer.refusal}`}
                anchor="trigger"
                face="control"
                trigger={<span>{closer.verb}</span>}
                triggerLabel={`${closer.verb} for ${blocker.kind}`}
                aria-label={`${closer.verb} for ${blocker.kind}`}
                disabled={closer.refusal != null}
                items={[...closer.choices]}
                keyOf={(choice) => `${choice.verb}|${choice.detail}`}
                labelOf={(choice) => `${choice.verb} ${choice.detail}`}
                empty="No tables"
                select="single"
                selected={[]}
                row={(choice) => ({ label: choice.verb, sub: choice.detail, lines: 2 })}
                onPick={(choice) =>
                  onClose({ ...closer, verb: choice.verb, action: choice.action, choices: null })
                }
              />
            ) : (
              <Button
                kind="framed"
                label={`${closer.verb} for ${blocker.kind}`}
                refusal={closer.refusal}
                onClick={() => run(closer)}
              >
                {closer.verb}
              </Button>
            )}
            {closer.crossing && !closer.crossing.first && crossingVerb}
            {closer.secondary?.link ? fixLink(closer.secondary.link) : closer.secondary && (
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
          {closer.refusal && (
            <span className="t-small col-span-2 col-start-2 truncate text-ink-2" data-refusal="">
              {closer.refusal}
            </span>
          )}
        </>
      )}
    </div>
  );
}
