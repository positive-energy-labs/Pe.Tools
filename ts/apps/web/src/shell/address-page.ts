/**
 * A route with an address and no manifest (Home, Settings, Ops, Bind, Captures) still gets the
 * same Page owner, history rule and agent lease (`useRouteLease`) as one with Work:
 * `routeFile(route)` is its file route's search options, `useAddressPage(route)` its Page. The
 * address schema is the Page; the URL, Back/Forward and Pea's patch all move it through
 * `routeAddress(route).transition`, exactly as `useRoute` does for a manifest route.
 */
/**
 * `createFileRoute(path)({ ...routeFile(route), component })`: the address is the search. Its
 * input is `SearchSchemaInput`, which is what lets a `<Link to="/$route" params={{ route: "settings" }}>` omit every key.
 */
export { routeFile } from "./route-file";
