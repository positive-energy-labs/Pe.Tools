/** The Situation's marks: a sentence slot and its choice (dotted = operable, dashed = empty). */
import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Kbd } from "#/components/lang/kbd";
import { Press } from "#/components/lang/press";
import { useScopeKeys } from "./keys";

/** A slot in the sentence: an operable value with its io mark (`r`, `w`, `rw`) as a superscript. */
export function SituationCell({
  io,
  empty,
  placeholder,
  children,
}: {
  io?: "r" | "w" | "rw";
  /** Dashed = the slot is declared and holds nothing yet. */
  empty?: boolean;
  /** What an empty slot says when nothing inside it draws its own emptiness (no picker). */
  placeholder?: string;
  children?: ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline" data-empty={empty || undefined}>
      {io ? <sup className="mr-0.5 t-small face-mono text-ink-mute">{io}</sup> : null}
      {empty && placeholder ? (
        <span className="seam-border border-b text-ink-2">{placeholder}</span>
      ) : (
        children
      )}
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

/**
 * THE SITUATION PALETTE's key: Ctrl K, bound on the scope node the head sits in, and its keycap
 * right of the sentence. Both open the sentence's ladder — switching what the page shows is the
 * next most important thing to editing it.
 */
export function PaletteKey({ open }: { open: () => void }) {
  useScopeKeys([
    {
      hotkey: "Mod+K",
      callback: open,
      label: "palette",
      says: "open the sentence's picker: switch what this page shows",
      options: { ignoreInputs: false },
    },
  ]);
  return (
    <Press
      tone="quiet"
      size="value"
      aria-label="Open the palette"
      title="Switch what this page shows: every rung of the sentence, type to filter (Ctrl K)"
      onClick={open}
    >
      <Kbd mute>Ctrl K</Kbd>
    </Press>
  );
}
