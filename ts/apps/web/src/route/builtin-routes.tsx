import { registerTypedRoute } from "../shell/route-registration";
import { publicRoutes } from "./route-discovery";
import { builtinRouteKeys, builtinRouteStamp, typedBuiltin } from "./builtin-inventory";
import { workFingerprintSchema } from "@pe/agent-contracts";

export { publicRoutes };
export const publicRoutesReady = Promise.all(
  builtinRouteKeys.map(async (key) => {
    const typed=typedBuiltin(key);
    const fingerprint = workFingerprintSchema.parse(`builtin-closure:${builtinRouteStamp(key)}`);
    registerTypedRoute(typed, fingerprint);
  }),
);
void publicRoutesReady.catch((error) => console.error("Builtin discovery refused", error));
