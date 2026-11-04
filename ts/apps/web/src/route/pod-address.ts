import { podRoutes } from "./pod-registry";
export const podRoutePath = (key: string) => `/tool/${encodeURIComponent(key)}`;
const entries = () => podRoutes.entries();
const byPath = (path: string) => entries().find(([key]) => podRoutePath(key) === path);
export const podWorkPath = (route: string) => {
  const entry = entries().find(([, admitted]) => admitted.data.key === route);
  return entry ? podRoutePath(entry[0]) : undefined;
};
export const podPathWork = (path: string) => byPath(path)?.[1].data.key;
export const podPathName = (path: string) => byPath(path)?.[1].data.name;
