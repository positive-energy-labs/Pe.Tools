import type {RouteKey} from "@pe/agent-contracts";
import type {SearchSchemaInput} from "@tanstack/react-router";
import type {routeSearch} from "./owner";
/** The typed mount owns field decoding. Router validation preserves the original search object. */
export function routeFile<R extends RouteKey>(_route: R) {
  return {validateSearch:(search:SearchSchemaInput & Record<string,unknown>) =>
    search as ReturnType<typeof routeSearch> & Record<string,unknown>};
}
