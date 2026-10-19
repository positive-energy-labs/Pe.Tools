import type { ReactNode } from "react";

import "./lang.css";

/**
 * One line at `--rail-h`. The lanes scroll horizontally only: `overflow-x: auto` alone computes
 * `overflow-y: auto`, so anything taller than the rail made the rail scroll vertically and clip.
 * The head rung's line box (24px × 1.2 = 28.8px) is taller than `--rail-h` (24px); base.css lets
 * a rail whose lead holds a `t-head` grow to the head's line box instead of clipping it.
 */
export function Rail({
  ground,
  lead,
  trail,
  center,
  edge = "bottom",
}: {
  /** Omitted, the rail sits on its parent's ground. */
  ground?: "page" | "recess";
  lead: ReactNode;
  trail?: ReactNode;
  /** A centered lane with equal space reserved on either side. */
  center?: ReactNode;
  edge?: "bottom" | "top";
}) {
  return (
    <div
      data-slot="rail"
      data-surface={ground}
      className={`${center != null ? "grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]" : "flex"} h-(--rail-h) shrink-0 items-center gap-2 px-(--gutter) ${edge === "top" ? "hairline-t" : "hairline-b"}`}
    >
      <div
        data-slot="rail-lead"
        className="no-scrollbar flex min-w-0 flex-1 items-baseline gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap"
        onFocusCapture={({ target }) =>
          (target as HTMLElement).scrollIntoView({ block: "nearest", inline: "nearest" })
        }
      >
        {lead}
      </div>
      {center != null ? (
        <div
          data-slot="rail-center"
          className="flex min-w-0 items-center justify-center gap-2 overflow-hidden text-center"
        >
          {center}
        </div>
      ) : null}
      {trail != null ? (
        <div
          data-slot="rail-actions"
          className={`no-scrollbar flex min-w-0 max-w-full flex-[0_1_auto] items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap ${center != null ? "justify-end" : ""}`}
          onFocusCapture={({ target }) =>
            (target as HTMLElement).scrollIntoView({ block: "nearest", inline: "nearest" })
          }
        >
          {trail}
        </div>
      ) : null}
    </div>
  );
}
