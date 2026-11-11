import { routeRegistry } from "./registry";
import type { TypedRoute } from "./typed-route";
export type BuiltinKey = string;
const row = (key: BuiltinKey) => {
  const found = routeRegistry[key];
  if (!found) throw Error(`${key} is not a builtin route`);
  return found;
};
export const typedBuiltin = (key: BuiltinKey): TypedRoute => row(key).module;
export const builtinRouteKeys: BuiltinKey[] = Object.keys(routeRegistry).sort();
export const builtinRouteStamp = (key: BuiltinKey) => row(key).closure.fingerprint;
