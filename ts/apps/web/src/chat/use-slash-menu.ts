// The composer's slash menu, headless: detection from the draft text, dismissal, Tab-picks-cursor.
// ↑/↓, Enter and Escape belong to the open list (R14); Tab is the composer's second pick key.
import { useRef, useState, type KeyboardEvent } from "react";
import { filterItems, type Collection } from "#/components/lang/collection";

export interface SlashCommand {
  name: string;
  description: string;
}

export function useSlashMenu(text: string, commands: SlashCommand[]) {
  const [dismissed, setDismissed] = useState(false);
  const collection = useRef<Collection<SlashCommand> | null>(null);
  const query = text.startsWith("/") ? text.slice(1).split(/\s+/)[0]!.toLowerCase() : undefined;
  const open =
    !dismissed &&
    query !== undefined &&
    !text.includes(" ") &&
    filterItems(commands, (command) => command.name, "substring", query).length > 0;

  return {
    open,
    query: query ?? "",
    dismiss: () => setDismissed(true),
    /** The text changed: the menu may open again. */
    reset: () => setDismissed(false),
    /** Pass to the list's `onCollection`. */
    bind: (next: Collection<SlashCommand> | null) => {
      collection.current = next;
    },
    /** True when the menu owns the key (Tab picked, or the open list handles it). */
    onKeyDown: (event: KeyboardEvent): boolean => {
      if (!open) return false;
      const cursor = collection.current?.cursor;
      if (event.key === "Tab" && !event.shiftKey && cursor) {
        event.preventDefault();
        collection.current?.pick(cursor);
      }
      return true;
    },
    /** The text a picked command leaves in the draft. */
    pick: (command: SlashCommand) => `/${command.name} `,
  };
}
