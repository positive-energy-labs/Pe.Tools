/** A Pod route's address; artifact admission checks the authenticated declaration against it. */
export const podRoutePath = (key: string) => `/tool/${encodeURIComponent(key)}`;
