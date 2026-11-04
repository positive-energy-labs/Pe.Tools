import type { PicturePage } from "@pe/agent-contracts";

/** Picture reports pose and selection separately; query verbs remain with their pane. */
export function picturePageMove<P extends Pick<PicturePage, "selected" | "issue">>(
  pose: (patch: Partial<Omit<P, "selected" | "issue">>, intent: "gesture" | "named") => unknown,
  select: (selected: string) => unknown,
) {
  return (next: Partial<P>, move?: { readonly history?: "push" | "replace" }) => {
    const { selected, issue, ...patch } = next;
    if (selected !== undefined || issue !== undefined) select(selected ?? issue ?? "");
    pose(patch, move?.history === "replace" ? "gesture" : "named");
  };
}
