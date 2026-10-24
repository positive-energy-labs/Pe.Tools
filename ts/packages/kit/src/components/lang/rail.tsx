import { land } from "./land";
import type { ReactNode } from "react";

import "./lang.css";

/**
 * One line at `--rail-h`. The lanes scroll horizontally only: `overflow-x: auto` alone computes
 * a vertical overflow box, so anything taller than the rail made the rail scroll vertically and clip.
 * The head rung's line box (24px × 1.2 = 28.8px) is taller than `--rail-h` (24px); base.css lets
 * a rail whose lead holds a `t-head` grow to the head's line box instead of clipping it.
 */
export function Rail({
  ground,
  lead,
  trail,
  center,
  edge = "bottom",
  fit = "line",
  size = "rail",
}: {
  /** Omitted, the rail sits on its parent's ground. */
  ground?: "page" | "recess";
  lead: ReactNode;
  trail?: ReactNode;
  /** A centered lane with equal space reserved on either side. */
  center?: ReactNode;
  edge?: "bottom" | "top";
  /** `line` is one clipped line at `--rail-h`; `wrap` lets the trail drop under a lead that never
   * shrinks and grow the rail to hold it, for a titlebar whose trail accumulates chips. */
  fit?: "line" | "wrap";
  /** `rail` is a route's own line at `--rail-h`; `control` is one control plus a gutter (32px
   * comfort, 28px dense), for a head subordinate to the route's rail (an artifact frame's). */
  size?: "rail" | "control";
}) {
  const wrap = fit === "wrap";
  const box =
    size === "control"
      ? wrap
        ? "min-h-[calc(var(--control-h)+var(--gutter))] flex-wrap py-px"
        : "h-[calc(var(--control-h)+var(--gutter))]"
      : wrap
        ? "min-h-(--rail-h) flex-wrap py-px"
        : "h-(--rail-h)";
  return (
    <div
      data-slot="rail"
      data-surface={ground}
      className={`${center != null ? "grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]" : "flex"} ${box} shrink-0 items-center gap-2 px-(--gutter) ${edge === "top" ? "hairline-t" : "hairline-b"}`}
    >
      <div
        data-slot="rail-lead"
        className={`no-scrollbar flex min-w-0 items-baseline gap-2 overflow-x-auto overflow-y-hidden whitespace-nowrap ${wrap ? "max-w-full shrink-0" : "flex-1"}`}
        onFocusCapture={({ target }) => land(target as HTMLElement)}
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
          className={`flex min-w-0 max-w-full items-center gap-1 ${wrap ? "ml-auto flex-[1_1_20rem] flex-wrap justify-end" : "no-scrollbar flex-[0_1_auto] overflow-x-auto overflow-y-hidden whitespace-nowrap"} ${center != null ? "justify-end" : ""}`}
          onFocusCapture={({ target }) => land(target as HTMLElement)}
        >
          {trail}
        </div>
      ) : null}
    </div>
  );
}
