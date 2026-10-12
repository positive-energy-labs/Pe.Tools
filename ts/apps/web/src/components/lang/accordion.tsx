/**
 * ACCORDION — groups that open one at a time, each header carrying its group's critical state
 * (machine control plane, design-system ledger 2026-10-09). The header is the summary a folded
 * group owes the reader: it states what the body would show first, never a count that hides a
 * hazard. Which group is open is the caller's state; this owns only the drawing.
 */
import type { ReactNode } from "react";

export interface AccordionGroup {
  readonly key: string;
  readonly label: string;
  /** The group's critical state, said while folded. */
  readonly state: ReactNode;
  readonly tone?: "caution" | "alarm" | "done";
  readonly body: ReactNode;
}

export function Accordion({
  groups,
  open,
  onOpen,
  label,
}: {
  groups: readonly AccordionGroup[];
  open: string | null;
  onOpen: (key: string | null) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      {groups.map((group) => {
        const expanded = open === group.key;
        return (
          <section key={group.key} className="hairline-t" aria-label={group.label}>
            <button
              type="button"
              aria-expanded={expanded}
              className="veil flex h-(--control-h) w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-0.5 text-left"
              onClick={() => onOpen(expanded ? null : group.key)}
            >
              <span className="w-2.5 shrink-0 face-mono text-ink-2">{expanded ? "▾" : "▸"}</span>
              <span className="font-semibold text-ink">{group.label}</span>
              <span className="ml-auto min-w-0 truncate text-ink-2" data-tone={group.tone}>
                {group.state}
              </span>
            </button>
            {expanded ? <div className="pb-2 pl-4">{group.body}</div> : null}
          </section>
        );
      })}
    </div>
  );
}
