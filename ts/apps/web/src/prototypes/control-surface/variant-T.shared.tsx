/** THROWAWAY: shared fixtures + borderless-window chrome for the T1..T3 notification lineup. */
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@pe/kit/lang/button";

export const FINAL_MD = `Retagged **41 of 43** diffusers on Level 2.

- 38 now read \`SA-{Mark}\` from the family type
- 3 had no \`Mark\`; I left them untagged

| Skipped | Reason |
|---|---|
| 2 | pinned in a linked model |

Want me to number the 3 unmarked ones too?`;

export const FINAL_ONE_LINE = "Retagged 41 of 43 diffusers; 2 pinned in a link, 3 have no Mark.";
export const APPROVAL_ARGS = `{
  "op": "schedules.write",
  "document": "HCB-48 Mechanical.rvt",
  "schedules": ["Diffuser Schedule", "Air Terminal Schedule", "AHU Schedule"],
  "mode": "update-fields"
}`;
export const PROPOSAL_LINES = [
  "+ 9 parameters added (Flow, Neck Size, ...)",
  "~ 8 formulas rewritten",
  "~ 3 types renamed to HCB-48-*",
  "- 2 unused nested families removed",
];

/** A borderless window: the shell WebView2 paints; no title bar. */
export function Win({
  width,
  bottom,
  children,
}: {
  width: number;
  bottom: number;
  children: ReactNode;
}) {
  return (
    <div
      data-surface="artifact"
      className="absolute overflow-hidden rounded-[10px] text-ink shadow-[0_18px_60px_rgba(0,0,0,.55)]"
      style={{ right: 12, bottom, width }}
    >
      {children}
    </div>
  );
}

export function Who({ what, onClose }: { what: string; onClose?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span data-tone="pea" className="t-small t-upper">
        Pea
      </span>
      <span className="t-small face-mono truncate text-ink-2">{what}</span>
      <span className="grow" />
      {onClose ? <Button label="dismiss" icon={X} onClick={onClose} /> : null}
    </div>
  );
}
