import { builtinClosures } from "./builtin-closures.generated";
import { builtinModules } from "./builtin-modules.generated";
import type { TypedRoute } from "./typed-route";
export type BuiltinKey = keyof typeof builtinModules;
export const typedBuiltin = (key: BuiltinKey): TypedRoute => builtinModules[key];
export const builtinRouteKeys = Object.keys(builtinModules) as BuiltinKey[];
export const builtinRouteStamp = (key: BuiltinKey) => builtinClosures[key].fingerprint;
