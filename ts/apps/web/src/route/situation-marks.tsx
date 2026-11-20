/** The Situation's marks: a sentence slot and its choice (dotted = operable, dashed = empty). */
import type { ReactNode } from "react";
import { HotkeyCommand } from "#/components/lang/hotkey-command";

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

export function PagePaletteButton({ open }: { open: () => void }) {
  return (
    <HotkeyCommand
      label="Open page palette"
      word="Page"
      hotkey="Mod+K"
      invoke={open}
      bind={false}
      reason="Switch what this page shows"
    />
  );
}
