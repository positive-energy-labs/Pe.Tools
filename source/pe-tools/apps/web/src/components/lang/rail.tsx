import type { ReactNode } from "react";

import { ActionChrome } from "./action-button";

import "./lang.css";

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
        className={`flex h-(--rail-h) shrink-0 items-center gap-2 overflow-hidden px-2 ${edge === "top" ? "hairline-t" : "hairline-b"}`}
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden truncate whitespace-nowrap">
          {lead}
        </div>
        {trail != null ? (
          <div className="flex max-w-full shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap">
            {trail}
          </div>
        ) : null}
      </div>
    </ActionChrome>
  );
}
