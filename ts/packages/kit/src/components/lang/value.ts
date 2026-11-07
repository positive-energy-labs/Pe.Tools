import { createContext, useContext, useMemo } from "react";

/** A drawing's accepted Value handle. Availability is owned by its producer. */
export interface ValueHandle<Data> {
  readonly value?: Data;
  readonly current: boolean;
  readonly status: string;
  readonly reason?: string;
}

type DrawingData<T> = T extends string | number | boolean | bigint | symbol | null | undefined ? T : T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyMap<infer K, infer V>
    ? Map<K, DrawingData<V>>
    : T extends ReadonlySet<infer V>
      ? Set<DrawingData<V>>
      : T extends object
        ? { -readonly [K in keyof T]: DrawingData<T[K]> }
        : T;

/** A drawing may use mutable view libraries without handing them the kernel's retained evidence. */
export function useValue<Data>(value: ValueHandle<Data>): DrawingData<Data> | undefined {
  return useMemo(
    () =>
      value.value === undefined ? undefined : (structuredClone(value.value) as DrawingData<Data>),
    [value.value],
  );
}

/** Retained rows keep the current Value's status; an old body never becomes ready by existing. */
export function valueRows<Data, Row>(
  value: ValueHandle<Data>,
  rows: (data: Data) => readonly Row[],
) {
  return {
    items: value.value === undefined ? [] : rows(value.value),
    status: value.current
      ? ("ready" as const)
      : value.status === "pending"
        ? ("pending" as const)
        : ("failed" as const),
    failure: value.current ? undefined : value.reason,
  };
}

export type ValueItems<Row, Data> =
  | { items: readonly Row[]; value?: never; rowsOf?: never }
  | { value: ValueHandle<Data>; rowsOf: (data: Data) => readonly Row[]; items?: never };

/** The shell installs the accepted pane Value once; nested drawings share its freshness. */
export const ValueScope = createContext<ValueHandle<unknown> | null>(null);
export const usePaneValue = () => useContext(ValueScope);
