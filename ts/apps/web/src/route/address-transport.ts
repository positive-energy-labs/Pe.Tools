import { defaultParseSearch, defaultStringifySearch, type useRouter } from "@tanstack/react-router";

type AnyRouter = ReturnType<typeof useRouter>;

/**
 * Commit an already-encoded address: its query reaches history as these bytes. The router's
 * parse/stringify pair is not an inverse for codec text (`%22glass%22` parses to `glass` and is
 * written back unquoted), so a codec link never crosses `navigate({search})`, and the current
 * query is read from `rawQuery`, never from `location.searchStr` (that is the re-stringified copy).
 */
export function commitAddress(
  router: AnyRouter,
  pathname: string,
  query: URLSearchParams,
  { state, replace = false, ignoreBlocker = false, hash = "" }: CommitOptions = {},
) {
  const text = String(query);
  const href = `${pathname}${text ? `?${text}` : ""}${hash}`;
  return router.commitLocation({
    href,
    publicHref: href,
    state: { ...state },
    replace,
    ignoreBlocker,
  } as never);
}
/** The current address's query as history holds it. */
export const rawQuery = (router: AnyRouter) => new URLSearchParams(router.history.location.search);
type CommitOptions = {
  state?: Record<string, unknown>;
  replace?: boolean;
  ignoreBlocker?: boolean;
  hash?: string;
};

/**
 * The router's search codec: `?target` is codec text (`parseTarget`'s grammar), so the router never
 * JSON-parses it on read nor quotes it on write. The default pair re-quoted it: the root's
 * `routeSearch` hands a parsed target back as a string, and stringify quotes any string that parses
 * as JSON, so router load and every `navigate({search})` wrote it twice-encoded (refused at reload).
 */
export const searchCodec = {
  parseSearch: (text: string) => {
    const target = new URLSearchParams(text).get("target");
    return { ...defaultParseSearch(text), ...(target === null ? {} : { target }) };
  },
  stringifySearch: (search: Record<string, unknown>) => {
    const parts = Object.entries(search).flatMap(([key, value]) =>
      key === "target" && typeof value === "string"
        ? [`target=${encodeURIComponent(value)}`]
        : [defaultStringifySearch({ [key]: value }).slice(1)].filter(Boolean),
    );
    return parts.length ? `?${parts.join("&")}` : "";
  },
};
