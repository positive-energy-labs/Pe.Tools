import { AsyncLocalStorage } from "node:async_hooks";
// Private host provenance. Public payloads and headers never populate this scope.
export const catalogCommandContext = new AsyncLocalStorage<string>();
