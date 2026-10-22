/**
 * A floater is a corner surface over a pane's body (ledger 2026-10-21): the pane's strip toggles it,
 * the pane draws it over the body's corner, and it is a key scope of its own, so a minimap's keys
 * bind only while focus is inside it. Esc inside it closes it and hands focus back to the pane.
 */
import { useRef, type ReactNode, type RefObject } from "react";

import { KeyScope, useScopeKeys, type Chord } from "@pe/kit/keys";

export interface FloaterSpec {
  key: string;
  label: string;
  chord?: Chord;
  says?: string;
  place: "tl" | "tr" | "bl" | "br";
  size?: { width: number; height: number };
  open: boolean;
  onOpenChange(open: boolean): void;
  render(): ReactNode;
}

const PLACE = {
  tl: "top-(--gutter) left-(--gutter)",
  tr: "top-(--gutter) right-(--gutter)",
  bl: "bottom-(--gutter) left-(--gutter)",
  br: "bottom-(--gutter) right-(--gutter)",
} as const;

export function Floater({ spec }: { spec: FloaterSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <KeyScope id={`floater:${spec.key}`} element={ref}>
      <div
        ref={ref}
        role="region"
        aria-label={spec.label}
        tabIndex={-1}
        data-slot="floater"
        data-floater={spec.key}
        data-surface="artifact"
        className={`absolute z-popup shadow-float p-1 ${PLACE[spec.place]}`}
        style={spec.size}
      >
        <FloaterKeys spec={spec} element={ref} />
        {spec.render()}
      </div>
    </KeyScope>
  );
}

function FloaterKeys({
  spec,
  element,
}: {
  spec: FloaterSpec;
  element: RefObject<HTMLDivElement | null>;
}) {
  useScopeKeys([
    {
      hotkey: "Escape",
      label: `close ${spec.label}`,
      says: `Close the ${spec.label} floater and return to the pane.`,
      callback: () => {
        element.current?.closest<HTMLElement>("[data-slot='pane']")?.focus();
        spec.onOpenChange(false);
      },
    },
  ]);
  return null;
}
