/**
 * The one picker over a parameter slot's candidates, each with its coverage, best first. Settings
 * and both inbox airflow rows use it, so a slot is chosen the same way everywhere (same write path:
 * `airflowPatches`). A compact trigger names the current parameter and how many members hold a value.
 */
import { ListPopup } from "@pe/kit/lang/list-popup";
import { slotWord, type AirflowOption } from "../../airflow";

export function SlotPicker({
  word,
  current,
  options,
  noun,
  where,
  onPick,
}: {
  /** The slot's name for a person: "Grille airflow", "Unit airflow". */
  word: string;
  current: string;
  options: readonly AirflowOption[];
  /** "grilles" or "units". */
  noun: string;
  /** "in this system" or "in the document". */
  where: string;
  onPick: (slot: string) => void;
}) {
  const at = options.find((o) => o.slot === current);
  return (
    <span className="flex min-w-0 [&>button]:max-w-full" data-slot-picker="">
      <ListPopup<AirflowOption>
        anchor="trigger"
        face="inline"
        triggerLabel={word}
        title={`${word} is read from ${slotWord(current)}: ${at?.have ?? 0} of ${at?.of ?? 0} ${noun} ${where} hold a value`}
        aria-label={`${word} parameter`}
        items={[...options]}
        keyOf={(o) => o.slot}
        labelOf={(o) => o.slot}
        select="single"
        selected={[current]}
        empty="no airflow parameters"
        onPick={(o) => onPick(o.slot)}
        row={(o) => ({
          label: <span className="face-mono">{o.slot}</span>,
          meta: `${o.have}/${o.of}`,
          title: o.label,
        })}
        trigger={
          <span className="flex min-w-0 items-baseline gap-1">
            <span className="face-mono truncate">{slotWord(current)}</span>
            <span className="shrink-0 text-ink-2">
              · {at?.have ?? 0}/{at?.of ?? 0}
            </span>
          </span>
        }
      />
    </span>
  );
}
