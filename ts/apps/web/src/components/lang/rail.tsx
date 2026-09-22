import type { ReactNode } from "react";

import { ActionChrome } from "./action-button";

import "./lang.css";

/**
 * One line at `--rail-h`. The lanes scroll horizontally only: `overflow-x: auto` alone computes
 * `overflow-y: auto`, so anything taller than the rail made the rail scroll vertically and clip.
 * The head rung's line box (24px × 1.2 = 28.8px) is taller than `--rail-h` (24px); base.css seats
 * a `t-head` in the lead on the rail's line instead of letting it grow the lane.
 */
export function Rail({
  ground = "page",
  lead,
  trail,
  edge = "bottom",
}: {
  ground?: "page" | "recess";
  lead: ReactNode;
  trail?: ReactNode;
  edge?: "bottom" | "top";
}) {
  return (
    <ActionChrome value>
      <div
        data-slot="rail"
        data-surface={ground}
        className={`flex h-(--rail-h) shrink-0 items-center gap-2 px-2 ${edge === "top" ? "hairline-t" : "hairline-b"}`}
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
        {trail != null ? (
          <div
            data-slot="rail-actions"
            className="no-scrollbar flex min-w-0 max-w-full flex-[0_1_auto] items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap"
            onFocusCapture={({ target }) =>
              (target as HTMLElement).scrollIntoView({ block: "nearest", inline: "nearest" })
            }
          >
            {trail}
          </div>
        ) : null}
      </div>
    </ActionChrome>
  );
}
