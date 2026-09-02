import { tv } from "#/lib/tv";

export const threadRowRecipe = tv({
  slots: {
    root: "group/row flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 t-prose",
    title: "min-w-0 flex-1 truncate",
  },
  variants: {
    active: {
      true: { root: "", title: "text-ink" },
      false: { root: "veil", title: "text-ink-2" },
    },
  },
});

export const docSubRowRecipe = tv({
  base: "block truncate t-small face-mono",
  variants: { active: { true: "text-ink", false: "text-ink-2" } },
});
