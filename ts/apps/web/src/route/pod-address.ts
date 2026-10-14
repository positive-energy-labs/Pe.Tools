import type { PodRouteDescriptor } from "@pe/agent-contracts";
let routes: readonly PodRouteDescriptor[] = [];
export const podRoutePath = (key: string) => `/tool/${encodeURIComponent(key)}`;
export const podWorkPath = (route: string) => {
  const row = routes.find((row) => row.workRoute === route);
  return row && podRoutePath(row.key);
};
export const podPathWork = (path: string) =>
  routes.find((row) => podRoutePath(row.key) === path)?.workRoute;
export const podPathName = (path: string) =>
  routes.find((row) => podRoutePath(row.key) === path)?.name;
export const setPodAddresses = (rows: readonly PodRouteDescriptor[]) => {
  routes = rows;
};
