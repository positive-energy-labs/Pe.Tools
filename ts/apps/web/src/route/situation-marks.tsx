/** The Situation's marks: a sentence slot and its choice (dotted = operable, dashed = empty). */
import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";

/** A slot in the sentence: an operable value with its io mark (`r`, `w`, `rw`) as a superscript. */
export function SituationCell({
  io,
  empty,
  children,
}: {
  io?: "r" | "w" | "rw";
  /** Dashed = the slot is declared and holds nothing yet. */
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline" data-empty={empty || undefined}>
      {io ? <sup className="mr-0.5 t-small face-mono text-ink-mute">{io}</sup> : null}
      {children}
    </span>
  );
}

const slotTrigger = "cursor-pointer border-b border-dotted border-current";
/** An empty slot has nothing real behind it: the named seam role, never a raw dash. */
const slotTriggerEmpty = `${slotTrigger} seam-border text-ink-2`;

/** One slot picker: the trigger is the value, the popup is what the route puts inside. */
export function SituationChoice({
  label,
  empty,
  children,
}: {
  label: ReactNode;
  empty?: boolean;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        className={empty ? slotTriggerEmpty : slotTrigger}
        data-empty={empty || undefined}
      >
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            data-surface="artifact"
            className="max-h-96 w-80 max-w-(--available-width) overflow-auto rounded-lg p-2 t-prose text-ink ring-1 ring-line outline-none"
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
