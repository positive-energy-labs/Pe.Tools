import type { ReactNode } from "react";

export function Kbd({ mute, children }: { mute?: boolean; children: ReactNode }) {
  return (
    <kbd
      data-surface="recess"
      className={`face-mono t-small inline-flex min-w-7 shrink-0 items-center justify-center border px-1 py-0.5 ${
        mute ? "border-line text-ink-mute" : "border-line-2 text-ink"
      }`}
    >
      {children}
    </kbd>
  );
}
