import {routeAddress,type RouteKey} from "@pe/agent-contracts";
import type {SearchSchemaInput} from "@tanstack/react-router";
import {routeSearch} from "./owner";
import {routeUrlPage} from "../route/url";
export function routeFile<R extends RouteKey>(route: R) {
  const url = routeUrlPage(route);
  return {
    validateSearch: (search: SearchSchemaInput & Record<string, unknown>) => ({
      ...routeSearch(search),
      ...routeAddress(route).read(search).page,
    }),
    search: { middlewares: [...url.middlewares] },
  };
}
