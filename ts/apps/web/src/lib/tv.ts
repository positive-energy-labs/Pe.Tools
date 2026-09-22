/**
 * Vendored from tailwind-variants 0.3.1's MIT-licensed `tv` runtime after pnpm refused this
 * worktree's foreign virtual store. This is the subset used here: slots, variants and defaults.
 */
import { cn } from "#/lib/utils";

type ClassValue = string | null | false | undefined;
type Slots = Record<string, ClassValue>;
type SlotValue<S extends Slots | undefined> = S extends Slots
  ? ClassValue | Partial<Record<keyof S, ClassValue>>
  : ClassValue;
type Variants<S extends Slots | undefined> = Record<string, Record<string, SlotValue<S>>>;
type Selection<V extends Variants<Slots | undefined>> = {
  [K in keyof V]?: keyof V[K] extends "true" | "false" ? boolean : keyof V[K];
};
type ClassProp = { class?: ClassValue; className?: ClassValue };
type SlotFunctions<S extends Slots> = {
  [K in keyof S]: (props?: ClassProp) => string;
};

type Config<S extends Slots | undefined, V extends Variants<S>> = {
  base?: ClassValue;
  slots?: S;
  variants?: V;
  defaultVariants?: Selection<V>;
};

export type RecipeMetadata = {
  readonly variants: Record<string, Record<string, unknown>>;
  readonly slots: readonly string[];
};

type Recipe<V extends Variants<undefined>> = ((props?: Selection<V> & ClassProp) => string) &
  RecipeMetadata;
type SlotRecipe<S extends Slots, V extends Variants<S>> = ((
  props?: Selection<V>,
) => SlotFunctions<S>) &
  RecipeMetadata;

export type VariantProps<T extends (...args: never[]) => unknown> = Omit<
  NonNullable<Parameters<T>[0]>,
  "class" | "className"
>;

export function recipeClass<State>(
  slot: (props?: ClassProp) => string,
  className?: string | ((state: State) => string | undefined),
): string | ((state: State) => string) {
  return typeof className === "function"
    ? (state) => slot({ className: className(state) })
    : slot({ className });
}

export function tv<const S extends Slots, const V extends Variants<S>>(
  config: Config<S, V> & { slots: S },
): SlotRecipe<S, V>;
export function tv<const V extends Variants<undefined>>(config: Config<undefined, V>): Recipe<V>;
export function tv(
  config: Config<Slots | undefined, Variants<Slots | undefined>>,
): Recipe<Variants<undefined>> | SlotRecipe<Slots, Variants<Slots>> {
  const variants = config.variants ?? {};
  const metadata = { variants, slots: Object.keys(config.slots ?? {}) };
  const selected = (props: Record<string, unknown> = {}) =>
    Object.keys(variants).map((name) => {
      const value = props[name] ?? config.defaultVariants?.[name];
      const key = typeof value === "boolean" ? `${value}` : typeof value === "string" ? value : "";
      return variants[name]?.[key];
    });

  if (config.slots == null) {
    return Object.assign(
      (props: Record<string, unknown> & ClassProp = {}) =>
        cn(config.base, ...selected(props), props.class, props.className),
      metadata,
    );
  }

  return Object.assign((props = {}) => {
    const choices = selected(props);
    return Object.fromEntries(
      Object.entries(config.slots ?? {}).map(([slot, base]) => [
        slot,
        (classProps: ClassProp = {}) =>
          cn(
            base,
            ...choices.map((choice) =>
              typeof choice === "object" && choice != null ? choice[slot] : undefined,
            ),
            classProps.class,
            classProps.className,
          ),
      ]),
    ) as SlotFunctions<Slots>;
  }, metadata);
}
