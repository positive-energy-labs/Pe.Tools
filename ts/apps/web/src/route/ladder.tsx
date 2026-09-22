/**
 * THE LADDER — one popup per Situation ladder (Situation glossary), composed on the one list
 * (`ListPopup` + `levels`, ix-list R12). The trigger is the ladder's terminal word in the
 * sentence; the popup opens on the first unbound rung, shows every rung as a breadcrumb, and a
 * pick binds its rung and advances. A route hands it rungs as plain data; the list draws them.
 *
 * Marks: dotted underline = operable and held; dashed = empty or reported by the world, not chosen;
 * the caution tone = the ladder is incomplete or its feed disagrees.
 */
import type { ReactNode } from "react";

import type { Level } from "#/components/lang/collection";
import { ListPopup } from "#/components/lang/list-popup";

export interface RungOption {
  id: string;
  label: string;
  /** A measured fact beside the label (a count, a kind, a path tail). */
  sub?: string;
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
  picked?: (id: string) => boolean;
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
}: {
  levels: readonly Rung[];
  /** The bound value was reported by the world, not chosen (house law 8): dashed. */
  derived?: boolean;
  /** The world disagrees with the binding ("needs initialization"): caution tone. */
  caution?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const unbound = levels.findIndex((rung) => rung.label === null);
  const complete = unbound < 0;
  const word = complete ? (levels.at(-1)?.label ?? "") : levels[unbound]!.placeholder;
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
    onPick: (hit) => rung.pick(hit.id),
  }));
  const selected = levels.flatMap((rung) =>
    (rung.options ?? [])
      .filter((option) => rung.picked?.(option.id))
      .map((option) => `${rung.key}:${option.id}`),
  );
  const name = `Choose ${levels[complete ? levels.length - 1 : unbound]?.key ?? ""}`;
  return (
    <ListPopup<Hit>
      anchor="trigger"
      face="word"
      trigger={word}
      title={title}
      disabled={disabled}
      derived={derived || !complete}
      caution={caution || !complete}
      aria-label={name}
      // The trigger's face is a value or a placeholder; its name says what it chooses.
      triggerLabel={name}
      levels={rungs}
      startLevel={complete ? levels.length - 1 : unbound}
      keyOf={(hit) => `${hit.rung}:${hit.id}`}
      labelOf={(hit) => `${hit.label} ${hit.sub ?? ""}`.trim()}
      filter="substring"
      select="single"
      selected={selected}
      empty="nothing to choose"
      maxHeight="min(16rem, calc(100dvh - 6rem))"
      footer={(level) => levels[level]?.extra}
      row={(hit) => ({
        lead: rungOf(hit).multi ? (
          <span className="face-mono">{rungOf(hit).picked?.(hit.id) ? "☑" : "☐"}</span>
        ) : undefined,
        label: hit.label,
        meta: hit.sub,
      })}
    />
  );
}
