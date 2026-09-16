import type { ReactNode } from "react";

import "./lang.css";

export function Rail({
  ground = "page",
  lead,
  trail,
}: {
  ground?: "page" | "recess";
  lead: ReactNode;
  trail?: ReactNode;
}) {
  return (
    <div
      data-slot="rail"
      data-surface={ground}
      className="flex h-(--rail-h) shrink-0 items-center gap-2 px-2 hairline-b"
    >
      <div className="flex min-w-0 flex-1 items-baseline gap-2 truncate">{lead}</div>
      {trail != null ? <div className="flex shrink-0 items-center gap-1">{trail}</div> : null}
    </div>
  );
}
