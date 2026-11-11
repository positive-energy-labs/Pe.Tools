import { registerTypedRoute } from "../shell/route-registration";
import { publicRoutes } from "./route-discovery";
import { routeRegistry } from "./registry";

export { publicRoutes };
// One refused builtin is logged and the rest still register, so the app boots without it.
for (const { module, fingerprint } of Object.values(routeRegistry)) {
  try {
    registerTypedRoute(module, fingerprint);
  } catch (error) {
    console.error("Builtin discovery refused", error);
  }
}
