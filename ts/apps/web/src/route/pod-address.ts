const addresses = new Map<string, string>();
const names = new Map<string, string>();
export const podRoutePath = (key: string) => `/tool/${encodeURIComponent(key)}`;
export const podWorkPath = (route: string) => addresses.get(route);
export const podPathWork = (path: string) =>
  [...addresses].find(([, value]) => value === path)?.[0];
export const podPathName = (path: string) => names.get(path);
export function setPodAddresses(rows: readonly { key: string; workRoute: string; name: string }[]) {
  addresses.clear();
  names.clear();
  for (const row of rows) {
    const path = podRoutePath(row.key);
    addresses.set(row.workRoute, path);
    names.set(path, row.name);
  }
}
