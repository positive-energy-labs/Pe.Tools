/**
 * PROTO-TUTORIAL: a module ref holding the manifest rendered by the current route's
 * `TargetingSentence`. It loses to a real registry if the tutorial survives; delete it otherwise.
 * Replacement owner: `TargetingHead`, the one route-spec provider.
 */
import type { Bindings, Runner } from "#/targeting/kit";
import type { Product } from "#/targeting/model";

export interface CurrentManifest<K extends string = string> {
  product: Product<K>;
  b: Bindings<K>;
  runner: Runner<K>;
}

let current: CurrentManifest | null = null;
let route: string | null = null;

export function setCurrentManifest<K extends string>(next: CurrentManifest<K>) {
  current = next as unknown as CurrentManifest;
  route = typeof location === "undefined" ? null : location.pathname;
}

export function readCurrentManifest(): CurrentManifest | null {
  if (typeof location !== "undefined" && route !== location.pathname) return null;
  return current;
}
