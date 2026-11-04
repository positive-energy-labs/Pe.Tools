/** Codegen imports declarations, but must never acquire a browser runtime or execute host reads. */
export function hostFetch(): never {
  throw Error("Route projection cannot execute host reads");
}
export function runtimeStreamUrl(): never {
  throw Error("Route projection cannot open streams");
}

// Runtime Pod discovery must not register the app while generating its own builtin directory.
export const publicRoutes = { entries: () => [] };

// The producer must bootstrap without reading the projection it is replacing.
export const routeDirectory = [];
