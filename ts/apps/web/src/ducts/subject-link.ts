import { localId } from "./neutral";
/** Cross-route links carry only the destination subject and the document/fixture binding. */
export function subjectLink(
  route: "fans" | "ducts",
  ids: string[],
  search: Record<string, unknown>,
) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  params.set(
    route === "fans" ? "fan" : "system",
    JSON.stringify({
      kind: "ids",
      ids: ids.map((id) => localId(route === "fans" ? "ducts-fan" : "ducts-system", id)),
    }),
  );
  return `/${route}?${params}`;
}
