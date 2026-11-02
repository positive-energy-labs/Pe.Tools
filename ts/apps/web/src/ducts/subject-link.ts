import { manyCodec } from "../../../../packages/agent-contracts/src/route-field";
/** Cross-route links carry only the destination subject and the document/fixture binding. */
export function subjectLink(
  route: "fans" | "ducts",
  ids: string[],
  search: Record<string, unknown>,
) {
  const params = new URLSearchParams();
  for (const key of ["target", "fixture", "thread"])
    if (typeof search[key] === "string") params.set(key, search[key]);
  params.set(route === "fans" ? "fan" : "system", manyCodec.encode(ids));
  return `/${route}?${params}`;
}
