import type { ReactNode } from "react";

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
    <div
      data-slot="rail"
      data-surface={ground}
      className={`flex h-(--rail-h) shrink-0 items-center gap-2 px-2 ${edge === "top" ? "hairline-t" : "hairline-b"}`}
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-2 truncate">{lead}</div>
      {trail != null ? <div className="flex shrink-0 items-center gap-1">{trail}</div> : null}
    </div>
  );
}
