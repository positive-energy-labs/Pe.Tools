/**
 * Dev knobs: a module declares its tunable constants once, as a typed spec with defaults, and reads
 * them back through `read()`. In development the floater (`floater.tsx`) overrides them live; Copy
 * hands back only the values that differ from the code, so an agent can paste them into the spec.
 *
 * EXCEPTION to docs/features/design-system/LEDGER.md:715 ("do not add a parallel settings store"):
 * this is not a setting. kaitpw asked for a dev-only tuning floater whose state dies on refresh
 * (2026-10-24). Boundary that still holds: overrides live in module memory only (no localStorage,
 * no URL, no Work cell), are written only by the dev floater, and in a production build `read()`
 * returns the code defaults, so product logic never depends on an override.
 */

export type Cost = "live" | "refetch";
type Base<T> = {
  label: string;
  default: T;
  /** `refetch`: a change alters a host request and costs a Revit capture. */
  cost: Cost;
};
export type NumberKnob = Base<number> & {
  kind: "number";
  min: number;
  max: number;
  step: number;
  unit: string;
};
/** `#rrggbb`, or a word naming where the default comes from (a kit token role, or "theme"). */
export type ColourKnob = Base<string> & { kind: "colour" };
export type BooleanKnob = Base<boolean> & { kind: "boolean" };
type ChoiceKnob<T extends string = string> = Base<T> & { kind: "choice"; options: readonly T[] };
/** Several of a set whose options the running page offers (`offer`). */
export type SetKnob = Base<readonly string[]> & { kind: "set" };
export type Knob = NumberKnob | ColourKnob | BooleanKnob | ChoiceKnob | SetKnob;
export type Spec = Readonly<Record<string, Readonly<Record<string, Knob>>>>;
export type Values<S extends Spec> = {
  readonly [G in keyof S]: { readonly [K in keyof S[G]]: S[G][K]["default"] };
};

export const num = (
  label: string,
  value: number,
  [min, max, step]: readonly [number, number, number],
  cost: Cost = "live",
  unit = "",
): NumberKnob => ({ kind: "number", label, default: value, min, max, step, cost, unit });
export const colour = (label: string, value: string): ColourKnob => ({
  kind: "colour",
  label,
  default: value,
  cost: "live",
});
export const bool = (label: string, value: boolean): BooleanKnob => ({
  kind: "boolean",
  label,
  default: value,
  cost: "live",
});
export const choice = <const T extends string>(
  label: string,
  value: T,
  options: readonly T[],
  cost: Cost = "live",
): ChoiceKnob<T> => ({ kind: "choice", label, default: value, options, cost });
export const set = (label: string, value: readonly string[] = []): SetKnob => ({
  kind: "set",
  label,
  default: value,
  cost: "live",
});

export type KnobModule = { name: string; source: string; spec: Spec };

/** Declaration order is the floater's and the copy's order. */
const modules = new Map<string, KnobModule>();
/** `module.group.knob` → value; a value equal to its default is never stored. */
const overrides = new Map<string, unknown>();
const offered = new Map<string, readonly string[]>();
const listeners = new Set<() => void>();
/** Bumps on override changes only: readers keep one stable object between them. */
const revisions = new Map<string, number>();
const revise = (name: string) => revisions.set(name, (revisions.get(name) ?? 0) + 1);
/** Bumps on anything the floater draws (overrides and offered options). */
let version = 0;
const emit = () => {
  version++;
  for (const listener of listeners) listener();
};

export const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const knobVersion = () => version;
export const knobModules = (): readonly KnobModule[] => [...modules.values()];
export const overrideOf = (path: string) => overrides.get(path);
export const offeredOf = (path: string) => offered.get(path) ?? [];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const knobAt = (path: string) => {
  const [module, group, name] = path.split(".");
  return modules.get(module!)?.spec[group!]?.[name!];
};

/** Dynamic controls cross this boundary; typed readers never receive an invalid override. */
const accepts = (knob: Knob, value: unknown): boolean => {
  switch (knob.kind) {
    case "number":
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= knob.min &&
        value <= knob.max
      );
    case "boolean":
      return typeof value === "boolean";
    case "colour":
      return typeof value === "string" && (/^#[\da-f]{6}$/i.test(value) || value === knob.default);
    case "choice":
      return typeof value === "string" && knob.options.includes(value);
    case "set":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }
};

export function setKnob(path: string, value: unknown) {
  const knob = knobAt(path);
  if (!import.meta.env.DEV || !knob || !accepts(knob, value)) return false;
  if (same(value, overrides.get(path) ?? knob.default)) return true;
  if (same(value, knob.default)) overrides.delete(path);
  else overrides.set(path, Array.isArray(value) ? Object.freeze([...new Set(value)]) : value);
  revise(path.split(".")[0]!);
  emit();
  return true;
}
/** A knob, group or module back to code defaults; no path resets every module. */
export function resetKnob(path?: string) {
  const keys = [...overrides.keys()].filter(
    (key) => !path || key === path || key.startsWith(`${path}.`),
  );
  const names = new Set(keys.map((key) => key.split(".")[0]!));
  if (!names.size) return;
  keys.forEach((key) => overrides.delete(key));
  names.forEach(revise);
  emit();
}

const show = (value: unknown) =>
  Array.isArray(value)
    ? `[${value.join(", ")}]`
    : typeof value === "number"
      ? String(Number(value.toFixed(6)))
      : String(value);

/** The paste-back snippet: only knobs that differ from code, grouped by module, in spec order. */
export function diffText(
  from: readonly KnobModule[],
  changed: ReadonlyMap<string, unknown>,
): string {
  return from
    .flatMap(({ name, source, spec }) => {
      const lines = Object.entries(spec).flatMap(([group, knobs]) =>
        Object.entries(knobs).flatMap(([knob, { default: value }]) => {
          const path = `${name}.${group}.${knob}`;
          return changed.has(path) && !same(changed.get(path), value)
            ? [`${path}: ${show(changed.get(path))} (default ${show(value)})`]
            : [];
        }),
      );
      return lines.length ? [`# ${source}`, ...lines] : [];
    })
    .join("\n");
}
export const copyText = () => diffText(knobModules(), overrides);
export const changedCount = () => overrides.size;

/** Declare a module's knobs. `read()` is stable between override changes, and the defaults in production. */
export function defineKnobs<S extends Spec>(name: string, source: string, spec: S) {
  const resolve = (overridden: boolean) =>
    Object.fromEntries(
      Object.entries(spec).map(([group, knobs]) => [
        group,
        Object.fromEntries(
          Object.entries(knobs).map(([knob, { default: value }]) => {
            const path = `${name}.${group}.${knob}`;
            const held = overrides.get(path);
            return [knob, overridden && accepts(spec[group]![knob]!, held) ? held : value];
          }),
        ),
      ]),
    ) as Values<S>;
  const defaults = resolve(false);
  let seen = -1;
  let current = defaults;
  if (import.meta.env.DEV) {
    modules.set(name, { name, source, spec });
    emit();
  }
  return {
    defaults,
    read(): Values<S> {
      if (!import.meta.env.DEV) return defaults;
      const revision = revisions.get(name) ?? 0;
      if (seen !== revision) {
        seen = revision;
        current = resolve(true);
      }
      return current;
    },
    set<G extends keyof S & string, K extends keyof S[G] & string>(
      group: G,
      knob: K,
      value: Values<S>[G][K],
    ) {
      return setKnob(`${name}.${group}.${knob}`, value);
    },
    /** The options a `set` knob offers now (e.g. the categories in the drawn scene). */
    offer<G extends keyof S & string>(
      group: G,
      knob: { [K in keyof S[G]]: S[G][K] extends SetKnob ? K : never }[keyof S[G]] & string,
      options: readonly string[],
    ) {
      if (!import.meta.env.DEV) return;
      const path = `${name}.${group}.${knob}`;
      if (same(offered.get(path), options)) return;
      offered.set(path, options);
      emit();
    },
  };
}
