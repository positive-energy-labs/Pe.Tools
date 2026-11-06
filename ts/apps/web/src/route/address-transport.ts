import type { useRouter } from "@tanstack/react-router";

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
