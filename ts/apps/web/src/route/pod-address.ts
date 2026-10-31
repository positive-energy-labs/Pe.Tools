import { publicRoutes } from "./builtin-routes";
export const podRoutePath = (key: string) => `/tool/${encodeURIComponent(key)}`;
const routes = () =>
  publicRoutes
    .entries()
    .flatMap((entry) => (entry.graph?.address.startsWith("tool/") ? [entry.graph] : []));
const byPath = (path: string) => routes().find((graph) => `/${graph.address}` === path);
export const podWorkPath = (route: string) =>
  routes()
    .filter((graph) => graph.key === route)
    .map((graph) => `/${graph.address}`)[0];
export const podPathWork = (path: string) => byPath(path)?.key;
export const podPathName = (path: string) => byPath(path)?.name;
