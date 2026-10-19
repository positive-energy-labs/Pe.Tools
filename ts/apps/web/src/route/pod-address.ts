import type { PodRouteDescriptor } from "@pe/agent-contracts";
let routes: readonly PodRouteDescriptor[] = [];
export const podRoutePath = (key: string) => `/tool/${encodeURIComponent(key)}`;
const byPath = (path: string) => routes.find((row) => podRoutePath(row.key) === path);
export const podWorkPath = (route: string) =>
  routes.filter((row) => row.workRoute === route).map((row) => podRoutePath(row.key))[0];
export const podPathWork = (path: string) => byPath(path)?.workRoute;
export const podPathName = (path: string) => byPath(path)?.name;
export const setPodAddresses = (rows: readonly PodRouteDescriptor[]) => void (routes = rows);
