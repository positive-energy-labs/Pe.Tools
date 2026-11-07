import type { Priced } from "./pricing.ts";
import type { LossResult } from "./losses.ts";
import type { HealPlan } from "./heal.ts";
/** Published results are JSON. Solver collections never cross the read boundary. */
export type JsonView<T> = T extends ReadonlyMap<infer K,infer V> ? Record<Extract<K,string|number>,JsonView<V>> : T extends ReadonlySet<infer V> ? JsonView<V>[] : T extends readonly unknown[] ? {[K in keyof T]:JsonView<T[K]>} : T extends object ? {[K in keyof T]:JsonView<T[K]>} : T;
export type PricedView=JsonView<Priced>;
export type LossView=JsonView<LossResult>;
export type HealView=JsonView<HealPlan>;
