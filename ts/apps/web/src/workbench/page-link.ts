import { pageKeyOf, routeAddress } from "@pe/agent-contracts";

/** A Page on this runtime opens in the existing viewer. Foreign hosts and Page assets remain
 * ordinary links. This changes navigation only, never the Page's own binding or authority. */
export function pageLink(href: string, frontend: string) {
  try {
    const url = new URL(href, frontend);
    const own = new URL(frontend).origin;
    const host: string = import.meta.env.PE_RUNTIME_ORIGIN;
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      (url.origin !== own && (!host || url.origin !== new URL(host).origin))
    )
      return null;
    const match = /^\/pages\/([^/]+)(?:\/(?:index\.html)?)?$/.exec(url.pathname);
    if (!match) return null;
    const slug = decodeURIComponent(match[1]!);
    if (!pageKeyOf(slug)) return null;
    const page = {
      page: slug,
      view: true,
      query: url.search.slice(1),
      fragment: url.hash.slice(1),
    };
    return { slug, page, href: routeAddress("bind").link(page) };
  } catch {
    return null;
  }
}
