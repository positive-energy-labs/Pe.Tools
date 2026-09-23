import { tv, type VariantProps } from "#/lib/tv";

const pressContentRecipe = tv({
  variants: {
    geometry: {
      row: "flex w-full items-center gap-2 px-2 py-1.5 text-left",
      baseline: "flex w-full items-baseline gap-2 px-2 py-0.5 text-left",
      stack: "flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left",
      block: "block w-full text-left",
    },
  },
});

type PressContentProps = React.ComponentProps<"span"> & VariantProps<typeof pressContentRecipe>;

export function PressContent({ geometry, ...props }: PressContentProps) {
  return <span className={pressContentRecipe({ geometry })} {...props} />;
}
