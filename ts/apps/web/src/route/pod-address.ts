/** A Pod route's address; artifact admission checks the authenticated declaration against it. */
export const podRoutePath = (key: string) => `/tool/${encodeURIComponent(key)}`;
/** The registered trust page is reachable before its Pod's executable route is admitted. */
export const isPodRoutePath = (path: string) => /^\/tool\/[^/]+$/.test(path);
