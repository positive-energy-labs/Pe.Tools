/** One popup per Situation ladder: rungs as plain data, a pick binds its rung and advances.
 *  `word` is the terminal word in a sentence (dotted held, dashed derived, caution incomplete);
 *  `control` is a framed trigger beside buttons that reads the whole path. */
import { useRef, useState, type ReactNode } from "react";

import type { Collection, Level } from "@pe/kit/lang/collection";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { Button } from "@pe/kit/lang/button";

interface RungOption {
  id: string;
  label: string;
  /** A measured fact beside the label (a count, a kind, a path tail). */
  sub?: string;
  /** The head it lists under (a schedule's category). */
  group?: string;
  /** Present, the row refuses picks and says why. */
  refusal?: string;
  /** The `sub` fact is the world disagreeing (a provider not ready): the caution tone. */
  caution?: boolean;
}

export interface Rung {
  key: string;
  /** What the sentence says for this rung once bound; null = unbound. */
  label: string | null;
  /** The word for the empty slot ("choose a document"). */
  placeholder: string;
  /** null = this rung cannot list yet; `note` says why. */
  options: readonly RungOption[] | null;
  /** Why the list is empty or missing ("reading…", "read failed", "bind a session first"). */
  note?: string;
  multi?: boolean;
  /** Left out of the trigger's path while true (an off toggle); its crumb still says it. */
  silent?: boolean;
  picked?: (id: string) => boolean;
  checked?: (id: string) => boolean | "mixed";
  pick: (id: string) => void;
  /** Route-supplied footer under the options of this rung. */
  extra?: ReactNode;
}

type Hit = RungOption & { rung: string };

export function Ladder({
  levels,
  derived,
  caution,
  disabled,
  title,
  open,
  onOpenChange,
  face = "word",
  mark,
  openOn,
  closeOn,
}: {
  levels: readonly Rung[];
  face?: "word" | "control";
  /** A glyph that stands for the first rung (the composer's provider mark): the complete ladder
   *  reads `mark second · third` instead of `first › second › third`. */
  mark?: ReactNode;
  /** The rung key it opens on, complete or not (default: the first unbound, else the last). */
  openOn?: string;
  /** Rung keys whose pick closes the popup instead of advancing (default: only the last rung does). */
  closeOn?: readonly string[];
  /** The bound value was reported by the world, not chosen (house law 8): dashed. */
  derived?: boolean;
  /** The world disagrees with the binding ("needs initialization"): caution tone. */
  caution?: boolean;
  disabled?: boolean;
  title?: string;
  /** Controlled: the Situation palette (Ctrl K) opens the ladder without its trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const collection = useRef<Collection<Hit> | null>(null);
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const setOpen = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  const unbound = levels.findIndex((rung) => rung.label === null);
  const complete = unbound < 0;
  const shown = levels.filter((rung) => !rung.silent);
  const word = !complete ? (
    levels[unbound]!.placeholder
  ) : mark ? (
    <>
      {mark}
      {shown
        .filter((rung) => rung !== levels[0])
        .map((rung) => rung.label)
        .join(" · ")}
    </>
  ) : face === "control" ? (
    shown.map((rung) => rung.label).join(" › ")
  ) : (
    (levels.at(-1)?.label ?? "")
  );
  const rungOf = (hit: Hit) => levels.find((rung) => rung.key === hit.rung)!;
  const rungs: Level<Hit>[] = levels.map((rung) => ({
    label: rung.key,
    crumb: rung.label ?? rung.placeholder,
    items: () => (rung.options ?? []).map((option) => ({ ...option, rung: rung.key })),
    // A rung's options come from the route's bindings, never from the path walked to it.
    independent: true,
    multi: rung.multi,
    refusal: rung.options === null ? (rung.note ?? `needs ${rung.key}`) : null,
    note: rung.note ?? `no ${rung.key}`,
    onPick: (hit) => {
      rung.pick(hit.id);
      if (closeOn?.includes(rung.key)) setOpen(false);
    },
  }));
  const selected = levels.flatMap((rung) =>
    (rung.options ?? [])
      .filter((option) => rung.picked?.(option.id))
      .map((option) => `${rung.key}:${option.id}`),
  );
  const opening = levels.findIndex((rung) => rung.key === openOn);
  const start = opening >= 0 ? opening : complete ? levels.length - 1 : unbound;
  const name = `Choose ${levels[start]?.key ?? ""}`;
  return (
    <ListPopup<Hit>
      anchor="trigger"
      face={face}
      trigger={word}
      title={title}
      disabled={disabled}
      open={isOpen}
      onOpenChange={setOpen}
      derived={derived || !complete}
      caution={caution || !complete}
      aria-label={name}
      // The trigger's face is a value or a placeholder; its name says what it chooses.
      triggerLabel={name}
      levels={rungs}
      onCollection={(current) => {
        collection.current = current;
      }}
      startLevel={start}
      keyOf={(hit) => `${hit.rung}:${hit.id}`}
      labelOf={(hit) => `${hit.label} ${hit.sub ?? ""}`.trim()}
      groupOf={(hit) => hit.group}
      // A rung's rows carry their own measured counts; a head count would be a second number.
      groupCounts={false}
      filter="substring"
      select="single"
      selected={selected}
      empty="nothing to choose"
      maxHeight="min(16rem, calc(100dvh - 6rem))"
      footer={(level) => (
        <>
          {levels[level]?.extra}
          {levels[level]?.multi && level < levels.length - 1 ? (
            <Button
              label={`show ${levels[level + 1]?.key}`}
              onClick={() => collection.current?.backTo(level + 1)}
            >
              show {levels[level + 1]?.key}
            </Button>
          ) : null}
        </>
      )}
      row={(hit) => ({
        checked: rungOf(hit).checked?.(hit.id),
        lead: rungOf(hit).checked ? (
          <span aria-hidden="true" className="face-mono">
            {rungOf(hit).checked?.(hit.id) === "mixed"
              ? "▣"
              : rungOf(hit).checked?.(hit.id)
                ? "☑"
                : "☐"}
          </span>
        ) : rungOf(hit).multi ? (
          <span aria-hidden="true" className="face-mono">
            {rungOf(hit).picked?.(hit.id) ? "☑" : "☐"}
          </span>
        ) : undefined,
        label: hit.label,
        meta: hit.caution ? <span data-tone="caution">{hit.sub}</span> : hit.sub,
        refusal: hit.refusal,
      })}
    />
  );
}
